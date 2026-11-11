import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { migrate, one, query, pool } from './db.js';
import { HttpError, asyncH, normalizeEmail } from './util.js';
import { requireAuth, csrfGuard, issueSession, clearSession, checkPassword, ensureAdmin } from './auth.js';
import { getWebhookToken } from './settings.js';
import { startWorker, stopWorker } from './jobs.js';
import { registerSenderJobs, scheduleRecurring, handleWebhookEvent } from './sender.js';

import contacts from './routes/contacts.js';
import imports from './routes/imports.js';
import locations from './routes/locations.js';
import segments from './routes/segments.js';
import templates from './routes/templates.js';
import campaigns from './routes/campaigns.js';
import brevoRoutes, { registerBrevoJobs } from './routes/brevo.js';
import { users, settings, suppression, dashboard } from './routes/admin.js';
import { mediaApi, mediaPublic } from './routes/media.js';
import googleAuth, { googleEnabled } from './google.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // Email previews render user HTML inside sandboxed iframes and load remote images.
        'img-src': ["'self'", 'data:', 'blob:', 'https:', 'http:'],
        'frame-src': ["'self'", 'blob:', 'data:'],
        'style-src': ["'self'", "'unsafe-inline'"],
        'font-src': ["'self'", 'data:', 'https:'],
        'form-action': ["'self'", 'https://accounts.google.com'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(compression());
app.use(cookieParser());

// ---------- Public: health + Brevo webhooks ----------
app.get('/healthz', asyncH(async (req, res) => {
  await one('SELECT 1');
  res.json({ ok: true });
}));

app.use('/m', mediaPublic);

app.post('/api/webhooks/brevo/:token', express.json({ limit: '5mb' }), asyncH(async (req, res) => {
  if (req.params.token !== (await getWebhookToken())) return res.status(404).end();
  const events = Array.isArray(req.body) ? req.body : [req.body];
  for (const ev of events) await handleWebhookEvent(ev).catch((e) => console.error('webhook event error', e.message));
  res.json({ ok: true });
}));

app.use('/api', express.json({ limit: '25mb' }), csrfGuard);

// ---------- Auth ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' } });

app.post('/api/auth/login', loginLimiter, asyncH(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const user = await one('SELECT * FROM users WHERE lower(email) = $1', [email]);
  const ok = user && user.active && (await checkPassword(String(req.body.password || ''), user.password_hash));
  if (!ok) throw new HttpError(401, 'Incorrect email or password.');
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  issueSession(res, user);
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
}));

app.get('/api/auth/config', (req, res) => res.json({ google: googleEnabled() }));
app.use('/api/auth/google', googleAuth);

app.post('/api/auth/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

// ---------- Protected API ----------
app.use('/api', requireAuth);
app.use('/api/dashboard', dashboard);
app.use('/api/contacts', contacts);
app.use('/api/imports', imports);
app.use('/api/locations', locations);
app.use('/api/segments', segments);
app.use('/api/templates', templates);
app.use('/api/campaigns', campaigns);
app.use('/api/brevo', brevoRoutes);
app.use('/api/users', users);
app.use('/api/settings', settings);
app.use('/api/suppression', suppression);
app.use('/api/media', mediaApi);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- Frontend ----------
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// ---------- Errors ----------
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: status >= 500 && !(err.name === 'BrevoError') ? err.message || 'Something went wrong.' : err.message,
    details: err.details,
  });
});

const port = Number(process.env.PORT || 3000);

async function main() {
  await migrate();
  await ensureAdmin();
  registerSenderJobs();
  registerBrevoJobs();
  if (process.env.DISABLE_WORKER !== 'true') {
    await startWorker();
    await scheduleRecurring();
  }
  const server = app.listen(port, () => console.log(`Aristokrat Mail listening on :${port}`));
  const shutdown = async () => {
    console.log('Shutting down…');
    server.close();
    await stopWorker();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error('Fatal startup error', e);
  process.exit(1);
});

export default app;
