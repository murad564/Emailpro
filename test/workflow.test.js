// End-to-end test of the full workflow against a real PostgreSQL database.
// Brevo is replaced by test/mock-brevo.js (same request/response shapes) because tests must not send real email.
// Usage: DATABASE_URL=postgres://... node test/workflow.test.js
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import pg from 'pg';
import { startMockBrevo } from './mock-brevo.js';

const PORT = 3911;
const BASE = `http://localhost:${PORT}`;
const KEY = 'xkeysib-test-key';
const DB = process.env.DATABASE_URL;
let cookie = '';
const step = (n, s) => console.log(`\n▶ Step ${n}: ${s}`);
const ok = (s) => console.log(`  ✓ ${s}`);

async function api(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { cookie, 'X-Requested-With': 'AristokratMail', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  if (raw) return res;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data?.error}`);
  return data;
}

const waitFor = async (fn, ms = 30000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 300));
  }
};

async function buildExcel(path) {
  const places = [
    ['Azerbaijan', 'Baku', 'Travel Agencies', 'Azerbaijani'], ['Azerbaijan', 'Ganja', 'Travel Agencies', 'Azerbaijani'],
    ['UAE', 'Dubai', 'Travel Agencies', 'English'], ['UAE', 'Abu Dhabi', 'Tour Operators', 'English'],
    ['Saudi Arabia', 'Riyadh', 'Tour Operators', 'Arabic'], ['Turkey', 'Istanbul', 'Travel Partners', 'Turkish'],
    ['Kazakhstan', 'Almaty', 'Corporate', 'Russian'], ['Israel', 'Tel Aviv', 'Tour Operators', 'English'],
  ];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Agencies');
  ws.addRow(['First Name', 'Last Name', 'E-mail', 'Company', 'Country', 'City', 'Phone', 'Category', 'Language', 'Tags', 'Comment']);
  let invalid = 0, dup = 0;
  for (let i = 1; i <= 1000; i++) {
    const p = places[i % places.length];
    let email = `agent${i}@agency${i % 300}.example.com`;
    if (i % 67 === 0) { email = `broken-email-${i}.example.com`; invalid++; }
    else if (i % 50 === 0) { email = `AGENT${i - 1}@agency${(i - 1) % 300}.example.com`; dup++; } // same as previous row, different case
    ws.addRow([`Name${i}`, `Surname${i}`, email, `Agency ${i % 300} LLC`, p[0], p[1], `+99450${String(i).padStart(7, '0')}`, p[2], p[3], i % 3 ? 'B2B' : 'B2B, VIP', '']);
  }
  await wb.xlsx.writeFile(path);
  return { invalid, dup };
}

async function main() {
  const brevo = startMockBrevo(4556, { key: KEY });
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

  const server = spawn('node', ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), APP_SECRET: 'workflow-test-secret-0123456789abcdef', ADMIN_EMAIL: 'nizami@aristokrat.az', ADMIN_PASSWORD: 'TestPass123',
      ADMIN_NAME: 'Nizami Hasanov', BREVO_BASE_URL: 'http://localhost:4556/v3', JOB_POLL_MS: '300', BREVO_MIN_GAP_MS: '0', APP_URL: 'https://mail.example.org' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  try {
    await waitFor(async () => (await fetch(BASE + '/healthz').catch(() => null))?.ok, 20000, 'server');
    await api('/auth/login', { method: 'POST', body: { email: 'nizami@aristokrat.az', password: 'TestPass123' } });
    ok('Signed in as admin');

    // Setup: connect Brevo + compliance settings
    await assert.rejects(api('/brevo/key', { method: 'POST', body: { api_key: 'xkeysib-wrong' } }), /rejected/);
    await api('/brevo/key', { method: 'POST', body: { api_key: KEY } });
    const st = await api('/brevo/status');
    assert.equal(st.connected, true);
    assert.equal(st.plan.credits, 100000);
    const keyRow = (await db.query("SELECT value FROM settings WHERE key='brevo_secret'")).rows[0];
    assert.ok(!JSON.stringify(keyRow).includes(KEY), 'API key must be stored encrypted');
    assert.ok(!JSON.stringify(st).includes(KEY), 'API key must never be returned to the browser');
    ok('Brevo connected; key encrypted at rest and never returned to the frontend');
    await api('/settings', { method: 'PUT', body: { general: { company_name: 'Aristokrat Travel Azerbaijan', company_address: '28 May street 3\nBaku AZ1010, Azerbaijan', website: 'https://aristokrat.az' }, sender: { sender_name: 'Aristokrat Travel', sender_email: 'marketing@aristokrat.az', reply_to: 'info@aristokrat.az' } } });

    step(1, 'Import an Excel file containing 1,000 contacts');
    const file = '/tmp/agencies_1000.xlsx';
    const truth = await buildExcel(file);
    const wbk = XLSX.read(await (await import('node:fs/promises')).readFile(file), { type: 'buffer' });
    const grid = XLSX.utils.sheet_to_json(wbk.Sheets[wbk.SheetNames[0]], { header: 1, raw: false, defval: '' });
    assert.equal(grid.length, 1001);
    ok(`Parsed file: 1,000 data rows (${truth.invalid} invalid emails, ${truth.dup} duplicates planted)`);

    step(2, 'Map the columns');
    const headers = grid[0];
    const mapping = { first_name: 'First Name', last_name: 'Last Name', email: 'E-mail', company: 'Company', country: 'Country', city: 'City', phone: 'Phone', category: 'Category', language: 'Language', tags: 'Tags', notes: 'Comment' };
    const idx = Object.fromEntries(Object.entries(mapping).map(([k, h]) => [k, headers.indexOf(h)]));
    Object.values(idx).forEach((i) => assert.ok(i >= 0));
    const rows = grid.slice(1).map((r, i) => ({ __row: i + 2, ...Object.fromEntries(Object.entries(idx).map(([k, i2]) => [k, r[i2]])) }));
    ok('All 11 columns mapped');

    step(3, 'Detect duplicates');
    const emails = rows.map((r) => r.email.toLowerCase());
    const pre = await api('/contacts/check-duplicates', { method: 'POST', body: { emails } });
    assert.equal(pre.existing.length, 0);
    ok('No existing contacts in database before import');

    step(4, 'Import the contacts');
    const imp = await api('/imports', { method: 'POST', body: { file_name: 'agencies_1000.xlsx', total_rows: rows.length, mapping, options: { existing: 'skip' } } });
    for (let i = 0; i < rows.length; i += 300) await api(`/imports/${imp.id}/rows`, { method: 'POST', body: { rows: rows.slice(i, i + 300) } });
    const report = await api(`/imports/${imp.id}/finish`, { method: 'POST', body: {} });
    assert.equal(report.invalid, truth.invalid);
    assert.equal(report.duplicates_in_file, truth.dup);
    assert.equal(report.imported, 1000 - truth.invalid - truth.dup);
    ok(`Import report: ${report.imported} imported, ${report.duplicates_in_file} duplicates, ${report.invalid} invalid`);
    // Re-import same file: everything must be skipped (duplicate prevention)
    const imp2 = await api('/imports', { method: 'POST', body: { file_name: 'again.xlsx', total_rows: rows.length, mapping, options: { existing: 'skip' } } });
    const again = await api(`/imports/${imp2.id}/rows`, { method: 'POST', body: { rows } });
    await api(`/imports/${imp2.id}/finish`, { method: 'POST', body: {} });
    assert.equal(again.imported, 0);
    assert.equal(again.skipped_existing, report.imported);
    ok('Re-importing the same file imports 0 (all detected as existing)');
    const total = (await api('/contacts?pageSize=10')).total;
    assert.equal(total, report.imported);

    step(5, 'Filter contacts by country and city');
    const L = await api('/contacts/lookups');
    const aze = L.countries.find((c) => c.name === 'Azerbaijan');
    const baku = L.cities.find((c) => c.name === 'Baku' && c.country_id === aze.id);
    assert.ok(aze && baku);
    const filtered = await api(`/contacts?country_ids=${aze.id}&city_ids=${baku.id}&pageSize=200`);
    assert.ok(filtered.total > 100, `need >100 Baku contacts, got ${filtered.total}`);
    assert.ok(filtered.rows.every((r) => r.country === 'Azerbaijan' && r.city === 'Baku'));
    const searchRes = await api('/contacts?search=agency 7 llc');
    assert.ok(searchRes.total > 0);
    ok(`${filtered.total} contacts in Azerbaijan · Baku; search works`);

    step(6, 'Save the filtered contacts as an audience segment');
    const seg = await api('/segments', { method: 'POST', body: { name: 'Agencies – Baku', filters: { country_ids: [aze.id], city_ids: [baku.id] } } });
    const segs = await api('/segments');
    assert.equal(segs.rows[0].subscribed, filtered.total);
    ok(`Segment "Agencies – Baku" saved with ${segs.rows[0].subscribed} subscribed contacts`);

    step(7, 'Create an HTML email campaign');
    const html = `<!DOCTYPE html><html><body style="font-family:Arial"><h1>Discover Azerbaijan</h1>
      <p>Hello {{first_name}},</p><p>We are pleased to introduce our latest Azerbaijan travel packages for {{company_name}} in {{city}}.</p>
      <p><a href="https://aristokrat.az">See packages</a></p><p>Best regards,<br>Aristokrat Travel Azerbaijan</p></body></html>`;
    const camp = await api('/campaigns', { method: 'POST', body: {
      name: 'Baku agencies – November', subject: 'New packages for {{company_name}}', preheader: 'Baku, Gabala, Sheki',
      sender_name: 'Aristokrat Travel', sender_email: 'marketing@aristokrat.az', reply_to: 'info@aristokrat.az',
      editor_mode: 'html', html, audience: { type: 'segment', segment_id: seg.id }, send_limit: 100, randomize: true,
    } });
    ok(`Campaign #${camp.id} created`);

    step(8, 'Preview the email on desktop and mobile');
    const prev = await api('/campaigns/render-preview', { method: 'POST', body: { html, editor_mode: 'html', preheader: 'Baku, Gabala, Sheki', subject: 'New packages for {{company_name}}', contact_id: filtered.rows[0].id } });
    assert.ok(prev.html.includes(`Hello ${filtered.rows[0].first_name},`));
    assert.ok(prev.html.includes('28 May street 3'), 'compliance footer with postal address');
    assert.ok(prev.html.includes('Unsubscribe'));
    assert.ok(!prev.html.includes('{{'), 'no unreplaced variables');
    const prevFallback = await api('/campaigns/render-preview', { method: 'POST', body: { html, editor_mode: 'html' } });
    assert.ok(prevFallback.html.includes('Hello Valued Partner,'), 'fallback for missing first name');
    ok('Rendered preview personalised, fallback works, footer + unsubscribe added (desktop/mobile is the same HTML at two widths in the UI)');

    step(9, 'Send a test email through Brevo');
    await api('/campaigns/test', { method: 'POST', body: { ...camp, html, editor_mode: 'html', subject: 'New packages for {{company_name}}', sender_name: 'Aristokrat Travel', sender_email: 'marketing@aristokrat.az', to: 'nizami@aristokrat.az' } });
    const t = brevo.state.transactional.at(-1);
    assert.equal(t.to[0].email, 'nizami@aristokrat.az');
    assert.ok(t.subject.startsWith('[TEST]'));
    await assert.rejects(api('/campaigns/test', { method: 'POST', body: { html, editor_mode: 'html', subject: 'x', sender_email: 'unverified@gmail.com', to: 'a@b.co' } }), /Sender is not valid/);
    ok('Test email accepted by Brevo /smtp/email; unverified senders are rejected with Brevo\'s error');

    step(10, 'Select 100 recipients');
    const pv = await api('/campaigns/preview-audience', { method: 'POST', body: { id: camp.id, audience: { type: 'segment', segment_id: seg.id }, send_limit: 100 } });
    assert.equal(pv.will_send, 100);
    ok(`Audience: ${pv.matching} matching, ${pv.eligible} eligible → will send ${pv.will_send}`);

    step(11, 'Confirm and send the campaign through Brevo');
    const sent = await api(`/campaigns/${camp.id}/send`, { method: 'POST', body: {} });
    assert.equal(sent.recipients, 100);
    await assert.rejects(api(`/campaigns/${camp.id}/send`, { method: 'POST', body: {} }), /already|409/);
    ok('Double-send blocked while sending');
    await waitFor(async () => (await api(`/campaigns/${camp.id}`)).status === 'sent', 30000, 'campaign sent');
    const bc = [...brevo.state.campaigns.values()].at(-1);
    const list = brevo.state.lists.get(bc.recipients.listIds[0]);
    assert.equal(list.members.size, 100);
    assert.equal(bc.status, 'sent');
    assert.ok(bc.htmlContent.includes('{{ contact.FIRSTNAME | default : "Valued Partner" }}'));
    assert.ok(bc.htmlContent.includes('{{ unsubscribe }}'));
    assert.ok(bc.subject.includes('{{ contact.COMPANY_NAME'));
    const bakuEmails = new Set((await db.query(`SELECT lower(c.email) e FROM contacts c WHERE c.city_id=$1`, [baku.id])).rows.map((r) => r.e));
    assert.ok([...list.members].every((e) => bakuEmails.has(e)), 'only Baku contacts in the Brevo list');
    ok(`Brevo campaign #${bc.id} created for list #${list.id} with exactly 100 Baku contacts and sent (sendNow)`);

    step(12, 'Display campaign statistics');
    await api(`/campaigns/${camp.id}/sync-stats`, { method: 'POST' });
    // Per-recipient events via Brevo webhooks
    const token = (await db.query("SELECT value FROM settings WHERE key='webhook_token'")).rows[0].value.token;
    const recips = [...list.members];
    const hook = (ev) => fetch(`${BASE}/api/webhooks/brevo/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ev) });
    assert.equal((await fetch(`${BASE}/api/webhooks/brevo/wrongtoken`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
    for (const e of recips.slice(0, 90)) await hook({ event: 'delivered', email: e, camp_id: bc.id });
    for (const e of recips.slice(0, 30)) await hook({ event: 'opened', email: e, camp_id: bc.id });
    for (const e of recips.slice(0, 8)) await hook({ event: 'click', email: e, camp_id: bc.id });
    await hook({ event: 'unsubscribe', email: recips[0], camp_id: bc.id });
    await hook({ event: 'hard_bounce', email: recips[99], camp_id: bc.id });
    const rep = await api(`/campaigns/${camp.id}/report`);
    assert.equal(rep.local.delivered, 90);
    assert.equal(rep.local.opened, 30);
    assert.equal(rep.local.clicked, 8);
    assert.equal(rep.local.hard_bounce, 1);
    const s = rep.campaign.stats;
    assert.equal(s.sent, 100);
    assert.ok(s.delivered >= 90 && s.unique_opens >= 30);
    const unsubC = (await db.query('SELECT status FROM contacts WHERE lower(email)=$1', [recips[0]])).rows[0];
    const bounceC = (await db.query('SELECT status FROM contacts WHERE lower(email)=$1', [recips[99]])).rows[0];
    assert.equal(unsubC.status, 'unsubscribed');
    assert.equal(bounceC.status, 'bounced');
    const dash = await api('/dashboard');
    assert.equal(dash.counts.unsubscribed, 1);
    assert.equal(dash.counts.bounced, 1);
    assert.ok(dash.email.open_rate > 0);
    ok(`Stats: sent ${s.sent}, delivered ${s.delivered}, opens ${s.unique_opens}, clicks ${s.unique_clicks}; unsubscribe + hard bounce suppressed contacts`);

    // Send-to-more: never repeats a recipient, never includes the unsubscribed/bounced
    await api(`/campaigns/${camp.id}/send`, { method: 'POST', body: {} });
    await waitFor(async () => (await api(`/campaigns/${camp.id}`)).status === 'sent' && (await db.query('SELECT count(*)::int n FROM campaign_batches WHERE campaign_id=$1 AND status=$2', [camp.id, 'sent'])).rows[0].n === 2, 30000, 'second batch');
    const bc2 = [...brevo.state.campaigns.values()].at(-1);
    const list2 = brevo.state.lists.get(bc2.recipients.listIds[0]);
    const overlap = [...list2.members].filter((e) => list.members.has(e));
    assert.equal(overlap.length, 0);
    const dupRows = (await db.query('SELECT lower(email), count(*) FROM campaign_recipients WHERE campaign_id=$1 GROUP BY 1 HAVING count(*)>1', [camp.id])).rows;
    assert.equal(dupRows.length, 0);
    ok(`"Send to more" sent ${list2.members.size} new recipients, 0 overlap with the first 100`);

    // Brevo blocklist sync of the locally suppressed contact
    await api('/brevo/sync-suppression', { method: 'POST' });
    const sup = await api('/suppression');
    assert.equal(sup.total, 2);
    ok('Suppression list contains the unsubscribe and the hard bounce');

    step(13, 'Export the contact list and campaign report to Excel');
    const exp = await api(`/contacts/export?country_ids=${aze.id}&city_ids=${baku.id}`, { raw: true });
    assert.equal(exp.status, 200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(await exp.arrayBuffer()));
    const sheet = book.getWorksheet('Contacts');
    assert.equal(sheet.getRow(1).getCell(4).value, 'Email Address');
    assert.equal(sheet.rowCount - 1, filtered.total);
    const allExp = await api('/contacts/export', { raw: true });
    const book2 = new ExcelJS.Workbook();
    await book2.xlsx.load(Buffer.from(await allExp.arrayBuffer()));
    assert.equal(book2.getWorksheet('Contacts').rowCount - 1, report.imported);
    ok(`Contacts export: ${filtered.total} Baku rows, ${report.imported} rows for "all", 14 labelled columns`);
    const rx = await api(`/campaigns/${camp.id}/report.xlsx`, { raw: true });
    const book3 = new ExcelJS.Workbook();
    await book3.xlsx.load(Buffer.from(await rx.arrayBuffer()));
    assert.deepEqual(book3.worksheets.map((w) => w.name), ['Summary', 'Batches', 'Recipients']);
    const sum = book3.getWorksheet('Summary');
    const hdr = sum.getRow(1).values.filter(Boolean);
    for (const h of ['Campaign Name', 'Email Subject', 'Date & Time', 'Country', 'City', 'Selected Audience', 'Total Recipients', 'Successfully Sent', 'Delivered', 'Opened', 'Clicked', 'Bounced', 'Failed', 'Unsubscribed']) assert.ok(hdr.includes(h), h);
    assert.equal(sum.getRow(2).getCell(5).value, 'Azerbaijan');
    assert.equal(sum.getRow(2).getCell(6).value, 'Baku');
    assert.equal(book3.getWorksheet('Recipients').rowCount - 1, 100 + list2.members.size);
    ok('Campaign report export: Summary / Batches / Recipients sheets with all required columns');

    // Extra checks
    console.log('\n▶ Extra checks');
    await api('/settings', { method: 'PUT', body: { general: { company_address: '' } } });
    const c3 = await api('/campaigns', { method: 'POST', body: { name: 'No address', subject: 's', html: '<p>x</p>', sender_email: 'marketing@aristokrat.az', sender_name: 'A' } });
    await assert.rejects(api(`/campaigns/${c3.id}/send`, { method: 'POST', body: {} }), /postal address/);
    ok('Sending blocked without a postal address in Settings');
    await api('/settings', { method: 'PUT', body: { general: { company_address: '28 May street 3, Baku' } } });
    brevo.state.credits = 5;
    await assert.rejects(api(`/campaigns/${c3.id}/send`, { method: 'POST', body: {} }), /credits/);
    ok('Sending blocked when Brevo credits are insufficient');
    brevo.state.credits = 100000;
    const future = new Date(Date.now() + 3600_000).toISOString();
    await api(`/campaigns/${c3.id}`, { method: 'PUT', body: { name: 'Scheduled', subject: 's', html: '<p>x</p>', sender_email: 'marketing@aristokrat.az', sender_name: 'A', send_limit: 50 } });
    const sch = await api(`/campaigns/${c3.id}/send`, { method: 'POST', body: { scheduled_at: future } });
    assert.equal((await api(`/campaigns/${c3.id}`)).status, 'scheduled');
    await api(`/campaigns/${c3.id}/cancel`, { method: 'POST' });
    assert.equal((await api(`/campaigns/${c3.id}`)).status, 'cancelled');
    ok(`Scheduled campaign (${sch.recipients} recipients) cancelled before sending`);
    const c4 = await api(`/campaigns/${camp.id}/duplicate`, { method: 'POST' });
    assert.equal((await api(`/campaigns/${c4.id}`)).status, 'draft');
    ok('Campaign duplicated as a draft');
    const lo = await api('/auth/logout', { method: 'POST' });
    cookie = '';
    await assert.rejects(api('/contacts'), /401/);
    ok('API refuses requests without a session');

    console.log('\n✅ All workflow steps passed.');
  } catch (e) {
    console.error('\n❌ FAILED:', e.message);
    console.error(serverLog.split('\n').slice(-40).join('\n'));
    process.exitCode = 1;
  } finally {
    server.kill('SIGTERM');
    brevo.close();
    await db.end();
  }
}

main();
