import { Router } from 'express';
import { one, many } from '../db.js';
import { asyncH, HttpError } from '../util.js';
import { requireAdmin } from '../auth.js';
import { getSetting, setSetting, saveBrevoApiKey, clearBrevoApiKey, getBrevoApiKey, getWebhookToken, appUrl } from '../settings.js';
import * as B from '../brevo.js';
import { enqueue, registerJob } from '../jobs.js';
import { pullBrevoBlocklist, pushPendingSuppressions } from '../sender.js';

const r = Router();

let accountCache = { at: 0, data: null };
export async function cachedAccount(force = false) {
  if (!force && accountCache.data && Date.now() - accountCache.at < 5 * 60_000) return accountCache.data;
  const acc = await B.getAccount();
  accountCache = { at: Date.now(), data: acc };
  return acc;
}

r.get('/status', asyncH(async (req, res) => {
  const b = await getSetting('brevo');
  const key = await getBrevoApiKey();
  const out = {
    configured: !!key,
    from_env: !!process.env.BREVO_API_KEY,
    key_hint: process.env.BREVO_API_KEY ? 'set on server' : b.key_hint || null,
    webhook: b.webhook || null,
    blocklist_synced_at: b.blocklist_synced_at || null,
    contacts_sync: b.contacts_sync || null,
    app_url: appUrl() || null,
  };
  if (key) {
    try {
      const acc = await cachedAccount(req.query.refresh === '1');
      out.connected = true;
      out.account = { email: acc.email, company: acc.companyName, first_name: acc.firstName, last_name: acc.lastName };
      out.plan = B.summarizePlan(acc);
    } catch (e) {
      out.connected = false;
      out.error = e.message;
    }
  }
  res.json(out);
}));

r.post('/key', requireAdmin, asyncH(async (req, res) => {
  const apiKey = String(req.body.api_key || '').trim();
  if (!apiKey) throw new HttpError(400, 'Paste your Brevo API key.');
  if (!/^xkeysib-/.test(apiKey)) throw new HttpError(400, 'That does not look like a Brevo API key (it should start with "xkeysib-"). SMTP keys do not work here.');
  let acc;
  try {
    acc = await B.getAccount(apiKey);
  } catch (e) {
    throw new HttpError(400, `Brevo rejected this key: ${e.message}`);
  }
  await saveBrevoApiKey(apiKey);
  accountCache = { at: 0, data: null };
  const b = await getSetting('brevo');
  await setSetting('brevo', { ...b, attributes_ok: false, folder_id: null });
  // Prepare account in the background: attributes, webhook.
  await enqueue('brevo.setup', {}, { uniqueKey: 'brevo.setup' });
  res.json({ ok: true, account: { email: acc.email, company: acc.companyName }, plan: B.summarizePlan(acc) });
}));

r.delete('/key', requireAdmin, asyncH(async (req, res) => {
  await clearBrevoApiKey();
  accountCache = { at: 0, data: null };
  res.json({ ok: true });
}));

r.post('/test', asyncH(async (req, res) => {
  const t0 = Date.now();
  const acc = await cachedAccount(true);
  res.json({ ok: true, ms: Date.now() - t0, account: { email: acc.email, company: acc.companyName }, plan: B.summarizePlan(acc) });
}));

r.get('/senders', asyncH(async (req, res) => {
  const s = await B.getSenders();
  res.json({ senders: (s?.senders || []).map((x) => ({ id: x.id, name: x.name, email: x.email, active: x.active })) });
}));

r.post('/webhook', requireAdmin, asyncH(async (req, res) => {
  res.json(await setupWebhook());
}));

r.post('/sync-suppression', asyncH(async (req, res) => {
  const pushed = await pushPendingSuppressions();
  const pulled = await pullBrevoBlocklist();
  res.json({ pushed: pushed || 0, pulled: pulled || 0 });
}));

r.post('/sync-contacts', requireAdmin, asyncH(async (req, res) => {
  const id = await enqueue('brevo.sync_all_contacts', {}, { uniqueKey: 'brevo.sync_all_contacts', maxAttempts: 2 });
  if (!id) throw new HttpError(409, 'A contact sync is already running.');
  const b = await getSetting('brevo');
  await setSetting('brevo', { ...b, contacts_sync: { status: 'queued', at: new Date().toISOString() } });
  res.json({ queued: true });
}));

async function setupWebhook() {
  const base = appUrl();
  if (!base || /localhost|127\.0\.0\.1/.test(base)) {
    return { ok: false, message: 'Webhooks need the app to be online at a public https address (APP_URL).' };
  }
  const token = await getWebhookToken();
  const url = `${base}/api/webhooks/brevo/${token}`;
  const out = await B.ensureMarketingWebhook(url);
  const b = await getSetting('brevo');
  await setSetting('brevo', { ...b, webhook: { id: out.id, url: url.replace(token, '••••'), at: new Date().toISOString() } });
  return { ok: true, ...out };
}

export function registerBrevoJobs() {
  registerJob('brevo.setup', async () => {
    await B.ensureAttributes();
    const b = await getSetting('brevo');
    await setSetting('brevo', { ...b, attributes_ok: true });
    await setupWebhook().catch((e) => console.error('webhook setup failed', e.message));
  });
  registerJob('brevo.sync_all_contacts', async () => {
    const setStatus = async (v) => setSetting('brevo', { ...(await getSetting('brevo')), contacts_sync: { ...v, at: new Date().toISOString() } });
    await setStatus({ status: 'running' });
    try {
      await B.ensureAttributes();
      const folder = await B.ensureFolder('Aristokrat Mail');
      const b = await getSetting('brevo');
      let listId = b.all_list_id;
      if (listId) await B.getList(listId).catch(() => (listId = null));
      if (!listId) {
        listId = await B.createList('Aristokrat Mail - All subscribed contacts', folder);
        await setSetting('brevo', { ...(await getSetting('brevo')), all_list_id: listId });
      }
      const contacts = await many(
        `SELECT c.email, c.first_name, c.last_name, c.company, c.language, co.name AS country, ci.name AS city, ca.name AS category
         FROM contacts c LEFT JOIN countries co ON co.id = c.country_id LEFT JOIN cities ci ON ci.id = c.city_id LEFT JOIN categories ca ON ca.id = c.category_id
         WHERE c.status = 'subscribed' AND NOT EXISTS (SELECT 1 FROM suppression_list s WHERE lower(s.email) = lower(c.email))`
      );
      await B.importContactsToList(contacts, listId);
      await setStatus({ status: 'done', count: contacts.length, list_id: listId });
    } catch (e) {
      await setStatus({ status: 'failed', error: e.message });
      throw e;
    }
  });
}

export default r;
