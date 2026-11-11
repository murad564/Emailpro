// Image hosting for email content. Images must be publicly reachable by email clients,
// so GET /m/:id is public; uploading requires sign-in.
import { Router } from 'express';
import { one, many, query } from '../db.js';
import { asyncH, HttpError, randomToken } from '../util.js';
import { appUrl } from '../settings.js';

export const mediaApi = Router();
export const mediaPublic = Router();

const ALLOWED = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const MAX = 5 * 1024 * 1024;

const urlFor = (req, id, mime) => `${appUrl() || `${req.protocol}://${req.get('host')}`}/m/${id}.${ALLOWED[mime] || 'img'}`;

mediaApi.get('/', asyncH(async (req, res) => {
  const rows = await many('SELECT id, file_name, mime, size, created_at FROM media ORDER BY created_at DESC LIMIT 200');
  res.json({ rows: rows.map((r) => ({ ...r, url: urlFor(req, r.id, r.mime) })) });
}));

mediaApi.post('/', asyncH(async (req, res) => {
  const { data, mime, file_name } = req.body || {};
  if (!ALLOWED[mime]) throw new HttpError(400, 'Only PNG, JPG, GIF or WEBP images are allowed.');
  const buf = Buffer.from(String(data || ''), 'base64');
  if (!buf.length) throw new HttpError(400, 'Empty file.');
  if (buf.length > MAX) throw new HttpError(400, 'Image is larger than 5 MB. Please resize it first.');
  const id = randomToken(12);
  await query('INSERT INTO media (id, file_name, mime, size, data, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [
    id, String(file_name || '').slice(0, 200), mime, buf.length, buf, req.user.id,
  ]);
  res.status(201).json({ id, url: urlFor(req, id, mime) });
}));

mediaApi.delete('/:id', asyncH(async (req, res) => {
  await query('DELETE FROM media WHERE id = $1', [req.params.id]);
  res.json({ deleted: true });
}));

mediaPublic.get('/:id', asyncH(async (req, res) => {
  const id = String(req.params.id).split('.')[0];
  const m = await one('SELECT mime, data FROM media WHERE id = $1', [id]);
  if (!m) return res.status(404).end();
  res.setHeader('Content-Type', m.mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.end(m.data);
}));
