import { Router } from 'express';
import { one, many, query } from '../db.js';
import { asyncH, HttpError, cleanStr } from '../util.js';

const r = Router();

r.get('/', asyncH(async (req, res) => {
  const rows = await many(
    `SELECT t.id, t.name, t.category, t.subject, t.preheader, t.editor_mode, t.html, t.updated_at, t.created_at, u.name AS created_by_name
     FROM email_templates t LEFT JOIN users u ON u.id = t.created_by ORDER BY t.updated_at DESC`
  );
  res.json({ rows });
}));

r.get('/:id(\\d+)', asyncH(async (req, res) => {
  const t = await one('SELECT * FROM email_templates WHERE id = $1', [req.params.id]);
  if (!t) throw new HttpError(404, 'Template not found.');
  res.json(t);
}));

function readBody(b) {
  const name = cleanStr(b.name, 160);
  if (!name) throw new HttpError(400, 'Template name is required.');
  const mode = ['html', 'visual', 'text'].includes(b.editor_mode) ? b.editor_mode : 'html';
  return {
    name, category: cleanStr(b.category, 120), subject: cleanStr(b.subject, 300), preheader: cleanStr(b.preheader, 300),
    editor_mode: mode, html: String(b.html || ''), text_body: String(b.text_body || ''),
    design: b.design ? JSON.stringify(b.design) : null,
  };
}

r.post('/', asyncH(async (req, res) => {
  const t = readBody(req.body);
  const row = await one(
    `INSERT INTO email_templates (name, category, subject, preheader, editor_mode, html, text_body, design, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [t.name, t.category, t.subject, t.preheader, t.editor_mode, t.html, t.text_body, t.design, req.user.id]
  );
  res.status(201).json(row);
}));

r.put('/:id(\\d+)', asyncH(async (req, res) => {
  const t = readBody(req.body);
  const n = (await query(
    `UPDATE email_templates SET name=$2, category=$3, subject=$4, preheader=$5, editor_mode=$6, html=$7, text_body=$8, design=$9, updated_at=now() WHERE id=$1`,
    [req.params.id, t.name, t.category, t.subject, t.preheader, t.editor_mode, t.html, t.text_body, t.design]
  )).rowCount;
  if (!n) throw new HttpError(404, 'Template not found.');
  res.json({ ok: true });
}));

r.post('/:id(\\d+)/duplicate', asyncH(async (req, res) => {
  const t = await one('SELECT * FROM email_templates WHERE id = $1', [req.params.id]);
  if (!t) throw new HttpError(404, 'Template not found.');
  const row = await one(
    `INSERT INTO email_templates (name, category, subject, preheader, editor_mode, html, text_body, design, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [`${t.name} (copy)`, t.category, t.subject, t.preheader, t.editor_mode, t.html, t.text_body, t.design ? JSON.stringify(t.design) : null, req.user.id]
  );
  res.status(201).json(row);
}));

r.delete('/:id(\\d+)', asyncH(async (req, res) => {
  const n = (await query('DELETE FROM email_templates WHERE id = $1', [req.params.id])).rowCount;
  if (!n) throw new HttpError(404, 'Template not found.');
  res.json({ deleted: true });
}));

export default r;
