import { one, query } from './db.js';
import { encrypt, decrypt, randomToken } from './util.js';

const DEFAULTS = {
  general: {
    company_name: 'Aristokrat Travel Azerbaijan',
    company_address: '',
    website: 'https://aristokrat.az',
    default_fallbacks: {
      first_name: 'Valued Partner',
      last_name: '',
      company_name: 'your company',
      country: 'your country',
      city: 'your city',
    },
  },
  sender: { sender_name: 'Aristokrat Travel Azerbaijan', sender_email: '', reply_to: '' },
  brevo: { configured: false },
};

export async function getSetting(key) {
  const row = await one('SELECT value FROM settings WHERE key = $1', [key]);
  if (!row) return structuredClone(DEFAULTS[key] ?? null);
  if (DEFAULTS[key] && typeof DEFAULTS[key] === 'object') return { ...DEFAULTS[key], ...row.value };
  return row.value;
}

export async function setSetting(key, value) {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

// ---- Brevo credentials: stored encrypted at rest; never sent to the browser.

export async function getBrevoApiKey() {
  if (process.env.BREVO_API_KEY) return process.env.BREVO_API_KEY;
  const row = await one("SELECT value FROM settings WHERE key = 'brevo_secret'");
  if (!row?.value?.api_key_enc) return null;
  try {
    return decrypt(row.value.api_key_enc);
  } catch {
    return null;
  }
}

export async function saveBrevoApiKey(apiKey) {
  const last4 = apiKey.slice(-4);
  await setSetting('brevo_secret', { api_key_enc: encrypt(apiKey) });
  const b = await getSetting('brevo');
  await setSetting('brevo', { ...b, configured: true, key_hint: `••••${last4}`, key_saved_at: new Date().toISOString() });
}

export async function clearBrevoApiKey() {
  await query("DELETE FROM settings WHERE key = 'brevo_secret'");
  const b = await getSetting('brevo');
  await setSetting('brevo', { ...b, configured: false, key_hint: null, connected: false });
}

export async function getWebhookToken() {
  let row = await one("SELECT value FROM settings WHERE key = 'webhook_token'");
  if (!row) {
    await setSetting('webhook_token', { token: randomToken(20) });
    row = await one("SELECT value FROM settings WHERE key = 'webhook_token'");
  }
  return row.value.token;
}

export function appUrl() {
  return (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` || '').replace(/\/$/, '');
}
