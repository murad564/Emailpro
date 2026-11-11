import { Router } from 'express';
import ExcelJS from 'exceljs';
import { one, many, query } from '../db.js';
import { asyncH, HttpError, cleanStr, intOr } from '../util.js';
import { getSetting } from '../settings.js';
import * as S from '../sender.js';
import { finalizeHtml, renderForContact, renderSubject, textToHtml, hasUnsubscribeLink } from '../personalize.js';

const r = Router();

const LIST_COLS = `c.id, c.name, c.subject, c.status, c.audience, c.audience_label, c.send_limit, c.scheduled_at, c.sent_at,
  c.created_at, c.updated_at, c.stats, c.stats_synced_at, c.error, c.editor_mode,
  (SELECT count(*)::int FROM campaign_recipients r WHERE r.campaign_id = c.id AND r.status NOT IN ('cancelled','skipped')) AS recipients`;

r.get('/', asyncH(async (req, res) => {
  const status = req.query.status;
  const params = [];
  let where = '';
  if (status) {
    params.push(String(status).split(','));
    where = 'WHERE c.status = ANY($1::text[])';
  }
  const rows = await many(`SELECT ${LIST_COLS} FROM campaigns c ${where} ORDER BY COALESCE(c.sent_at, c.scheduled_at, c.updated_at) DESC`, params);
  res.json({ rows });
}));

r.get('/:id(\\d+)', asyncH(async (req, res) => {
  const c = await one('SELECT * FROM campaigns WHERE id = $1', [req.params.id]);
  if (!c) throw new HttpError(404, 'Campaign not found.');
  res.json(c);
}));

async function readBody(b) {
  const sender = await getSetting('sender');
  const mode = ['html', 'visual', 'text'].includes(b.editor_mode) ? b.editor_mode : 'html';
  const audience = b.audience && typeof b.audience === 'object' ? b.audience : { type: 'all' };
  if (!['all', 'filters', 'segment', 'contacts'].includes(audience.type)) audience.type = 'all';
  const lim = b.send_limit === '' || b.send_limit === null || b.send_limit === undefined ? null : intOr(b.send_limit, null);
  if (lim !== null && lim < 1) throw new HttpError(400, 'Sending limit must be at least 1.');
  const bs = b.batch_size === '' || b.batch_size == null ? null : intOr(b.batch_size, null);
  if (bs !== null && bs < 10) throw new HttpError(400, 'Batch size must be at least 10.');
  return {
    name: cleanStr(b.name, 200) || 'Untitled campaign',
    subject: cleanStr(b.subject, 300),
    preheader: cleanStr(b.preheader, 300),
    sender_name: cleanStr(b.sender_name ?? sender.sender_name, 120),
    sender_email: cleanStr(b.sender_email ?? sender.sender_email, 200).toLowerCase(),
    reply_to: cleanStr(b.reply_to ?? sender.reply_to, 200).toLowerCase(),
    editor_mode: mode,
    html: String(b.html || ''),
    text_body: String(b.text_body || ''),
    design: b.design ? JSON.stringify(b.design) : null,
    template_id: b.template_id ? intOr(b.template_id, null) : null,
    audience: JSON.stringify(audience),
    send_limit: lim,
    randomize: !!b.randomize,
    batch_size: bs,
    batch_interval_minutes: Math.max(5, intOr(b.batch_interval_minutes, 60)),
  };
}

r.post('/', asyncH(async (req, res) => {
  const c = await readBody(req.body);
  const row = await one(
    `INSERT INTO campaigns (name, subject, preheader, sender_name, sender_email, reply_to, editor_mode, html, text_body, design, template_id,
       audience, send_limit, randomize, batch_size, batch_interval_minutes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
    [c.name, c.subject, c.preheader, c.sender_name, c.sender_email, c.reply_to, c.editor_mode, c.html, c.text_body, c.design, c.template_id,
      c.audience, c.send_limit, c.randomize, c.batch_size, c.batch_interval_minutes, req.user.id]
  );
  res.status(201).json(row);
}));

r.put('/:id(\\d+)', asyncH(async (req, res) => {
  const existing = await one('SELECT status FROM campaigns WHERE id = $1', [req.params.id]);
  if (!existing) throw new HttpError(404, 'Campaign not found.');
  if (['sending', 'scheduled'].includes(existing.status)) throw new HttpError(409, 'Pause or cancel the campaign before editing it.');
  const c = await readBody(req.body);
  await query(
    `UPDATE campaigns SET name=$2, subject=$3, preheader=$4, sender_name=$5, sender_email=$6, reply_to=$7, editor_mode=$8, html=$9,
       text_body=$10, design=$11, template_id=$12, audience=$13, send_limit=$14, randomize=$15, batch_size=$16, batch_interval_minutes=$17,
       updated_at=now()
     WHERE id=$1`,
    [req.params.id, c.name, c.subject, c.preheader, c.sender_name, c.sender_email, c.reply_to, c.editor_mode, c.html, c.text_body, c.design,
      c.template_id, c.audience, c.send_limit, c.randomize, c.batch_size, c.batch_interval_minutes]
  );
  res.json({ ok: true });
}));

r.delete('/:id(\\d+)', asyncH(async (req, res) => {
  const c = await one('SELECT status FROM campaigns WHERE id = $1', [req.params.id]);
  if (!c) throw new HttpError(404, 'Campaign not found.');
  if (['sending', 'scheduled'].includes(c.status)) throw new HttpError(409, 'Cancel the campaign before deleting it.');
  if (c.status !== 'draft' && req.user.role !== 'admin') throw new HttpError(403, 'Only admins can delete sent campaigns (this removes their report).');
  await query('DELETE FROM campaigns WHERE id = $1', [req.params.id]);
  res.json({ deleted: true });
}));

r.post('/:id(\\d+)/duplicate', asyncH(async (req, res) => {
  const c = await one('SELECT * FROM campaigns WHERE id = $1', [req.params.id]);
  if (!c) throw new HttpError(404, 'Campaign not found.');
  const audience = { ...c.audience };
  delete audience.summary;
  const row = await one(
    `INSERT INTO campaigns (name, subject, preheader, sender_name, sender_email, reply_to, editor_mode, html, text_body, design, template_id,
       audience, send_limit, randomize, batch_size, batch_interval_minutes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
    [`${c.name} (copy)`, c.subject, c.preheader, c.sender_name, c.sender_email, c.reply_to, c.editor_mode, c.html, c.text_body,
      c.design ? JSON.stringify(c.design) : null, c.template_id, JSON.stringify(audience), c.send_limit, c.randomize, c.batch_size,
      c.batch_interval_minutes, req.user.id]
  );
  res.status(201).json(row);
}));

// Audience preview for a saved campaign or for unsaved settings.
r.post('/preview-audience', asyncH(async (req, res) => {
  const b = req.body || {};
  const campaign = {
    id: b.id ? intOr(b.id, null) : null,
    audience: b.audience || { type: 'all' },
    send_limit: b.send_limit ? intOr(b.send_limit, null) : null,
  };
  res.json(await S.previewAudience(campaign));
}));

r.post('/test', asyncH(async (req, res) => {
  const b = req.body || {};
  const out = await S.sendTestEmail(
    {
      subject: b.subject, preheader: b.preheader, sender_name: b.sender_name, sender_email: String(b.sender_email || '').trim().toLowerCase(),
      reply_to: b.reply_to, editor_mode: b.editor_mode, html: b.html, text_body: b.text_body,
    },
    String(b.to || '').trim(),
    { contactId: b.sample_contact_id ? intOr(b.sample_contact_id, null) : null }
  );
  res.json({ ok: true, ...out });
}));

// Renders what recipients will see: compliance footer + preheader + personalisation for a sample contact.
r.post('/render-preview', asyncH(async (req, res) => {
  const b = req.body || {};
  const general = await getSetting('general');
  const body = b.editor_mode === 'text' ? textToHtml(b.text_body) : String(b.html || '');
  let contact = null;
  if (b.contact_id) {
    contact = await one(
      `SELECT c.*, co.name AS country, ci.name AS city FROM contacts c LEFT JOIN countries co ON co.id = c.country_id
       LEFT JOIN cities ci ON ci.id = c.city_id WHERE c.id = $1`,
      [intOr(b.contact_id, 0)]
    );
  }
  const fallbacks = general.default_fallbacks || {};
  const html = renderForContact(finalizeHtml(body, { preheader: b.preheader, general }), contact || {}, fallbacks, { unsubscribeUrl: '#unsubscribe' });
  res.json({ html, subject: renderSubject(b.subject || '', contact || {}, fallbacks), footer_added: !hasUnsubscribeLink(body) });
}));

r.post('/:id(\\d+)/validate', asyncH(async (req, res) => {
  const c = await one('SELECT * FROM campaigns WHERE id = $1', [req.params.id]);
  if (!c) throw new HttpError(404, 'Campaign not found.');
  res.json({ problems: await S.validateForSend(c), preview: await S.previewAudience(c) });
}));

r.post('/:id(\\d+)/send', asyncH(async (req, res) => {
  const out = await S.confirmSend(Number(req.params.id), {
    scheduledAt: req.body.scheduled_at || null,
    userEmail: req.user.email,
  });
  res.json(out);
}));

r.post('/:id(\\d+)/pause', asyncH(async (req, res) => res.json(await S.pauseCampaign(Number(req.params.id)))));
r.post('/:id(\\d+)/resume', asyncH(async (req, res) => res.json(await S.resumeCampaign(Number(req.params.id)))));
r.post('/:id(\\d+)/cancel', asyncH(async (req, res) => res.json(await S.cancelCampaign(Number(req.params.id)))));

r.post('/:id(\\d+)/sync-stats', asyncH(async (req, res) => {
  const out = await S.syncCampaignStats(Number(req.params.id));
  res.json(out);
}));

// ---------------- Reports ----------------

r.get('/:id(\\d+)/report', asyncH(async (req, res) => {
  const c = await one('SELECT * FROM campaigns WHERE id = $1', [req.params.id]);
  if (!c) throw new HttpError(404, 'Campaign not found.');
  const [batches, logs, local] = await Promise.all([
    many('SELECT * FROM campaign_batches WHERE campaign_id = $1 ORDER BY batch_no', [c.id]),
    many('SELECT * FROM sending_logs WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 200', [c.id]),
    S.localRecipientStats(c.id),
  ]);
  res.json({ campaign: c, batches, logs, local });
}));

const RECIP_FILTERS = {
  all: '',
  queued: "AND r.status = 'queued'",
  sent: "AND r.status IN ('sent','delivered','soft_bounce','hard_bounce')",
  delivered: "AND (r.delivered_at IS NOT NULL OR r.status = 'delivered')",
  opened: 'AND r.opened_at IS NOT NULL',
  clicked: 'AND r.clicked_at IS NOT NULL',
  bounced: "AND r.status IN ('soft_bounce','hard_bounce')",
  unsubscribed: 'AND r.unsubscribed_at IS NOT NULL',
  failed: "AND r.status = 'failed'",
  skipped: "AND r.status IN ('skipped','cancelled')",
};

r.get('/:id(\\d+)/recipients', asyncH(async (req, res) => {
  const f = RECIP_FILTERS[req.query.filter] ?? '';
  const page = Math.max(1, intOr(req.query.page, 1));
  const pageSize = Math.min(200, Math.max(10, intOr(req.query.pageSize, 50)));
  const params = [req.params.id];
  let search = '';
  if (req.query.search) {
    params.push(`%${String(req.query.search).toLowerCase()}%`);
    search = `AND lower(r.email) LIKE $${params.length}`;
  }
  const total = (await one(`SELECT count(*)::int AS n FROM campaign_recipients r WHERE r.campaign_id = $1 ${f} ${search}`, params)).n;
  const rows = await many(
    `SELECT r.*, c.full_name, c.company, co.name AS country, ci.name AS city, b.batch_no
     FROM campaign_recipients r
     LEFT JOIN contacts c ON c.id = r.contact_id LEFT JOIN countries co ON co.id = c.country_id LEFT JOIN cities ci ON ci.id = c.city_id
     LEFT JOIN campaign_batches b ON b.id = r.batch_id
     WHERE r.campaign_id = $1 ${f} ${search} ORDER BY r.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params
  );
  res.json({ rows, total, page, pageSize });
}));

function rate(n, d) {
  return d ? Math.round((n / d) * 10000) / 100 : 0;
}

export function summaryRow(c) {
  const s = c.stats || {};
  const delivered = s.delivered || 0;
  const sentCount = s.sent || c.recipients || 0;
  return {
    name: c.name,
    subject: c.subject,
    sent_at: c.sent_at ? new Date(c.sent_at) : c.scheduled_at ? new Date(c.scheduled_at) : null,
    status: c.status,
    countries: c.audience?.summary?.countries || '',
    cities: c.audience?.summary?.cities || '',
    audience: c.audience_label || '',
    recipients: c.recipients ?? s.recipients ?? 0,
    sent: sentCount,
    delivered,
    opened: s.unique_opens || 0,
    clicked: s.unique_clicks || 0,
    bounced: (s.hard_bounces || 0) + (s.soft_bounces || 0),
    failed: s.failed || 0,
    unsubscribed: s.unsubscriptions || 0,
    open_rate: rate(s.unique_opens || 0, delivered),
    click_rate: rate(s.unique_clicks || 0, delivered),
    bounce_rate: rate((s.hard_bounces || 0) + (s.soft_bounces || 0), sentCount),
  };
}

const SUMMARY_COLUMNS = [
  { header: 'Campaign Name', key: 'name', width: 32 },
  { header: 'Email Subject', key: 'subject', width: 40 },
  { header: 'Date & Time', key: 'sent_at', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Country', key: 'countries', width: 22 },
  { header: 'City', key: 'cities', width: 22 },
  { header: 'Selected Audience', key: 'audience', width: 40 },
  { header: 'Total Recipients', key: 'recipients', width: 16 },
  { header: 'Successfully Sent', key: 'sent', width: 16 },
  { header: 'Delivered', key: 'delivered', width: 12 },
  { header: 'Opened', key: 'opened', width: 10 },
  { header: 'Clicked', key: 'clicked', width: 10 },
  { header: 'Bounced', key: 'bounced', width: 10 },
  { header: 'Failed', key: 'failed', width: 10 },
  { header: 'Unsubscribed', key: 'unsubscribed', width: 14 },
  { header: 'Open Rate %', key: 'open_rate', width: 12 },
  { header: 'Click Rate %', key: 'click_rate', width: 12 },
  { header: 'Bounce Rate %', key: 'bounce_rate', width: 13 },
];

function styleHeader(ws) {
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

r.get('/:id(\\d+)/report.xlsx', asyncH(async (req, res) => {
  const c = await one(`SELECT ${LIST_COLS} FROM campaigns c WHERE c.id = $1`, [req.params.id]);
  if (!c) throw new HttpError(404, 'Campaign not found.');
  const wb = new ExcelJS.Workbook();
  const sum = wb.addWorksheet('Summary');
  sum.columns = SUMMARY_COLUMNS;
  styleHeader(sum);
  sum.addRow(summaryRow(c));

  const bs = wb.addWorksheet('Batches');
  bs.columns = [
    { header: 'Batch', key: 'batch_no', width: 8 },
    { header: 'Recipients', key: 'recipient_count', width: 12 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Sent At', key: 'sent_at', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Brevo Campaign ID', key: 'brevo_campaign_id', width: 18 },
    { header: 'Delivered', key: 'delivered', width: 12 },
    { header: 'Opens', key: 'opens', width: 10 },
    { header: 'Clicks', key: 'clicks', width: 10 },
    { header: 'Error', key: 'error', width: 50 },
  ];
  styleHeader(bs);
  for (const b of await many('SELECT * FROM campaign_batches WHERE campaign_id = $1 ORDER BY batch_no', [c.id])) {
    bs.addRow({ ...b, sent_at: b.sent_at ? new Date(b.sent_at) : null, delivered: b.stats?.delivered || 0, opens: b.stats?.unique_opens || 0, clicks: b.stats?.unique_clicks || 0 });
  }

  const rs = wb.addWorksheet('Recipients');
  rs.columns = [
    { header: 'Email', key: 'email', width: 34 },
    { header: 'Full Name', key: 'full_name', width: 24 },
    { header: 'Company', key: 'company', width: 26 },
    { header: 'Country', key: 'country', width: 16 },
    { header: 'City', key: 'city', width: 16 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Sent At', key: 'sent_at', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Delivered At', key: 'delivered_at', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Opened At', key: 'opened_at', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Clicked At', key: 'clicked_at', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Unsubscribed At', key: 'unsubscribed_at', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Error', key: 'error', width: 40 },
  ];
  styleHeader(rs);
  const recips = await many(
    `SELECT r.*, c.full_name, c.company, co.name AS country, ci.name AS city
     FROM campaign_recipients r LEFT JOIN contacts c ON c.id = r.contact_id
     LEFT JOIN countries co ON co.id = c.country_id LEFT JOIN cities ci ON ci.id = c.city_id
     WHERE r.campaign_id = $1 ORDER BY r.id`,
    [c.id]
  );
  const d = (v) => (v ? new Date(v) : null);
  for (const x of recips) {
    rs.addRow({ ...x, sent_at: d(x.sent_at), delivered_at: d(x.delivered_at), opened_at: d(x.opened_at), clicked_at: d(x.clicked_at), unsubscribed_at: d(x.unsubscribed_at) });
  }
  const safe = c.name.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_').slice(0, 50) || 'campaign';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

r.get('/report.xlsx', asyncH(async (req, res) => {
  const rows = await many(`SELECT ${LIST_COLS} FROM campaigns c WHERE c.status <> 'draft' ORDER BY COALESCE(c.sent_at, c.scheduled_at, c.created_at) DESC`);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Campaigns');
  ws.columns = SUMMARY_COLUMNS;
  styleHeader(ws);
  for (const c of rows) ws.addRow(summaryRow(c));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="campaign_reports_${new Date().toISOString().slice(0, 10)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

export default r;
