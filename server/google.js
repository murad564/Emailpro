// "Sign in with Google" (OAuth 2.0 authorization-code flow, server side).
// Only people who already have a user account (added by an admin) can sign in, unless their
// email domain is listed in GOOGLE_ALLOWED_DOMAINS, in which case a team-member account is created.
import { Router } from 'express';
import crypto from 'node:crypto';
import { one, query } from './db.js';
import { issueSession, hashPassword } from './auth.js';
import { appUrl } from './settings.js';
import { asyncH, normalizeEmail } from './util.js';

const r = Router();
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const ALLOWED_DOMAINS = (process.env.GOOGLE_ALLOWED_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
export const googleEnabled = () => !!(CLIENT_ID && CLIENT_SECRET);

const base = (req) => appUrl() || `${req.protocol}://${req.get('host')}`;
const redirectUri = (req) => `${base(req)}/api/auth/google/callback`;
const fail = (res, msg) => res.redirect(`/?login_error=${encodeURIComponent(msg)}`);

r.get('/start', (req, res) => {
  if (!googleEnabled()) return fail(res, 'Google sign-in is not configured.');
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('am_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 10 * 60_000, path: '/' });
  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirectUri(req), response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
});

r.get('/callback', asyncH(async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return fail(res, 'Google sign-in was cancelled.');
  if (!state || state !== req.cookies?.am_oauth_state) return fail(res, 'Sign-in expired. Please try again.');
  res.clearCookie('am_oauth_state', { path: '/' });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: String(code), client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: redirectUri(req), grant_type: 'authorization_code' }),
  });
  const tokens = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokens.id_token) return fail(res, 'Google did not accept the sign-in. Please try again.');

  // Verify the ID token with Google (signature, expiry) and check it was issued for this app.
  const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`);
  const info = await infoRes.json().catch(() => ({}));
  if (!infoRes.ok || info.aud !== CLIENT_ID || String(info.email_verified) !== 'true') return fail(res, 'Could not verify your Google account.');

  const email = normalizeEmail(info.email);
  let user = await one('SELECT * FROM users WHERE lower(email) = $1', [email]);
  if (!user) {
    const domain = email.split('@')[1];
    if (!ALLOWED_DOMAINS.includes(domain)) return fail(res, `${email} does not have access. Ask an administrator to add you in Settings → Users.`);
    user = await one('INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING *', [
      email, info.name || '', await hashPassword(crypto.randomBytes(24).toString('hex')), 'user',
    ]);
  }
  if (!user.active) return fail(res, 'Your account is disabled.');
  if (!user.name && info.name) await query('UPDATE users SET name = $2 WHERE id = $1', [user.id, info.name]);
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  issueSession(res, user);
  res.redirect('/');
}));

export default r;
