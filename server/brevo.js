// Thin client for the official Brevo REST API v3 (https://developers.brevo.com/reference).
// Runs only on the server. The API key is read from encrypted settings or the BREVO_API_KEY env var.
import { getBrevoApiKey } from './settings.js';
import { HttpError, sleep } from './util.js';

const BASE = (process.env.BREVO_BASE_URL || 'https://api.brevo.com/v3').replace(/\/$/, '');
const MIN_GAP_MS = Number(process.env.BREVO_MIN_GAP_MS || 120); // stay well under Brevo's per-second rate limits
let lastCall = 0;
let chain = Promise.resolve();

export class BrevoError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function throttle() {
  // Serialise calls so we never burst; each call waits MIN_GAP_MS after the previous.
  const p = chain.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
  });
  chain = p.catch(() => {});
  return p;
}

export async function brevo(method, path, body, { apiKey, retries = 4 } = {}) {
  const key = apiKey || (await getBrevoApiKey());
  if (!key) throw new HttpError(400, 'Brevo is not connected. Add your API key in Brevo Integration.');
  for (let attempt = 0; ; attempt++) {
    await throttle();
    let res;
    try {
      res = await fetch(BASE + path, {
        method,
        headers: {
          'api-key': key,
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      if (attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new BrevoError(0, `Could not reach Brevo: ${e.message}`);
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (res.ok) return data;
    // 429: rate limited. 5xx: transient. Back off and retry.
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const reset = Number(res.headers.get('x-sib-ratelimit-reset') || res.headers.get('retry-after'));
      await sleep(Number.isFinite(reset) && reset > 0 ? Math.min(reset, 60) * 1000 : 1500 * 2 ** attempt);
      continue;
    }
    const msg = (data && (data.message || data.code)) || `HTTP ${res.status}`;
    throw new BrevoError(res.status, `Brevo: ${msg}`, data);
  }
}

// ---------- Account / senders ----------
export const getAccount = (apiKey) => brevo('GET', '/account', undefined, { apiKey, retries: 1 });
export const getSenders = () => brevo('GET', '/senders');

/** Extract a human summary of email credits from /account. */
export function summarizePlan(account) {
  const plans = account?.plan || [];
  const email = plans.find((p) => p.creditsType === 'sendLimit') || plans[0] || null;
  return {
    plan_type: email?.type || null,
    credits: typeof email?.credits === 'number' ? email.credits : null,
    credits_type: email?.creditsType || null,
    plan_end: email?.endDate || null,
    all: plans,
  };
}

// ---------- Contacts / lists ----------
export const STANDARD_ATTRIBUTES = ['FIRSTNAME', 'LASTNAME', 'COMPANY_NAME', 'COUNTRY', 'CITY', 'LANGUAGE', 'CATEGORY'];

export async function ensureAttributes() {
  const existing = await brevo('GET', '/contacts/attributes');
  const names = new Set((existing?.attributes || []).map((a) => String(a.name).toUpperCase()));
  for (const name of STANDARD_ATTRIBUTES) {
    if (names.has(name)) continue;
    try {
      await brevo('POST', `/contacts/attributes/normal/${name}`, { type: 'text' });
    } catch (e) {
      if (!(e instanceof BrevoError && e.status === 400)) throw e; // 400 = already exists
    }
  }
}

export async function ensureFolder(name = 'Aristokrat Mail') {
  const res = await brevo('GET', '/contacts/folders?limit=50&offset=0');
  const found = (res?.folders || []).find((f) => f.name === name);
  if (found) return found.id;
  const created = await brevo('POST', '/contacts/folders', { name });
  return created.id;
}

export async function createList(name, folderId) {
  const r = await brevo('POST', '/contacts/lists', { name, folderId });
  return r.id;
}

export const getList = (id) => brevo('GET', `/contacts/lists/${id}`);

export function contactToBrevo(c) {
  return {
    email: c.email,
    attributes: {
      FIRSTNAME: c.first_name || '',
      LASTNAME: c.last_name || '',
      COMPANY_NAME: c.company || '',
      COUNTRY: c.country || '',
      CITY: c.city || '',
      LANGUAGE: c.language || '',
      CATEGORY: c.category || '',
    },
  };
}

/** Imports contacts into a list and waits until Brevo finishes processing. */
export async function importContactsToList(contacts, listId, { onProgress } = {}) {
  const CHUNK = 5000;
  for (let i = 0; i < contacts.length; i += CHUNK) {
    const part = contacts.slice(i, i + CHUNK).map(contactToBrevo);
    const r = await brevo('POST', '/contacts/import', {
      jsonBody: part,
      listIds: [listId],
      updateExistingContacts: true,
      emptyContactsAttributes: false,
    });
    if (r?.processId) await waitForProcess(r.processId);
    onProgress?.(Math.min(i + CHUNK, contacts.length));
  }
}

export async function waitForProcess(processId, timeoutMs = 15 * 60_000) {
  const start = Date.now();
  let delay = 1500;
  while (Date.now() - start < timeoutMs) {
    const p = await brevo('GET', `/processes/${processId}`);
    if (p?.status === 'completed') return p;
    if (p?.status === 'failed' || p?.status === 'aborted') throw new BrevoError(500, `Brevo import process ${processId} ${p.status}`);
    await sleep(delay);
    delay = Math.min(delay * 1.5, 10_000);
  }
  throw new BrevoError(504, `Brevo import process ${processId} did not finish in time`);
}

export async function blocklistEmail(email) {
  // Creates the contact if missing, otherwise updates it; either way it is blocklisted for email.
  await brevo('POST', '/contacts', { email, emailBlacklisted: true, updateEnabled: true });
}

export async function unblocklistEmail(email) {
  try {
    await brevo('PUT', `/contacts/${encodeURIComponent(email)}`, { emailBlacklisted: false });
  } catch (e) {
    if (!(e instanceof BrevoError && e.status === 404)) throw e;
  }
}

export const listContactsModifiedSince = (since, offset = 0, limit = 1000) =>
  brevo('GET', `/contacts?limit=${limit}&offset=${offset}&modifiedSince=${encodeURIComponent(since)}&sort=asc`);

// ---------- Campaigns ----------
export async function createEmailCampaign({ name, subject, senderName, senderEmail, replyTo, html, previewText, listId }) {
  const body = {
    name,
    subject,
    sender: { name: senderName, email: senderEmail },
    htmlContent: html,
    recipients: { listIds: [listId] },
    inlineImageActivation: false,
  };
  if (replyTo) body.replyTo = replyTo;
  if (previewText) body.previewText = previewText;
  const r = await brevo('POST', '/emailCampaigns', body);
  return r.id;
}

export const sendCampaignNow = (id) => brevo('POST', `/emailCampaigns/${id}/sendNow`);
export const getCampaign = (id) => brevo('GET', `/emailCampaigns/${id}?statistics=globalStats`);
export const getCampaignListStats = (id) => brevo('GET', `/emailCampaigns/${id}`);
export const setCampaignStatus = (id, status) => brevo('PUT', `/emailCampaigns/${id}/status`, { status });

/** Normalise Brevo stats into one shape. Prefers globalStats, falls back to summing campaignStats. */
export function normalizeStats(c) {
  const s = c?.statistics || {};
  let g = s.globalStats;
  const empty = !g || Object.values(g).every((v) => !v);
  if (empty && Array.isArray(s.campaignStats) && s.campaignStats.length) {
    g = {};
    for (const row of s.campaignStats) for (const [k, v] of Object.entries(row)) if (typeof v === 'number' && k !== 'listId') g[k] = (g[k] || 0) + v;
  }
  g = g || {};
  return {
    sent: g.sent || 0,
    delivered: g.delivered || 0,
    unique_opens: g.uniqueViews || 0,
    opens: g.viewed || 0,
    trackable_opens: g.trackableViews || 0,
    unique_clicks: g.uniqueClicks || 0,
    clickers: g.clickers || 0,
    soft_bounces: g.softBounces || 0,
    hard_bounces: g.hardBounces || 0,
    unsubscriptions: g.unsubscriptions || 0,
    complaints: g.complaints || 0,
    deferred: g.deferred || 0,
    brevo_status: c?.status || null,
  };
}

// ---------- Transactional (used only for test emails) ----------
export async function sendTransactional({ to, subject, html, senderName, senderEmail, replyTo }) {
  const body = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    tags: ['test-email'],
  };
  if (replyTo) body.replyTo = { email: replyTo };
  return brevo('POST', '/smtp/email', body);
}

// ---------- Webhooks ----------
export const MARKETING_EVENTS = ['delivered', 'opened', 'click', 'hardBounce', 'softBounce', 'unsubscribed', 'spam'];

export async function ensureMarketingWebhook(url) {
  const existing = await brevo('GET', '/webhooks?type=marketing');
  const hooks = existing?.webhooks || [];
  const same = hooks.find((h) => h.url === url);
  if (same) return { id: same.id, created: false };
  // Remove stale hooks pointing at an old address of this app.
  for (const h of hooks) {
    if (h.description === 'Aristokrat Mail' && h.url !== url) await brevo('DELETE', `/webhooks/${h.id}`).catch(() => {});
  }
  const r = await brevo('POST', '/webhooks', {
    url,
    description: 'Aristokrat Mail',
    events: MARKETING_EVENTS,
    type: 'marketing',
  });
  return { id: r.id, created: true };
}
