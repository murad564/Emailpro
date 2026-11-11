// Users, settings, suppression list and dashboard.
import { Router } from 'express';
import { one, many, query } from '../db.js';
import { asyncH, HttpError, cleanStr, isValidEmail, normalizeEmail, intOr } from '../util.js';
import { requireAdmin, hashPassword, validatePassword, checkPassword } from '../auth.js';
import { getSetting, setSetting, getBrevoApiKey } from '../settings.js';
import { suppress, unsuppress } from '../suppression.js';
import { cachedAccount } from './brevo.js';
import { summarizePlan } from '../brevo.js';
import { VARIABLES } from '../personalize.js';

export const users = Router();
export const settings = Router();
export const suppression = Router();
export const dashboard = Router();

// ---------------- Users (admin only) ----------------
users.use(requireAdmin);

users.get('/', asyncH(async (req, res) => {
  res.json({ rows: await many('SELECT id, email, name, role, active, last_login_at, created_at FROM users ORDER BY created_at') });
}));

users.post('/', asyncH(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!isValidEmail(email)) throw new HttpError(400, 'Enter a valid email.');
  validatePassword(req.body.password);
  if (await one('SELECT 1 FROM users WHERE lower(email) = $1', [email])) throw new HttpError(409, 'A user with this email already exists.');
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  const row = await one('INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id', [
    email, cleanStr(req.body.name, 120), await hashPassword(req.body.password), role,
  ]);
  res.status(201).json(row);
}));

users.put('/:id(\\d+)', asyncH(async (req, res) => {
  const id = Number(req.params.id);
  const u = await one('SELECT * FROM users WHERE id = $1', [id]);
  if (!u) throw new HttpError(404, 'User not found.');
  const role = req.body.role === 'admin' ? 'admin' : req.body.role === 'user' ? 'user' : u.role;
  const active = req.body.active === undefined ? u.active : !!req.body.active;
  if (id === req.user.id && (role !== 'admin' || !active)) throw new HttpError(400, 'You cannot remove your own admin access.');
  if (u.role === 'admin' && (role !== 'admin' || !active)) {
    const admins = (await one("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active AND id <> $1", [id])).n;
    if (!admins) throw new HttpError(400, 'At least one active admin is required.');
  }
  await query('UPDATE users SET name = $2, role = $3, active = $4 WHERE id = $1', [id, cleanStr(req.body.name ?? u.name, 120), role, active]);
  if (req.body.password) {
    validatePassword(req.body.password);
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, await hashPassword(req.body.password)]);
  }
  res.json({ ok: true });
}));

users.delete('/:id(\\d+)', asyncH(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'You cannot delete your own account.');
  const u = await one('SELECT role FROM users WHERE id = $1', [id]);
  if (!u) throw new HttpError(404, 'User not found.');
  if (u.role === 'admin' && !(await one("SELECT count(*)::int AS n FROM users WHERE role='admin' AND active AND id <> $1", [id])).n)
    throw new HttpError(400, 'At least one admin is required.');
  await query('DELETE FROM users WHERE id = $1', [id]);
  res.json({ deleted: true });
}));

// ---------------- Settings ----------------
settings.get('/', asyncH(async (req, res) => {
  res.json({ general: await getSetting('general'), sender: await getSetting('sender'), variables: Object.keys(VARIABLES) });
}));

settings.put('/', requireAdmin, asyncH(async (req, res) => {
  const g = req.body.general;
  const s = req.body.sender;
  if (g) {
    const cur = await getSetting('general');
    const fb = { ...cur.default_fallbacks };
    for (const k of Object.keys(fb)) if (g.default_fallbacks?.[k] !== undefined) fb[k] = cleanStr(g.default_fallbacks[k], 120);
    await setSetting('general', {
      company_name: cleanStr(g.company_name ?? cur.company_name, 160),
      company_address: String(g.company_address ?? cur.company_address).trim().slice(0, 500),
      website: cleanStr(g.website ?? cur.website, 200),
      default_fallbacks: fb,
    });
  }
  if (s) {
    for (const k of ['sender_email', 'reply_to']) if (s[k] && !isValidEmail(s[k])) throw new HttpError(400, `${k.replace('_', ' ')} is not a valid email.`);
    await setSetting('sender', {
      sender_name: cleanStr(s.sender_name, 120),
      sender_email: normalizeEmail(s.sender_email),
      reply_to: normalizeEmail(s.reply_to),
    });
  }
  res.json({ ok: true });
}));

settings.post('/password', asyncH(async (req, res) => {
  const u = await one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await checkPassword(String(req.body.current || ''), u.password_hash))) throw new HttpError(400, 'Current password is incorrect.');
  validatePassword(req.body.next);
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await hashPassword(req.body.next)]);
  res.json({ ok: true });
}));

// ---------------- Suppression list ----------------
suppression.get('/', asyncH(async (req, res) => {
  const page = Math.max(1, intOr(req.query.page, 1));
  const pageSize = 50;
  const params = [];
  const where = [];
  if (req.query.search) {
    params.push(`%${String(req.query.search).toLowerCase()}%`);
    where.push(`lower(s.email) LIKE $${params.length}`);
  }
  if (req.query.reason) {
    params.push(String(req.query.reason));
    where.push(`s.reason = $${params.length}`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await one(`SELECT count(*)::int AS n FROM suppression_list s ${w}`, params)).n;
  const rows = await many(
    `SELECT s.*, cam.name AS campaign_name FROM suppression_list s LEFT JOIN campaigns cam ON cam.id = s.campaign_id
     ${w} ORDER BY s.created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params
  );
  const byReason = await many('SELECT reason, count(*)::int AS n FROM suppression_list GROUP BY reason');
  res.json({ rows, total, page, pageSize, byReason });
}));

suppression.post('/', asyncH(async (req, res) => {
  const emails = String(req.body.emails || '').split(/[\s,;]+/).map(normalizeEmail).filter(isValidEmail);
  if (!emails.length) throw new HttpError(400, 'Enter at least one valid email.');
  for (const e of emails) await suppress(e, 'manual', { source: `Added manually by ${req.user.email}` });
  res.json({ added: emails.length });
}));

suppression.delete('/:email', requireAdmin, asyncH(async (req, res) => {
  const email = normalizeEmail(req.params.email);
  const row = await one('SELECT reason FROM suppression_list WHERE lower(email) = $1', [email]);
  if (!row) throw new HttpError(404, 'Not on the suppression list.');
  if (!req.body?.confirm_consent) throw new HttpError(400, 'Confirm that this person has agreed to receive emails again.');
  await unsuppress(email);
  res.json({ removed: true });
}));

// ---------------- Dashboard ----------------
dashboard.get('/', asyncH(async (req, res) => {
  const counts = await one(`
    SELECT
      (SELECT count(*)::int FROM contacts) AS contacts,
      (SELECT count(*)::int FROM contacts WHERE status = 'subscribed') AS subscribed,
      (SELECT count(*)::int FROM contacts WHERE status = 'unsubscribed') AS unsubscribed,
      (SELECT count(*)::int FROM contacts WHERE status = 'bounced') AS bounced,
      (SELECT count(DISTINCT country_id)::int FROM contacts WHERE country_id IS NOT NULL) AS countries,
      (SELECT count(DISTINCT city_id)::int FROM contacts WHERE city_id IS NOT NULL) AS cities,
      (SELECT count(*)::int FROM campaigns WHERE status IN ('sent','partially_sent','sending')) AS campaigns_sent,
      (SELECT count(*)::int FROM suppression_list) AS suppressed`);
  const agg = await one(`
    SELECT
      COALESCE(sum((stats->>'sent')::int),0)::int AS sent,
      COALESCE(sum((stats->>'delivered')::int),0)::int AS delivered,
      COALESCE(sum((stats->>'unique_opens')::int),0)::int AS opens,
      COALESCE(sum((stats->>'unique_clicks')::int),0)::int AS clicks,
      COALESCE(sum((stats->>'hard_bounces')::int + (stats->>'soft_bounces')::int),0)::int AS bounces,
      COALESCE(sum((stats->>'unsubscriptions')::int),0)::int AS unsubscriptions
    FROM campaigns WHERE stats ? 'sent'`);
  const failed = (await one("SELECT count(*)::int AS n FROM campaign_recipients WHERE status = 'failed'")).n;
  const sentLocal = (await one("SELECT count(*)::int AS n FROM campaign_recipients WHERE status IN ('sent','delivered','soft_bounce','hard_bounce')")).n;
  const sent = Math.max(agg.sent, sentLocal);
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

  const byCountry = await many(`
    SELECT COALESCE(co.name, 'Not set') AS name, count(*)::int AS contacts
    FROM contacts c LEFT JOIN countries co ON co.id = c.country_id GROUP BY co.name ORDER BY contacts DESC LIMIT 10`);
  const growth = await many(`
    SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, count(*)::int AS contacts
    FROM contacts WHERE created_at > now() - interval '12 months' GROUP BY 1 ORDER BY 1`);
  const recent = await many(`
    SELECT c.id, c.name, c.subject, c.status, c.sent_at, c.scheduled_at, c.created_at, c.stats, c.audience_label,
      (SELECT count(*)::int FROM campaign_recipients r WHERE r.campaign_id = c.id AND r.status NOT IN ('cancelled','skipped')) AS recipients
    FROM campaigns c WHERE c.status <> 'draft' ORDER BY COALESCE(c.sent_at, c.scheduled_at, c.updated_at) DESC LIMIT 8`);

  let quota = null;
  if (await getBrevoApiKey()) {
    try {
      quota = summarizePlan(await cachedAccount());
    } catch (e) {
      quota = { error: e.message };
    }
  }
  res.json({
    counts,
    email: {
      sent, delivered: agg.delivered, opens: agg.opens, clicks: agg.clicks, bounces: agg.bounces, failed,
      unsubscriptions: agg.unsubscriptions,
      open_rate: pct(agg.opens, agg.delivered), click_rate: pct(agg.clicks, agg.delivered), bounce_rate: pct(agg.bounces, sent),
    },
    byCountry, growth, recent, quota,
  });
}));
