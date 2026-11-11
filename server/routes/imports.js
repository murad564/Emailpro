import { Router } from 'express';
import ExcelJS from 'exceljs';
import { one, many, tx, query } from '../db.js';
import { asyncH, HttpError, isValidEmail, normalizeEmail, cleanStr, intOr } from '../util.js';
import { getOrCreate, getOrCreateCity, parseTags, setContactTags } from '../lookups.js';

const r = Router();

r.get('/', asyncH(async (req, res) => {
  const rows = await many(
    `SELECT i.id, i.file_name, i.status, i.total_rows, i.imported, i.updated, i.skipped_existing, i.duplicates_in_file,
            i.invalid, i.suppressed, i.created_at, i.finished_at, u.name AS created_by_name
     FROM import_history i LEFT JOIN users u ON u.id = i.created_by ORDER BY i.created_at DESC LIMIT 100`
  );
  res.json({ rows });
}));

r.get('/:id(\\d+)', asyncH(async (req, res) => {
  const row = await one('SELECT * FROM import_history WHERE id = $1', [req.params.id]);
  if (!row) throw new HttpError(404, 'Import not found.');
  res.json(row);
}));

r.post('/', asyncH(async (req, res) => {
  const b = req.body || {};
  const options = {
    existing: b.options?.existing === 'update' ? 'update' : 'skip',
    default_category: cleanStr(b.options?.default_category, 120),
    default_country: cleanStr(b.options?.default_country, 120),
    default_city: cleanStr(b.options?.default_city, 120),
    default_language: cleanStr(b.options?.default_language, 60),
    add_tags: parseTags(b.options?.add_tags),
  };
  const row = await one(
    `INSERT INTO import_history (file_name, total_rows, mapping, options, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [cleanStr(b.file_name, 200) || 'upload', intOr(b.total_rows, 0), JSON.stringify(b.mapping || {}), JSON.stringify(options), req.user.id]
  );
  res.status(201).json({ id: row.id });
}));

const MAX_INVALID_KEEP = 5000;

r.post('/:id(\\d+)/rows', asyncH(async (req, res) => {
  const imp = await one('SELECT * FROM import_history WHERE id = $1', [req.params.id]);
  if (!imp) throw new HttpError(404, 'Import not found.');
  if (imp.status !== 'running') throw new HttpError(409, 'This import is already finished.');
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (rows.length > 5000) throw new HttpError(400, 'Send at most 5,000 rows per request.');
  const opt = imp.options || {};
  const stats = { imported: 0, updated: 0, skipped_existing: 0, duplicates_in_file: 0, invalid: 0, suppressed: 0 };
  const invalidRows = [];

  await tx(async (client) => {
    const caches = { countries: new Map(), cities: new Map(), categories: new Map(), tags: new Map() };
    const emails = rows.map((x) => normalizeEmail(x.email));
    const suppressed = new Set(
      (await client.query('SELECT lower(email) AS e FROM suppression_list WHERE lower(email) = ANY($1::text[])', [emails])).rows.map((x) => x.e)
    );
    const existingMap = new Map(
      (await client.query('SELECT id, lower(email) AS e, import_id FROM contacts WHERE lower(email) = ANY($1::text[])', [emails])).rows.map((x) => [x.e, x])
    );
    const seen = new Set();

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i] || {};
      const rowNo = raw.__row ?? null;
      const email = normalizeEmail(raw.email);
      if (!isValidEmail(email)) {
        stats.invalid++;
        invalidRows.push({ row: rowNo, email: String(raw.email ?? '').slice(0, 200), reason: email ? 'Invalid email format' : 'Missing email' });
        continue;
      }
      if (seen.has(email)) {
        stats.duplicates_in_file++;
        continue;
      }
      seen.add(email);
      const ex = existingMap.get(email);
      if (ex && ex.import_id === imp.id) {
        // Already inserted by an earlier chunk of this same file.
        stats.duplicates_in_file++;
        continue;
      }
      if (ex && opt.existing !== 'update') {
        stats.skipped_existing++;
        continue;
      }

      let first = cleanStr(raw.first_name, 120);
      let last = cleanStr(raw.last_name, 120);
      let full = cleanStr(raw.full_name, 240);
      if (!full) full = [first, last].filter(Boolean).join(' ');
      if (full && !first && !last) {
        const parts = full.split(' ');
        first = parts.shift() || '';
        last = parts.join(' ');
      }
      const countryId = await getOrCreate(client, 'countries', cleanStr(raw.country, 120) || opt.default_country, caches.countries);
      const cityId = await getOrCreateCity(client, countryId, cleanStr(raw.city, 120) || opt.default_city, caches.cities);
      const categoryId = await getOrCreate(client, 'categories', cleanStr(raw.category, 120) || opt.default_category, caches.categories);
      const language = cleanStr(raw.language, 60) || opt.default_language || '';
      const tags = [...parseTags(raw.tags), ...(opt.add_tags || [])];
      const isSup = suppressed.has(email);
      const v = {
        full, first, last,
        company: cleanStr(raw.company, 240), phone: cleanStr(raw.phone, 60), notes: String(raw.notes ?? '').slice(0, 5000),
      };

      if (ex) {
        // Update mode: fill in provided values; never blank out existing data, never change subscription status.
        await client.query(
          `UPDATE contacts SET
             full_name = COALESCE(NULLIF($2,''), full_name), first_name = COALESCE(NULLIF($3,''), first_name),
             last_name = COALESCE(NULLIF($4,''), last_name), company = COALESCE(NULLIF($5,''), company),
             phone = COALESCE(NULLIF($6,''), phone), notes = COALESCE(NULLIF($7,''), notes),
             language = COALESCE(NULLIF($8,''), language),
             country_id = COALESCE($9, country_id), city_id = COALESCE($10, city_id), category_id = COALESCE($11, category_id),
             updated_at = now()
           WHERE id = $1`,
          [ex.id, v.full, v.first, v.last, v.company, v.phone, v.notes, language, countryId, cityId, categoryId]
        );
        if (tags.length) await setContactTags(client, ex.id, tags, caches.tags, { replace: false });
        stats.updated++;
      } else {
        const ins = await client.query(
          `INSERT INTO contacts (email, full_name, first_name, last_name, company, phone, notes, language, country_id, city_id, category_id, status, import_id, status_changed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
           ON CONFLICT (lower(email)) DO NOTHING RETURNING id`,
          [email, v.full, v.first, v.last, v.company, v.phone, v.notes, language, countryId, cityId, categoryId, isSup ? 'unsubscribed' : 'subscribed', imp.id]
        );
        if (!ins.rows[0]) {
          stats.skipped_existing++;
          continue;
        }
        if (tags.length) await setContactTags(client, ins.rows[0].id, tags, caches.tags, { replace: false });
        stats.imported++;
        if (isSup) stats.suppressed++;
      }
    }

    await client.query(
      `UPDATE import_history SET imported = imported + $2, updated = updated + $3, skipped_existing = skipped_existing + $4,
         duplicates_in_file = duplicates_in_file + $5, invalid = invalid + $6, suppressed = suppressed + $7,
         invalid_rows = CASE WHEN jsonb_array_length(invalid_rows) < ${MAX_INVALID_KEEP} THEN invalid_rows || $8::jsonb ELSE invalid_rows END
       WHERE id = $1`,
      [imp.id, stats.imported, stats.updated, stats.skipped_existing, stats.duplicates_in_file, stats.invalid, stats.suppressed, JSON.stringify(invalidRows)]
    );
  });
  res.json(stats);
}));

r.post('/:id(\\d+)/finish', asyncH(async (req, res) => {
  const status = req.body.cancelled ? 'cancelled' : 'completed';
  const row = await one(
    `UPDATE import_history SET status = $2, finished_at = now() WHERE id = $1 AND status = 'running' RETURNING *`,
    [req.params.id, status]
  );
  if (!row) throw new HttpError(404, 'Import not found or already finished.');
  res.json(row);
}));

r.get('/:id(\\d+)/invalid.xlsx', asyncH(async (req, res) => {
  const row = await one('SELECT file_name, invalid_rows FROM import_history WHERE id = $1', [req.params.id]);
  if (!row) throw new HttpError(404, 'Import not found.');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Invalid rows');
  ws.columns = [
    { header: 'Row in file', key: 'row', width: 12 },
    { header: 'Email value', key: 'email', width: 40 },
    { header: 'Problem', key: 'reason', width: 30 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const x of row.invalid_rows || []) ws.addRow(x);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="invalid_rows_import_${req.params.id}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

export default r;
