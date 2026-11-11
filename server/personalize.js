// Personalisation variables and compliance footer.
// Users write {{first_name}} (optionally {{first_name|Fallback}}). For Brevo campaigns we convert to
// Brevo's template language with a safe default; for test emails we substitute values directly.

export const VARIABLES = {
  first_name: { brevo: 'FIRSTNAME', field: 'first_name' },
  last_name: { brevo: 'LASTNAME', field: 'last_name' },
  company_name: { brevo: 'COMPANY_NAME', field: 'company' },
  country: { brevo: 'COUNTRY', field: 'country' },
  city: { brevo: 'CITY', field: 'city' },
  full_name: { brevo: null, field: 'full_name' },
  email: { brevo: 'EMAIL', field: 'email' },
};

const VAR_RE = /\{\{\s*(first_name|last_name|company_name|country|city|full_name|email)\s*(?:\|\s*([^}]*?))?\s*\}\}/gi;
const UNSUB_RE = /\{\{\s*(unsubscribe_url|unsubscribe)\s*\}\}/gi;

const escHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const escBrevoStr = (s) => String(s ?? '').replace(/["\\]/g, '').replace(/[{}]/g, '');

export function toBrevoSyntax(html, fallbacks = {}) {
  return String(html)
    .replace(VAR_RE, (_, name, inlineFallback) => {
      const key = name.toLowerCase();
      const fb = escBrevoStr(inlineFallback ?? fallbacks[key] ?? '');
      if (key === 'full_name') {
        return `{{ contact.FIRSTNAME | default : "${fb}" }} {{ contact.LASTNAME | default : "" }}`;
      }
      if (key === 'email') return '{{ contact.EMAIL }}';
      return `{{ contact.${VARIABLES[key].brevo} | default : "${fb}" }}`;
    })
    .replace(UNSUB_RE, '{{ unsubscribe }}');
}

export function renderForContact(html, contact = {}, fallbacks = {}, { unsubscribeUrl = '#' } = {}) {
  return String(html)
    .replace(VAR_RE, (_, name, inlineFallback) => {
      const key = name.toLowerCase();
      let v = contact[VARIABLES[key].field];
      if (key === 'full_name' && !v) v = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
      v = String(v ?? '').trim();
      return escHtml(v || inlineFallback?.trim() || fallbacks[key] || '');
    })
    .replace(UNSUB_RE, unsubscribeUrl);
}

export function renderSubject(subject, contact, fallbacks) {
  // Subjects are plain text: substitute without HTML escaping.
  return String(subject).replace(VAR_RE, (_, name, inlineFallback) => {
    const key = name.toLowerCase();
    const v = String(contact?.[VARIABLES[key].field] ?? '').trim();
    return v || inlineFallback?.trim() || fallbacks[key] || '';
  });
}

export function hasUnsubscribeLink(html) {
  UNSUB_RE.lastIndex = 0;
  return UNSUB_RE.test(html);
}

export function textToHtml(text) {
  const paras = String(text || '')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px 0;">${escHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="max-width:640px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;">
${paras}
</div></body></html>`;
}

function footerHtml({ company_name, company_address, website }) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f6fb;">
<tr><td align="center" style="padding:20px 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#6b7280;">
<strong style="color:#1e3a5f;">${escHtml(company_name)}</strong><br>
${escHtml(company_address).replace(/\n/g, '<br>')}${website ? `<br><a href="${escHtml(website)}" style="color:#2563eb;">${escHtml(website.replace(/^https?:\/\//, ''))}</a>` : ''}<br>
You are receiving this email because of your business relationship with ${escHtml(company_name)}.<br>
<a href="{{unsubscribe_url}}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a> from future marketing emails.
</td></tr></table>`;
}

/**
 * Prepares the final HTML: adds the hidden preheader and, if the design lacks an unsubscribe link,
 * appends a compliance footer with the business address and unsubscribe link.
 */
export function finalizeHtml(html, { preheader, general }) {
  let out = String(html || '');
  if (!/<html[\s>]/i.test(out)) {
    out = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;">${out}</body></html>`;
  }
  const needsFooter = !hasUnsubscribeLink(out) || (general.company_address && !out.includes(general.company_address.split('\n')[0]));
  if (needsFooter) {
    const f = footerHtml(general);
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${f}</body>`) : out + f;
  }
  if (preheader) {
    const pre = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:transparent;opacity:0;">${escHtml(preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`;
    out = /<body[^>]*>/i.test(out) ? out.replace(/<body[^>]*>/i, (m) => m + pre) : pre + out;
  }
  return out;
}
