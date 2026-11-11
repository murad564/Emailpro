// Campaign sending engine.
//
// Flow: confirm → recipients are snapshotted into campaign_recipients (unique per campaign+email, so an
// address can never get the same campaign twice) → split into batches → each batch runs as a background
// job: a Brevo list is created with exactly that batch's contacts, a Brevo email campaign is created for
// that list and sent with sendNow. Brevo then delivers; statistics come back via polling + webhooks.
import { one, many, query, tx } from './db.js';
import { buildWhere, CONTACT_FROM, normalizeFilters, describeFilters } from './filters.js';
import { enqueue, registerJob } from './jobs.js';
import { getSetting, setSetting, getBrevoApiKey } from './settings.js';
import { finalizeHtml, toBrevoSyntax, textToHtml, renderForContact, renderSubject } from './personalize.js';
import * as B from './brevo.js';
import { suppress } from './suppression.js';
import { HttpError, isValidEmail, normalizeEmail } from './util.js';

export async function log(campaignId, message, { level = 'info', batchId = null, data = null } = {}) {
  await query('INSERT INTO sending_logs (campaign_id, batch_id, level, message, data) VALUES ($1,$2,$3,$4,$5)', [
    campaignId, batchId, level, message, data ? JSON.stringify(data) : null,
  ]).catch((e) => console.error('log failed', e.message));
}

// ---------------- Audience ----------------

/** Turns a campaign's audience setting into contact filters. */
export async function audienceFilters(audience = {}) {
  const type = audience.type || 'all';
  if (type === 'all') return {};
  if (type === 'filters') return normalizeFilters(audience.filters || {});
  if (type === 'segment') {
    const s = await one('SELECT filters FROM segments WHERE id = $1', [audience.segment_id]);
    if (!s) throw new HttpError(400, 'The selected segment no longer exists.');
    return normalizeFilters(s.filters);
  }
  if (type === 'contacts') {
    const ids = (audience.contact_ids || []).map(Number).filter(Number.isFinite);
    if (!ids.length) throw new HttpError(400, 'No contacts selected.');
    return { contact_ids: ids };
  }
  throw new HttpError(400, 'Unknown audience type.');
}

export async function audienceLabel(audience = {}) {
  if (audience.type === 'segment') {
    const s = await one('SELECT name FROM segments WHERE id = $1', [audience.segment_id]);
    return `Segment: ${s?.name || 'deleted'}`;
  }
  if (audience.type === 'contacts') return `${(audience.contact_ids || []).length} selected contacts`;
  if (audience.type === 'filters') return describeFilters(audience.filters || {});
  return 'All subscribed contacts';
}

async function audienceSummary(audience) {
  const f = normalizeFilters(await audienceFilters(audience));
  const names = async (table, list) =>
    list.length ? (await one(`SELECT string_agg(name, ', ' ORDER BY name) AS n FROM ${table} WHERE id = ANY($1::int[])`, [list]))?.n || '' : '';
  return {
    countries: (await names('countries', f.country_ids)) || 'All countries',
    cities: (await names('cities', f.city_ids)) || 'All cities',
    categories: (await names('categories', f.category_ids)) || '',
    segment: audience.type === 'segment' ? (await one('SELECT name FROM segments WHERE id = $1', [audience.segment_id]))?.name || '' : '',
  };
}

/** SQL for contacts eligible to receive this campaign (subscribed, not suppressed, not already a recipient). */
async function eligibleSql(campaign) {
  const filters = await audienceFilters(campaign.audience);
  const { where, params } = buildWhere(filters);
  const extra = [
    `c.status = 'subscribed'`,
    `NOT EXISTS (SELECT 1 FROM suppression_list s WHERE lower(s.email) = lower(c.email))`,
    `NOT EXISTS (SELECT 1 FROM campaign_recipients r WHERE r.campaign_id = $${params.length + 1} AND lower(r.email) = lower(c.email))`,
  ];
  params.push(campaign.id || 0);
  const excl = (campaign.audience?.exclude_campaign_ids || []).map(Number).filter(Number.isFinite);
  if (excl.length) {
    params.push(excl);
    extra.push(`NOT EXISTS (SELECT 1 FROM campaign_recipients r2 WHERE r2.campaign_id = ANY($${params.length}::int[]) AND lower(r2.email) = lower(c.email) AND r2.status NOT IN ('cancelled','skipped','failed'))`);
  }
  return { sql: `${CONTACT_FROM} ${where ? where + ' AND ' : 'WHERE '} ${extra.join(' AND ')}`, params, filters };
}

export async function previewAudience(campaign) {
  const filters = await audienceFilters(campaign.audience);
  const { where, params } = buildWhere(filters);
  const all = await one(
    `SELECT count(*)::int AS matching,
            count(*) FILTER (WHERE c.status = 'unsubscribed')::int AS unsubscribed,
            count(*) FILTER (WHERE c.status = 'bounced')::int AS bounced
     ${CONTACT_FROM} ${where}`,
    params
  );
  const e = await eligibleSql(campaign);
  const eligible = (await one(`SELECT count(*)::int AS n ${e.sql}`, e.params)).n;
  const already = campaign.id
    ? (await one("SELECT count(*)::int AS n FROM campaign_recipients WHERE campaign_id = $1 AND status NOT IN ('cancelled')", [campaign.id])).n
    : 0;
  const limit = campaign.send_limit && campaign.send_limit > 0 ? campaign.send_limit : null;
  return {
    matching: all.matching,
    unsubscribed: all.unsubscribed,
    bounced: all.bounced,
    already_received: already,
    eligible,
    will_send: limit ? Math.min(limit, eligible) : eligible,
    limit,
    label: await audienceLabel(campaign.audience),
  };
}

// ---------------- Validation ----------------

export async function contentHtml(campaign) {
  if (campaign.editor_mode === 'text') return textToHtml(campaign.text_body);
  return campaign.html;
}

export async function validateForSend(campaign) {
  const problems = [];
  if (!campaign.subject?.trim()) problems.push('Email subject is empty.');
  if (!campaign.sender_name?.trim()) problems.push('Sender name is empty.');
  if (!isValidEmail(campaign.sender_email)) problems.push('Sender email is missing or invalid.');
  if (campaign.reply_to && !isValidEmail(campaign.reply_to)) problems.push('Reply-to email is invalid.');
  const body = campaign.editor_mode === 'text' ? campaign.text_body : campaign.html;
  if (!body?.trim()) problems.push('The email has no content.');
  const general = await getSetting('general');
  if (!general.company_address?.trim()) problems.push('Add your company postal address in Settings (required in the email footer).');
  if (!(await getBrevoApiKey())) problems.push('Brevo is not connected. Add your API key in Brevo Integration.');
  return problems;
}

// ---------------- Confirm & schedule ----------------

export async function confirmSend(campaignId, { scheduledAt = null, userEmail = '' } = {}) {
  const campaign = await one('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
  if (!campaign) throw new HttpError(404, 'Campaign not found.');
  if (['sending', 'scheduled'].includes(campaign.status)) throw new HttpError(409, 'This campaign is already scheduled or sending.');
  if (campaign.status === 'cancelled') throw new HttpError(409, 'This campaign was cancelled. Duplicate it to send again.');
  const problems = await validateForSend(campaign);
  if (problems.length) throw new HttpError(400, problems.join(' '), { problems });

  const preview = await previewAudience(campaign);
  if (preview.will_send < 1) throw new HttpError(400, 'No eligible recipients: everyone matching has unsubscribed, bounced, or already received this campaign.');

  // Quota check against the real Brevo account.
  try {
    const plan = B.summarizePlan(await B.getAccount());
    if (plan.credits_type === 'sendLimit' && typeof plan.credits === 'number' && plan.credits < preview.will_send) {
      throw new HttpError(400, `Your Brevo account has ${plan.credits} email credits left, but this send needs ${preview.will_send}. Lower the sending limit or add credits in Brevo.`);
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, `Could not verify your Brevo account before sending: ${e.message}`);
  }

  const start = scheduledAt ? new Date(scheduledAt) : new Date();
  if (scheduledAt && (isNaN(start) || start < new Date(Date.now() - 60_000))) throw new HttpError(400, 'Scheduled time must be in the future.');
  const label = await audienceLabel(campaign.audience);
  const summary = await audienceSummary(campaign.audience);

  const result = await tx(async (client) => {
    // Lock the campaign row so a double click can't create two sends.
    const locked = (await client.query('SELECT status FROM campaigns WHERE id = $1 FOR UPDATE', [campaignId])).rows[0];
    if (['sending', 'scheduled'].includes(locked.status)) throw new HttpError(409, 'This campaign is already scheduled or sending.');

    const e = await eligibleSql(campaign);
    const order = campaign.randomize ? 'random()' : 'c.created_at, c.id';
    const limit = preview.limit ? `LIMIT ${preview.limit}` : '';
    const contacts = (await client.query(`SELECT c.id, c.email ${e.sql} ORDER BY ${order} ${limit}`, e.params)).rows;
    if (!contacts.length) throw new HttpError(400, 'No eligible recipients.');

    const batchSize = campaign.batch_size && campaign.batch_size > 0 ? campaign.batch_size : contacts.length;
    const nBatches = Math.ceil(contacts.length / batchSize);
    const prevBatches = (await client.query('SELECT coalesce(max(batch_no),0)::int AS n FROM campaign_batches WHERE campaign_id = $1', [campaignId])).rows[0].n;
    const interval = Math.max(5, campaign.batch_interval_minutes || 60);
    const batches = [];
    for (let i = 0; i < nBatches; i++) {
      const part = contacts.slice(i * batchSize, (i + 1) * batchSize);
      const runAt = new Date(start.getTime() + i * interval * 60_000);
      const b = (await client.query(
        'INSERT INTO campaign_batches (campaign_id, batch_no, recipient_count, run_at) VALUES ($1,$2,$3,$4) RETURNING id, run_at',
        [campaignId, prevBatches + i + 1, part.length, runAt]
      )).rows[0];
      await client.query(
        `INSERT INTO campaign_recipients (campaign_id, batch_id, contact_id, email)
         SELECT $1, $2, x.id, x.email FROM unnest($3::bigint[], $4::text[]) AS x(id, email)
         ON CONFLICT (campaign_id, lower(email)) DO NOTHING`,
        [campaignId, b.id, part.map((p) => p.id), part.map((p) => p.email)]
      );
      batches.push(b);
    }
    const audience = { ...campaign.audience, summary };
    await client.query(
      `UPDATE campaigns SET status = $2, scheduled_at = $3, audience_label = $4, audience = $5, error = NULL, updated_at = now() WHERE id = $1`,
      [campaignId, scheduledAt ? 'scheduled' : 'sending', scheduledAt ? start : null, label, JSON.stringify(audience)]
    );
    return { recipients: contacts.length, batches };
  });

  for (const b of result.batches) await enqueue('batch.send', { batch_id: b.id }, { runAt: b.run_at, uniqueKey: `batch:${b.id}`, maxAttempts: 4 });
  await log(campaignId, `${scheduledAt ? 'Scheduled' : 'Started'} send to ${result.recipients} recipients in ${result.batches.length} batch(es)${userEmail ? ` by ${userEmail}` : ''}.`);
  return { recipients: result.recipients, batches: result.batches.length, scheduled_at: scheduledAt ? start : null };
}

// ---------------- Batch processing ----------------

async function brevoFolderId() {
  const b = await getSetting('brevo');
  if (b.folder_id) return b.folder_id;
  const id = await B.ensureFolder('Aristokrat Mail');
  await setSetting('brevo', { ...(await getSetting('brevo')), folder_id: id });
  return id;
}

async function ensureAttributesOnce() {
  const b = await getSetting('brevo');
  if (b.attributes_ok) return;
  await B.ensureAttributes();
  await setSetting('brevo', { ...(await getSetting('brevo')), attributes_ok: true });
}

function permanent(e) {
  // 4xx from Brevo (except rate limit) won't fix themselves by retrying.
  if (e instanceof B.BrevoError && e.status >= 400 && e.status < 500 && e.status !== 429) e.permanent = true;
  if (e instanceof HttpError && e.status < 500) e.permanent = true;
  return e;
}

async function processBatch({ batch_id }) {
  const batch = await one('SELECT * FROM campaign_batches WHERE id = $1', [batch_id]);
  if (!batch || !['pending', 'processing'].includes(batch.status)) return;
  const campaign = await one('SELECT * FROM campaigns WHERE id = $1', [batch.campaign_id]);
  if (!campaign) return;
  if (campaign.status === 'paused') return; // resumed later by resumeCampaign
  if (campaign.status === 'cancelled') return;

  await query("UPDATE campaign_batches SET status = 'processing' WHERE id = $1", [batch.id]);
  if (campaign.status === 'scheduled') await query("UPDATE campaigns SET status = 'sending', updated_at = now() WHERE id = $1", [campaign.id]);

  try {
    // Re-check at send time: anyone who unsubscribed/bounced since confirmation is skipped.
    const skipped = await query(
      `UPDATE campaign_recipients r SET status = 'skipped', error = 'Unsubscribed or suppressed before sending'
       WHERE r.batch_id = $1 AND r.status = 'queued' AND (
         EXISTS (SELECT 1 FROM suppression_list s WHERE lower(s.email) = lower(r.email)) OR
         EXISTS (SELECT 1 FROM contacts c WHERE c.id = r.contact_id AND c.status <> 'subscribed') OR
         r.contact_id IS NULL)`,
      [batch.id]
    );
    if (skipped.rowCount) await log(campaign.id, `Skipped ${skipped.rowCount} recipient(s) who unsubscribed or bounced before sending.`, { batchId: batch.id });

    const recipients = await many(
      `SELECT c.email, c.first_name, c.last_name, c.company, c.language, co.name AS country, ci.name AS city, ca.name AS category
       FROM campaign_recipients r JOIN contacts c ON c.id = r.contact_id
       LEFT JOIN countries co ON co.id = c.country_id LEFT JOIN cities ci ON ci.id = c.city_id LEFT JOIN categories ca ON ca.id = c.category_id
       WHERE r.batch_id = $1 AND r.status = 'queued'`,
      [batch.id]
    );
    if (!recipients.length) {
      await query("UPDATE campaign_batches SET status = 'sent', sent_at = now(), recipient_count = 0 WHERE id = $1", [batch.id]);
      await refreshCampaignStatus(campaign.id);
      return;
    }

    // Retry safety: if Brevo already has this batch's campaign, don't create a second one.
    if (batch.brevo_campaign_id) {
      const existing = await B.getCampaign(batch.brevo_campaign_id).catch(() => null);
      if (existing && ['sent', 'in_process', 'queued'].includes(existing.status)) {
        await markBatchSent(batch, campaign);
        return;
      }
      if (existing) {
        await B.sendCampaignNow(batch.brevo_campaign_id);
        await markBatchSent(batch, campaign);
        return;
      }
    }

    await ensureAttributesOnce();
    const folderId = await brevoFolderId();
    let listId = batch.brevo_list_id;
    if (!listId) {
      listId = await B.createList(`AM #${campaign.id} ${campaign.name.slice(0, 60)} - batch ${batch.batch_no} (${new Date().toISOString().slice(0, 16)})`, folderId);
      await query('UPDATE campaign_batches SET brevo_list_id = $2 WHERE id = $1', [batch.id, listId]);
    }
    await log(campaign.id, `Uploading ${recipients.length} contacts to Brevo list #${listId}…`, { batchId: batch.id });
    await B.importContactsToList(recipients, listId);
    const list = await B.getList(listId).catch(() => null);
    const inList = list?.uniqueSubscribers ?? list?.totalSubscribers ?? null;
    await log(campaign.id, `Brevo list #${listId} ready${inList !== null ? ` with ${inList} contacts` : ''}.`, { batchId: batch.id });

    const general = await getSetting('general');
    const html = toBrevoSyntax(finalizeHtml(await contentHtml(campaign), { preheader: campaign.preheader, general }), general.default_fallbacks || {});
    const subject = toBrevoSyntax(campaign.subject, general.default_fallbacks || {});
    const totalBatches = (await one('SELECT count(*)::int AS n FROM campaign_batches WHERE campaign_id = $1', [campaign.id])).n;
    const brevoId = await B.createEmailCampaign({
      name: `[AM#${campaign.id}] ${campaign.name}${totalBatches > 1 ? ` - batch ${batch.batch_no}/${totalBatches}` : ''}`.slice(0, 250),
      subject,
      senderName: campaign.sender_name,
      senderEmail: campaign.sender_email,
      replyTo: campaign.reply_to || undefined,
      html,
      listId,
    });
    await query('UPDATE campaign_batches SET brevo_campaign_id = $2 WHERE id = $1', [batch.id, brevoId]);

    // Last check before the irreversible step.
    const now = await one('SELECT status FROM campaigns WHERE id = $1', [campaign.id]);
    if (['paused', 'cancelled'].includes(now.status)) {
      await query("UPDATE campaign_batches SET status = $2 WHERE id = $1", [batch.id, now.status === 'cancelled' ? 'cancelled' : 'pending']);
      await log(campaign.id, `Batch ${batch.batch_no} held because the campaign was ${now.status}.`, { batchId: batch.id, level: 'warn' });
      return;
    }
    await B.sendCampaignNow(brevoId);
    await markBatchSent({ ...batch, brevo_campaign_id: brevoId }, campaign);
  } catch (e) {
    throw permanent(e);
  }
}

async function markBatchSent(batch, campaign) {
  await tx(async (c) => {
    await c.query("UPDATE campaign_batches SET status = 'sent', sent_at = now(), error = NULL WHERE id = $1", [batch.id]);
    const r = await c.query("UPDATE campaign_recipients SET status = 'sent', sent_at = now() WHERE batch_id = $1 AND status = 'queued'", [batch.id]);
    await c.query('UPDATE campaign_batches SET recipient_count = (SELECT count(*) FROM campaign_recipients WHERE batch_id = $1 AND status <> $2) WHERE id = $1', [batch.id, 'skipped']);
    await c.query('UPDATE campaigns SET sent_at = COALESCE(sent_at, now()) WHERE id = $1', [campaign.id]);
    return r.rowCount;
  });
  await log(campaign.id, `Batch ${batch.batch_no} handed to Brevo (campaign #${batch.brevo_campaign_id}) and sending.`, { batchId: batch.id });
  await refreshCampaignStatus(campaign.id);
  await enqueue('campaign.sync_stats', { campaign_id: campaign.id }, { runAt: new Date(Date.now() + 5 * 60_000), uniqueKey: `stats:${campaign.id}` });
}

async function batchFailed({ batch_id }, err) {
  const batch = await one('SELECT * FROM campaign_batches WHERE id = $1', [batch_id]);
  if (!batch) return;
  await query("UPDATE campaign_batches SET status = 'failed', error = $2 WHERE id = $1", [batch_id, err.message]);
  await query("UPDATE campaign_recipients SET status = 'failed', error = $2 WHERE batch_id = $1 AND status = 'queued'", [batch_id, err.message]);
  await log(batch.campaign_id, `Batch ${batch.batch_no} failed: ${err.message}`, { level: 'error', batchId: batch_id });
  await query('UPDATE campaigns SET error = $2 WHERE id = $1', [batch.campaign_id, err.message]);
  await refreshCampaignStatus(batch.campaign_id);
}

export async function refreshCampaignStatus(campaignId) {
  const c = await one('SELECT status FROM campaigns WHERE id = $1', [campaignId]);
  if (!c || ['paused', 'draft'].includes(c.status)) return;
  const s = await one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('pending','processing'))::int AS open,
            count(*) FILTER (WHERE status = 'sent')::int AS sent,
            count(*) FILTER (WHERE status = 'failed')::int AS failed,
            count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
     FROM campaign_batches WHERE campaign_id = $1`,
    [campaignId]
  );
  if (!s.total || s.open) return;
  let status = 'sent';
  if (s.sent === 0 && s.failed > 0) status = 'failed';
  else if (s.sent === 0 && s.cancelled > 0) status = 'cancelled';
  else if (s.failed > 0 || s.cancelled > 0) status = 'partially_sent';
  await query('UPDATE campaigns SET status = $2, updated_at = now() WHERE id = $1', [campaignId, status]);
}

// ---------------- Pause / resume / cancel ----------------

export async function pauseCampaign(id) {
  const c = await one('SELECT status FROM campaigns WHERE id = $1', [id]);
  if (!c) throw new HttpError(404, 'Campaign not found.');
  if (!['sending', 'scheduled'].includes(c.status)) throw new HttpError(409, 'Only scheduled or sending campaigns can be paused.');
  const pending = (await one("SELECT count(*)::int AS n FROM campaign_batches WHERE campaign_id = $1 AND status = 'pending'", [id])).n;
  if (!pending) throw new HttpError(409, 'All batches have already been handed to Brevo; nothing left to pause.');
  await query("UPDATE campaigns SET status = 'paused', updated_at = now() WHERE id = $1", [id]);
  await log(id, `Paused. ${pending} batch(es) on hold.`, { level: 'warn' });
  return { paused_batches: pending };
}

export async function resumeCampaign(id) {
  const c = await one('SELECT status FROM campaigns WHERE id = $1', [id]);
  if (c?.status !== 'paused') throw new HttpError(409, 'Campaign is not paused.');
  if (!(await getBrevoApiKey())) throw new HttpError(400, 'Brevo is not connected.');
  const batches = await many("SELECT id, run_at FROM campaign_batches WHERE campaign_id = $1 AND status = 'pending' ORDER BY batch_no", [id]);
  await query("UPDATE campaigns SET status = 'sending', updated_at = now() WHERE id = $1", [id]);
  const now = Date.now();
  const interval = (await one('SELECT batch_interval_minutes FROM campaigns WHERE id = $1', [id])).batch_interval_minutes || 60;
  let i = 0;
  for (const b of batches) {
    const runAt = new Date(Math.max(new Date(b.run_at).getTime(), now + i * interval * 60_000));
    await query('UPDATE campaign_batches SET run_at = $2 WHERE id = $1', [b.id, runAt]);
    await query("DELETE FROM jobs WHERE unique_key = $1 AND status = 'pending'", [`batch:${b.id}`]);
    await enqueue('batch.send', { batch_id: b.id }, { runAt, uniqueKey: `batch:${b.id}`, maxAttempts: 4 });
    i++;
  }
  await log(id, `Resumed. ${batches.length} batch(es) re-queued.`);
  return { resumed_batches: batches.length };
}

export async function cancelCampaign(id) {
  const c = await one('SELECT status FROM campaigns WHERE id = $1', [id]);
  if (!c) throw new HttpError(404, 'Campaign not found.');
  if (!['sending', 'scheduled', 'paused'].includes(c.status)) throw new HttpError(409, 'Only scheduled, sending or paused campaigns can be cancelled.');
  const r = await tx(async (cl) => {
    const b = await cl.query("UPDATE campaign_batches SET status = 'cancelled' WHERE campaign_id = $1 AND status = 'pending' RETURNING id", [id]);
    const rec = await cl.query("UPDATE campaign_recipients SET status = 'cancelled' WHERE campaign_id = $1 AND status = 'queued' AND batch_id = ANY($2::int[])", [id, b.rows.map((x) => x.id)]);
    await cl.query("DELETE FROM jobs WHERE unique_key = ANY($1::text[]) AND status = 'pending'", [b.rows.map((x) => `batch:${x.id}`)]);
    return { batches: b.rowCount, recipients: rec.rowCount };
  });
  const processing = (await one("SELECT count(*)::int AS n FROM campaign_batches WHERE campaign_id = $1 AND status = 'processing'", [id])).n;
  await query("UPDATE campaigns SET status = 'cancelled', updated_at = now() WHERE id = $1", [id]);
  await log(id, `Cancelled. ${r.recipients} queued recipient(s) will not be emailed.${processing ? ' One batch was already being handed to Brevo and may still send.' : ''}`, { level: 'warn' });
  await refreshCampaignStatus(id).catch(() => {});
  // refreshCampaignStatus may set partially_sent if earlier batches went out; otherwise it stays cancelled.
  return { ...r, in_flight: processing };
}

// ---------------- Statistics ----------------

const STAT_KEYS = ['sent', 'delivered', 'unique_opens', 'opens', 'unique_clicks', 'soft_bounces', 'hard_bounces', 'unsubscriptions', 'complaints', 'deferred'];

export async function syncCampaignStats(campaignId) {
  const batches = await many('SELECT id, brevo_campaign_id FROM campaign_batches WHERE campaign_id = $1 AND brevo_campaign_id IS NOT NULL', [campaignId]);
  const total = Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
  let errors = 0;
  for (const b of batches) {
    try {
      const s = B.normalizeStats(await B.getCampaign(b.brevo_campaign_id));
      await query('UPDATE campaign_batches SET stats = $2 WHERE id = $1', [b.id, JSON.stringify(s)]);
      for (const k of STAT_KEYS) total[k] += s[k] || 0;
    } catch (e) {
      errors++;
      const prev = (await one('SELECT stats FROM campaign_batches WHERE id = $1', [b.id]))?.stats || {};
      for (const k of STAT_KEYS) total[k] += prev[k] || 0;
      await log(campaignId, `Could not refresh Brevo statistics for batch: ${e.message}`, { level: 'warn', batchId: b.id });
    }
  }
  const local = await localRecipientStats(campaignId);
  const stats = {
    ...total,
    recipients: local.total,
    failed: local.failed,
    skipped: local.skipped,
    // Webhook-tracked counts never exceed Brevo's totals, but if webhooks arrive before polling we keep the higher.
    delivered: Math.max(total.delivered, local.delivered),
    unique_opens: Math.max(total.unique_opens, local.opened),
    unique_clicks: Math.max(total.unique_clicks, local.clicked),
    hard_bounces: Math.max(total.hard_bounces, local.hard_bounce),
    soft_bounces: Math.max(total.soft_bounces, local.soft_bounce),
    unsubscriptions: Math.max(total.unsubscriptions, local.unsubscribed),
    complaints: Math.max(total.complaints, local.spam),
  };
  await query('UPDATE campaigns SET stats = $2, stats_synced_at = now() WHERE id = $1', [campaignId, JSON.stringify(stats)]);
  return { stats, errors };
}

export async function localRecipientStats(campaignId) {
  return one(
    `SELECT count(*) FILTER (WHERE status NOT IN ('cancelled','skipped'))::int AS total,
            count(*) FILTER (WHERE status IN ('sent','delivered','soft_bounce','hard_bounce'))::int AS sent,
            count(*) FILTER (WHERE delivered_at IS NOT NULL OR status = 'delivered')::int AS delivered,
            count(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened,
            count(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked,
            count(*) FILTER (WHERE status = 'hard_bounce')::int AS hard_bounce,
            count(*) FILTER (WHERE status = 'soft_bounce')::int AS soft_bounce,
            count(*) FILTER (WHERE unsubscribed_at IS NOT NULL)::int AS unsubscribed,
            count(*) FILTER (WHERE spam_at IS NOT NULL)::int AS spam,
            count(*) FILTER (WHERE status = 'failed')::int AS failed,
            count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
            count(*) FILTER (WHERE status = 'queued')::int AS queued,
            count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
     FROM campaign_recipients WHERE campaign_id = $1`,
    [campaignId]
  );
}

async function syncRecentStats() {
  if (!(await getBrevoApiKey())) return;
  const rows = await many(
    `SELECT DISTINCT b.campaign_id FROM campaign_batches b
     WHERE b.brevo_campaign_id IS NOT NULL AND b.sent_at > now() - interval '30 days'`
  );
  for (const r of rows) await syncCampaignStats(r.campaign_id).catch((e) => console.error('stats sync', e.message));
}

// ---------------- Webhooks from Brevo ----------------

export async function handleWebhookEvent(ev) {
  const raw = String(ev.event || '').toLowerCase().replace(/[_\s-]/g, '');
  const email = normalizeEmail(ev.email);
  const campId = Number(ev.camp_id ?? ev.campaign_id ?? ev['camp id']) || null;
  await query('INSERT INTO webhook_events (event, email, brevo_campaign_id, payload) VALUES ($1,$2,$3,$4)', [raw, email, campId, JSON.stringify(ev)]);
  if (!email) return;

  const batch = campId ? await one('SELECT id, campaign_id FROM campaign_batches WHERE brevo_campaign_id = $1', [campId]) : null;
  const at = ev.date_event || ev.ts_event ? new Date(ev.ts_event ? ev.ts_event * 1000 : ev.date_event) : new Date();
  const when = isNaN(at) ? new Date() : at;
  const upd = async (sql) => {
    if (batch) await query(`UPDATE campaign_recipients SET ${sql} WHERE campaign_id = $1 AND lower(email) = $2`, [batch.campaign_id, email, when]);
  };

  if (raw === 'delivered') await upd("status = CASE WHEN status IN ('sent','queued') THEN 'delivered' ELSE status END, delivered_at = COALESCE(delivered_at, $3)");
  else if (['opened', 'open', 'uniqueopened', 'proxyopen', 'uniqueproxyopen'].includes(raw)) await upd('opened_at = COALESCE(opened_at, $3)');
  else if (['click', 'clicks', 'clicked'].includes(raw)) await upd('clicked_at = COALESCE(clicked_at, $3), opened_at = COALESCE(opened_at, $3)');
  else if (['hardbounce', 'invalidemail', 'blocked'].includes(raw)) {
    await upd("status = 'hard_bounce', bounced_at = COALESCE(bounced_at, $3), error = 'Hard bounce'");
    await suppress(email, 'hard_bounce', { source: 'Brevo hard bounce', campaignId: batch?.campaign_id, fromBrevo: true });
  } else if (raw === 'softbounce') await upd("status = CASE WHEN status IN ('sent','queued') THEN 'soft_bounce' ELSE status END, bounced_at = COALESCE(bounced_at, $3)");
  else if (['unsubscribe', 'unsubscribed'].includes(raw)) {
    await upd('unsubscribed_at = COALESCE(unsubscribed_at, $3)');
    await suppress(email, 'unsubscribed', { source: 'Unsubscribe link (Brevo)', campaignId: batch?.campaign_id, fromBrevo: true });
  } else if (['spam', 'complaint'].includes(raw)) {
    await upd('spam_at = COALESCE(spam_at, $3)');
    await suppress(email, 'spam', { source: 'Marked as spam (Brevo)', campaignId: batch?.campaign_id, fromBrevo: true });
  }
}

// ---------------- Test email ----------------

export async function sendTestEmail(campaignLike, to, { contactId = null } = {}) {
  if (!isValidEmail(to)) throw new HttpError(400, 'Enter a valid email address for the test.');
  if (!isValidEmail(campaignLike.sender_email)) throw new HttpError(400, 'Set a valid sender email first.');
  if (!(await getBrevoApiKey())) throw new HttpError(400, 'Brevo is not connected.');
  const general = await getSetting('general');
  let sample = contactId
    ? await one(`SELECT c.*, co.name AS country, ci.name AS city FROM contacts c LEFT JOIN countries co ON co.id = c.country_id LEFT JOIN cities ci ON ci.id = c.city_id WHERE c.id = $1`, [contactId])
    : null;
  sample = sample || { first_name: '', last_name: '', company: '', country: '', city: '', email: to };
  const body = campaignLike.editor_mode === 'text' ? textToHtml(campaignLike.text_body) : campaignLike.html;
  if (!String(body || '').trim()) throw new HttpError(400, 'The email has no content yet.');
  const html = renderForContact(finalizeHtml(body, { preheader: campaignLike.preheader, general }), sample, general.default_fallbacks || {}, {
    unsubscribeUrl: '#unsubscribe-link-is-active-in-real-campaigns',
  });
  const subject = `[TEST] ${renderSubject(campaignLike.subject || '(no subject)', sample, general.default_fallbacks || {})}`;
  const r = await B.sendTransactional({
    to, subject, html, senderName: campaignLike.sender_name || general.company_name, senderEmail: campaignLike.sender_email,
    replyTo: campaignLike.reply_to || undefined,
  });
  return { message_id: r?.messageId || null };
}

// ---------------- Suppression sync with Brevo ----------------

async function pullBrevoBlocklist() {
  if (!(await getBrevoApiKey())) return;
  const b = await getSetting('brevo');
  const since = b.blocklist_synced_at || new Date(Date.now() - 365 * 86400_000).toISOString();
  const started = new Date().toISOString();
  let offset = 0;
  let added = 0;
  for (let page = 0; page < 200; page++) {
    const res = await B.listContactsModifiedSince(since, offset, 1000);
    const contacts = res?.contacts || [];
    for (const c of contacts) {
      if (c.emailBlacklisted && c.email) {
        const exists = await one('SELECT reason FROM suppression_list WHERE lower(email) = lower($1)', [c.email]);
        if (!exists) {
          await suppress(c.email, 'brevo_blocklist', { source: 'Blocklisted in Brevo', fromBrevo: true });
          added++;
        }
      }
    }
    if (contacts.length < 1000) break;
    offset += 1000;
  }
  await setSetting('brevo', { ...(await getSetting('brevo')), blocklist_synced_at: started, blocklist_last_added: added });
  return added;
}

async function pushPendingSuppressions() {
  if (!(await getBrevoApiKey())) return;
  const rows = await many('SELECT email FROM suppression_list WHERE synced_to_brevo = FALSE ORDER BY id LIMIT 500');
  for (const r of rows) {
    await B.blocklistEmail(r.email);
    await query('UPDATE suppression_list SET synced_to_brevo = TRUE WHERE lower(email) = lower($1)', [r.email]);
  }
  return rows.length;
}

// ---------------- Job registration ----------------

export function registerSenderJobs() {
  registerJob('batch.send', processBatch);
  registerJob('batch.send:failed', batchFailed);
  registerJob('campaign.sync_stats', async ({ campaign_id }) => {
    await syncCampaignStats(campaign_id);
  });
  registerJob('stats.sync_recent', async () => {
    await syncRecentStats();
    await enqueue('stats.sync_recent', {}, { runAt: new Date(Date.now() + 15 * 60_000), uniqueKey: 'stats.sync_recent' });
  });
  registerJob('brevo.suppression_sync', async () => {
    try {
      await pushPendingSuppressions();
      await pullBrevoBlocklist();
    } finally {
      await enqueue('brevo.suppression_sync', {}, { runAt: new Date(Date.now() + 6 * 3600_000), uniqueKey: 'brevo.suppression_sync' });
    }
  });
  registerJob('brevo.blocklist', async ({ email }) => {
    if (!(await getBrevoApiKey())) return; // pushed later by the periodic sync once connected
    await B.blocklistEmail(email);
    await query('UPDATE suppression_list SET synced_to_brevo = TRUE WHERE lower(email) = lower($1)', [email]);
  });
  registerJob('brevo.unblocklist', async ({ email }) => {
    if (!(await getBrevoApiKey())) return;
    await B.unblocklistEmail(email);
  });
}

export async function scheduleRecurring() {
  await enqueue('stats.sync_recent', {}, { runAt: new Date(Date.now() + 60_000), uniqueKey: 'stats.sync_recent' });
  await enqueue('brevo.suppression_sync', {}, { runAt: new Date(Date.now() + 2 * 60_000), uniqueKey: 'brevo.suppression_sync' });
}

export { pullBrevoBlocklist, pushPendingSuppressions };
