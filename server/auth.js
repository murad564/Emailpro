import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { one, query } from './db.js';
import { JWT_KEY, HttpError } from './util.js';

const COOKIE = 'am_session';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export function issueSession(res, user) {
  const token = jwt.sign({ uid: user.id }, JWT_KEY, { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) throw new HttpError(401, 'Please sign in.');
    let payload;
    try {
      payload = jwt.verify(token, JWT_KEY);
    } catch {
      throw new HttpError(401, 'Your session has expired. Please sign in again.');
    }
    const user = await one('SELECT id, email, name, role, active FROM users WHERE id = $1', [payload.uid]);
    if (!user || !user.active) throw new HttpError(401, 'Account not available.');
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Only administrators can do this.'));
  next();
}

// Simple CSRF defence: state-changing API calls must carry a custom header,
// which browsers will not attach on cross-site form posts.
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'AristokratMail') {
    return next(new HttpError(403, 'Request blocked (missing app header).'));
  }
  next();
}

export const hashPassword = (pw) => bcrypt.hash(pw, 11);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
}

/** Creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD when there are no users yet. */
export async function ensureAdmin() {
  const { rows } = await query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('No users exist yet. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin.');
    return;
  }
  await query('INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)', [
    email.trim().toLowerCase(),
    process.env.ADMIN_NAME || 'Administrator',
    await hashPassword(password),
    'admin',
  ]);
  console.log(`Created admin account ${email}`);
}
