import { query, one } from './db.js';
import { enqueue } from './jobs.js';
import { normalizeEmail } from './util.js';

const STATUS_FOR_REASON = {
  unsubscribed: 'unsubscribed',
  manual: 'unsubscribed',
  spam: 'unsubscribed',
  brevo_blocklist: 'unsubscribed',
  hard_bounce: 'bounced',
};

/**
 * Adds an address to the suppression list, updates the matching contact's status,
 * and (unless the event came from Brevo) queues a sync so Brevo blocklists it too.
 */
export async function suppress(email, reason, { source = '', campaignId = null, fromBrevo = false } = {}) {
  const e = normalizeEmail(email);
  if (!e) return;
  await query(
    `INSERT INTO suppression_list (email, reason, source, campaign_id, synced_to_brevo)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (lower(email)) DO UPDATE SET
       reason = CASE WHEN suppression_list.reason = 'hard_bounce' THEN suppression_list.reason ELSE EXCLUDED.reason END,
       synced_to_brevo = suppression_list.synced_to_brevo OR EXCLUDED.synced_to_brevo`,
    [e, reason, source, campaignId, fromBrevo]
  );
  await query(
    `UPDATE contacts SET status = $2, status_changed_at = now(), updated_at = now()
     WHERE lower(email) = $1 AND status <> $2 AND NOT (status = 'bounced' AND $2 = 'unsubscribed')`,
    [e, STATUS_FOR_REASON[reason] || 'unsubscribed']
  );
  if (!fromBrevo) await enqueue('brevo.blocklist', { email: e }, { uniqueKey: `blocklist:${e}` });
}

export async function unsuppress(email) {
  const e = normalizeEmail(email);
  await query('DELETE FROM suppression_list WHERE lower(email) = $1', [e]);
  await query(
    "UPDATE contacts SET status = 'subscribed', status_changed_at = now(), updated_at = now() WHERE lower(email) = $1",
    [e]
  );
  await enqueue('brevo.unblocklist', { email: e }, { uniqueKey: `unblocklist:${e}` });
}

export async function isSuppressed(email) {
  return !!(await one('SELECT 1 FROM suppression_list WHERE lower(email) = $1', [normalizeEmail(email)]));
}
