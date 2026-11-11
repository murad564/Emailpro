import { Router } from 'express';
import { one, many, query } from '../db.js';
import { asyncH, HttpError, cleanStr } from '../util.js';
import { buildWhere, CONTACT_FROM, normalizeFilters, describeFilters } from '../filters.js';

const r = Router();

async function counts(filters) {
  const { where, params } = buildWhere(filters);
  return one(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE c.status = 'subscribed')::int AS subscribed ${CONTACT_FROM} ${where}`,
    params
  );
}

r.get('/', asyncH(async (req, res) => {
  const rows = await many('SELECT s.*, u.name AS created_by_name FROM segments s LEFT JOIN users u ON u.id = s.created_by ORDER BY s.name');
  const out = [];
  for (const s of rows) out.push({ ...s, ...(await counts(s.filters)), description_auto: await describeFilters(s.filters) });
  res.json({ rows: out });
}));

r.get('/:id(\\d+)', asyncH(async (req, res) => {
  const s = await one('SELECT * FROM segments WHERE id = $1', [req.params.id]);
  if (!s) throw new HttpError(404, 'Segment not found.');
  res.json({ ...s, ...(await counts(s.filters)), description_auto: await describeFilters(s.filters) });
}));

function readBody(b) {
  const name = cleanStr(b.name, 160);
  if (!name) throw new HttpError(400, 'Segment name is required.');
  const filters = normalizeFilters(b.filters || {});
  delete filters.statuses; // segments always target contacts; sending excludes non-subscribed automatically
  return { name, description: String(b.description || '').slice(0, 1000), filters };
}

r.post('/', asyncH(async (req, res) => {
  const s = readBody(req.body);
  const dup = await one('SELECT id FROM segments WHERE lower(name) = lower($1)', [s.name]);
  if (dup) throw new HttpError(409, `A segment named "${s.name}" already exists.`);
  const row = await one(
    'INSERT INTO segments (name, description, filters, created_by) VALUES ($1,$2,$3,$4) RETURNING id',
    [s.name, s.description, JSON.stringify(s.filters), req.user.id]
  );
  res.status(201).json(row);
}));

r.put('/:id(\\d+)', asyncH(async (req, res) => {
  const s = readBody(req.body);
  const dup = await one('SELECT id FROM segments WHERE lower(name) = lower($1) AND id <> $2', [s.name, req.params.id]);
  if (dup) throw new HttpError(409, `A segment named "${s.name}" already exists.`);
  const n = (await query('UPDATE segments SET name=$2, description=$3, filters=$4, updated_at=now() WHERE id=$1',
    [req.params.id, s.name, s.description, JSON.stringify(s.filters)])).rowCount;
  if (!n) throw new HttpError(404, 'Segment not found.');
  res.json({ ok: true });
}));

r.post('/:id(\\d+)/duplicate', asyncH(async (req, res) => {
  const s = await one('SELECT * FROM segments WHERE id = $1', [req.params.id]);
  if (!s) throw new HttpError(404, 'Segment not found.');
  let name = `${s.name} (copy)`;
  for (let i = 2; await one('SELECT 1 FROM segments WHERE lower(name) = lower($1)', [name]); i++) name = `${s.name} (copy ${i})`;
  const row = await one('INSERT INTO segments (name, description, filters, created_by) VALUES ($1,$2,$3,$4) RETURNING id',
    [name, s.description, JSON.stringify(s.filters), req.user.id]);
  res.status(201).json(row);
}));

r.delete('/:id(\\d+)', asyncH(async (req, res) => {
  const n = (await query('DELETE FROM segments WHERE id = $1', [req.params.id])).rowCount;
  if (!n) throw new HttpError(404, 'Segment not found.');
  res.json({ deleted: true });
}));

export default r;
