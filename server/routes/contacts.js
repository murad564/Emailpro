import { Router } from 'express';
import ExcelJS from 'exceljs';
import { query, one, many, tx } from '../db.js';
import { asyncH, HttpError, isValidEmail, normalizeEmail, cleanStr, intOr } from '../util.js';
import { buildWhere, CONTACT_FROM, CONTACT_COLUMNS, normalizeFilters } from '../filters.js';
import { getOrCreate, getOrCreateCity, parseTags, setContactTags } from '../lookups.js';
import { suppress, unsuppress } from '../suppression.js';

const r = Router();

const SORTS = {
  created_at: 'c.created_at',
  email: 'lower(c.email)',
  full_name: 'lower(c.full_name)',
  company: 'lower(c.company)',
  country: 'lower(co.name)',
  city: 'lower(ci.name)',
  category: 'lower(ca.name)',
  status: 'c.status',
};

/** Filters can arrive as query params (GET) or a JSON body (POST). */
export function filtersFrom(req) {
  const src = req.method === 'GET' ? req.query : req.body?.filters || req.body || {};
  return normalizeFilters(src);
}

r.get('/', asyncH(async (req, res) => {
  const page = Math.max(1, intOr(req.query.page, 1));
  const pageSize = Math.min(200, Math.max(10, intOr(req.query.pageSize, 25)));
  const sort = SORTS[req.query.sort] || 'c.created_at';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const { where, params } = buildWhere(filtersFrom(req));
  const total = (await one(`SELECT count(*)::int AS n ${CONTACT_FROM} ${where}`, params)).n;
  const rows = await many(
    `SELECT ${CONTACT_COLUMNS} ${CONTACT_FROM} ${where} ORDER BY ${sort} ${dir} NULLS LAST, c.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params
  );
  res.json({ rows, total, page, pageSize });
}));

r.post('/count', asyncH(async (req, res) => {
  const { where, params } = buildWhere(filtersFrom(req));
  const row = await one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE c.status = 'subscribed')::int AS subscribed
     ${CONTACT_FROM} ${where}`,
    params
  );
  res.json(row);
}));

r.get('/lookups', asyncH(async (req, res) => {
  const [countries, cities, categories, tags, languages] = await Promise.all([
    many('SELECT co.id, co.name, (SELECT count(*)::int FROM contacts c WHERE c.country_id = co.id) AS contacts FROM countries co ORDER BY co.name'),
    many('SELECT ci.id, ci.name, ci.country_id, (SELECT count(*)::int FROM contacts c WHERE c.city_id = ci.id) AS contacts FROM cities ci ORDER BY ci.name'),
    many('SELECT ca.id, ca.name, (SELECT count(*)::int FROM contacts c WHERE c.category_id = ca.id) AS contacts FROM categories ca ORDER BY ca.name'),
    many('SELECT t.id, t.name, (SELECT count(*)::int FROM contact_tags ct WHERE ct.tag_id = t.id) AS contacts FROM tags t ORDER BY t.name'),
    many("SELECT language AS name, count(*)::int AS contacts FROM contacts WHERE language <> '' GROUP BY language ORDER BY language"),
  ]);
  res.json({ countries, cities, categories, tags, languages });
}));

r.post('/check-duplicates', asyncH(async (req, res) => {
  const emails = (req.body.emails || []).map(normalizeEmail).filter(Boolean).slice(0, 10000);
  const existing = await many('SELECT lower(email) AS email FROM contacts WHERE lower(email) = ANY($1::text[])', [emails]);
  const suppressed = await many('SELECT lower(email) AS email FROM suppression_list WHERE lower(email) = ANY($1::text[])', [emails]);
  res.json({ existing: existing.map((x) => x.email), suppressed: suppressed.map((x) => x.email) });
}));

r.get('/:id(\\d+)', asyncH(async (req, res) => {
  const row = await one(`SELECT ${CONTACT_COLUMNS} ${CONTACT_FROM} WHERE c.id = $1`, [req.params.id]);
  if (!row) throw new HttpError(404, 'Contact not found.');
  const history = await many(
    `SELECT cr.campaign_id, cam.name AS campaign_name, cr.status, cr.sent_at, cr.opened_at, cr.clicked_at
     FROM campaign_recipients cr JOIN campaigns cam ON cam.id = cr.campaign_id
     WHERE cr.contact_id = $1 ORDER BY cr.created_at DESC LIMIT 50`,
    [req.params.id]
  );
  res.json({ ...row, history });
}));

function readContactBody(b) {
  const email = normalizeEmail(b.email);
  if (!isValidEmail(email)) throw new HttpError(400, 'Please enter a valid email address.');
  let first = cleanStr(b.first_name, 120);
  let last = cleanStr(b.last_name, 120);
  let full = cleanStr(b.full_name, 240);
  if (!full) full = [first, last].filter(Boolean).join(' ');
  if (full && !first && !last) {
    const parts = full.split(' ');
    first = parts.shift() || '';
    last = parts.join(' ');
  }
  const status = ['subscribed', 'unsubscribed', 'bounced'].includes(b.status) ? b.status : 'subscribed';
  return {
    email, full_name: full, first_name: first, last_name: last,
    company: cleanStr(b.company, 240), phone: cleanStr(b.phone, 60), language: cleanStr(b.language, 60),
    notes: String(b.notes || '').slice(0, 5000), status,
    country: cleanStr(b.country, 120), city: cleanStr(b.city, 120), category: cleanStr(b.category, 120),
    tags: parseTags(b.tags),
  };
}

async function resolveRefs(client, c) {
  const country_id = await getOrCreate(client, 'countries', c.country);
  const city_id = await getOrCreateCity(client, country_id, c.city);
  const category_id = await getOrCreate(client, 'categories', c.category);
  return { country_id, city_id, category_id };
}

r.post('/', asyncH(async (req, res) => {
  const c = readContactBody(req.body);
  const dup = await one('SELECT id FROM contacts WHERE lower(email) = $1', [c.email]);
  if (dup) throw new HttpError(409, `A contact with ${c.email} already exists.`, { existing_id: dup.id });
  const id = await tx(async (client) => {
    const refs = await resolveRefs(client, c);
    const row = (await client.query(
      `INSERT INTO contacts (email, full_name, first_name, last_name, company, phone, language, notes, status, country_id, city_id, category_id, status_changed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now()) RETURNING id`,
      [c.email, c.full_name, c.first_name, c.last_name, c.company, c.phone, c.language, c.notes, c.status, refs.country_id, refs.city_id, refs.category_id]
    )).rows[0];
    await setContactTags(client, row.id, c.tags);
    return row.id;
  });
  if (c.status !== 'subscribed') await suppress(c.email, c.status === 'bounced' ? 'hard_bounce' : 'manual', { source: 'Added as unsubscribed' });
  res.status(201).json({ id });
}));

r.put('/:id(\\d+)', asyncH(async (req, res) => {
  const existing = await one('SELECT id, email, status FROM contacts WHERE id = $1', [req.params.id]);
  if (!existing) throw new HttpError(404, 'Contact not found.');
  const c = readContactBody(req.body);
  if (c.email !== existing.email.toLowerCase()) {
    const dup = await one('SELECT id FROM contacts WHERE lower(email) = $1 AND id <> $2', [c.email, existing.id]);
    if (dup) throw new HttpError(409, `Another contact already uses ${c.email}.`);
  }
  await tx(async (client) => {
    const refs = await resolveRefs(client, c);
    await client.query(
      `UPDATE contacts SET email=$2, full_name=$3, first_name=$4, last_name=$5, company=$6, phone=$7, language=$8, notes=$9,
         country_id=$10, city_id=$11, category_id=$12, updated_at=now()
       WHERE id=$1`,
      [existing.id, c.email, c.full_name, c.first_name, c.last_name, c.company, c.phone, c.language, c.notes, refs.country_id, refs.city_id, refs.category_id]
    );
    await setContactTags(client, existing.id, c.tags);
  });
  if (c.status !== existing.status) {
    if (c.status === 'subscribed') await unsuppress(c.email);
    else await suppress(c.email, c.status === 'bounced' ? 'hard_bounce' : 'manual', { source: `Changed by ${req.user.email}` });
  }
  res.json({ ok: true });
}));

r.delete('/:id(\\d+)', asyncH(async (req, res) => {
  const n = (await query('DELETE FROM contacts WHERE id = $1', [req.params.id])).rowCount;
  if (!n) throw new HttpError(404, 'Contact not found.');
  res.json({ deleted: n });
}));

function bulkWhere(req) {
  const ids = (req.body.ids || []).map((x) => parseInt(x, 10)).filter(Number.isFinite);
  if (req.body.all_matching) return buildWhere(req.body.filters || {});
  if (!ids.length) throw new HttpError(400, 'No contacts selected.');
  return buildWhere({ contact_ids: ids });
}

r.post('/bulk-delete', asyncH(async (req, res) => {
  const { where, params } = bulkWhere(req);
  const n = (await query(`DELETE FROM contacts WHERE id IN (SELECT c.id ${CONTACT_FROM} ${where})`, params)).rowCount;
  res.json({ deleted: n });
}));

r.post('/bulk-update', asyncH(async (req, res) => {
  const { where, params } = bulkWhere(req);
  const set = req.body.set || {};
  const targets = await many(`SELECT c.id, c.email, c.status ${CONTACT_FROM} ${where}`, params);
  await tx(async (client) => {
    const cache = new Map();
    if (set.category !== undefined) {
      const catId = set.category ? await getOrCreate(client, 'categories', set.category) : null;
      await client.query('UPDATE contacts SET category_id = $1, updated_at = now() WHERE id = ANY($2::bigint[])', [catId, targets.map((t) => t.id)]);
    }
    if (set.language !== undefined) {
      await client.query('UPDATE contacts SET language = $1, updated_at = now() WHERE id = ANY($2::bigint[])', [cleanStr(set.language, 60), targets.map((t) => t.id)]);
    }
    if (set.add_tags) {
      const tags = parseTags(set.add_tags);
      for (const t of targets) await setContactTags(client, t.id, tags, cache, { replace: false });
    }
  });
  if (set.status === 'unsubscribed') {
    for (const t of targets) if (t.status === 'subscribed') await suppress(t.email, 'manual', { source: `Bulk update by ${req.user.email}` });
  }
  res.json({ updated: targets.length });
}));

// ---------- Excel / CSV export ----------
export const EXPORT_COLUMNS = [
  { header: 'Full Name', key: 'full_name', width: 26 },
  { header: 'First Name', key: 'first_name', width: 16 },
  { header: 'Last Name', key: 'last_name', width: 18 },
  { header: 'Email Address', key: 'email', width: 32 },
  { header: 'Company Name', key: 'company', width: 28 },
  { header: 'Country', key: 'country', width: 18 },
  { header: 'City', key: 'city', width: 18 },
  { header: 'Phone Number', key: 'phone', width: 18 },
  { header: 'Contact Category', key: 'category', width: 22 },
  { header: 'Language', key: 'language', width: 12 },
  { header: 'Tags', key: 'tags', width: 24 },
  { header: 'Contact Status', key: 'status', width: 14 },
  { header: 'Date Added', key: 'created_at', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
  { header: 'Notes', key: 'notes', width: 40 },
];

r.get('/export', asyncH(async (req, res) => {
  const f = filtersFrom(req);
  const { where, params } = buildWhere(f);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = cleanStr(req.query.filename || 'contacts', 60).replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') || 'contacts';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}_${stamp}.xlsx"`);

  // Streaming workbook so 50,000+ rows don't load into memory at once.
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
  const ws = wb.addWorksheet('Contacts', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = EXPORT_COLUMNS;
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  head.commit();

  const PAGE = 2000;
  let lastId = 0;
  for (;;) {
    const pIdx = params.length + 1;
    const rows = await many(
      `SELECT ${CONTACT_COLUMNS} ${CONTACT_FROM} ${where ? where + ' AND' : 'WHERE'} c.id > $${pIdx} ORDER BY c.id LIMIT ${PAGE}`,
      [...params, lastId]
    );
    if (!rows.length) break;
    for (const c of rows) {
      ws.addRow({ ...c, tags: (c.tags || []).join(', '), created_at: new Date(c.created_at) }).commit();
    }
    lastId = rows[rows.length - 1].id;
    if (rows.length < PAGE) break;
  }
  await ws.commit();
  await wb.commit();
}));

export default r;
