import crypto from 'node:crypto';

const APP_SECRET = process.env.APP_SECRET || '';
if (!APP_SECRET || APP_SECRET.length < 24) {
  console.error('APP_SECRET must be set to a random string of at least 24 characters.');
  process.exit(1);
}

// Separate keys for signing and encryption, both derived from APP_SECRET.
export const JWT_KEY = crypto.createHash('sha256').update('jwt:' + APP_SECRET).digest();
const ENC_KEY = crypto.createHash('sha256').update('enc:' + APP_SECRET).digest();

/** AES-256-GCM. Output: base64(iv).base64(tag).base64(ciphertext) */
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload) {
  const [iv, tag, enc] = String(payload).split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Pragmatic email check: one @, no spaces, a dot in the domain, sane length and TLD.
const EMAIL_RE = /^[^\s@"'<>(),;:\\[\]]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;
export function normalizeEmail(v) {
  return String(v ?? '').trim().replace(/^mailto:/i, '').toLowerCase();
}
export function isValidEmail(v) {
  const e = normalizeEmail(v);
  if (!e || e.length > 254) return false;
  if (e.split('@')[0].length > 64) return false;
  if (e.includes('..')) return false;
  return EMAIL_RE.test(e);
}

export function cleanStr(v, max = 500) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, max);
}

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function intOr(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
