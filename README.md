# Aristokrat Mail — Email Marketing with Brevo

A cloud web application for managing large contact databases, segmenting them by country and city, designing HTML emails, and sending controlled campaigns through the official **Brevo API**.

## What it does

| Section | Highlights |
|---|---|
| Dashboard | Contacts, countries, cities, subscribed/unsubscribed, campaigns sent, delivered, open/click/bounce rate, failed, remaining Brevo credits, charts, recent activity |
| Contacts | Add/edit/delete, search, filter by country/city/category/language/tags/status, multi-select, bulk delete/update, duplicate prevention, export selected/filtered/all, suppression list |
| Import / Export | .xlsx/.xls/.csv upload → Excel-style preview → column mapping (auto-guessed) → validation (invalid emails, duplicates in file, already in DB, suppressed) → confirm → report. Tested with 50,000 rows (~23 s) |
| Countries & Cities | Counts per country/city, rename/merge, delete; categories and tags management |
| Audience Segments | Unlimited saved segments (e.g. "Travel Agencies – UAE") that update automatically |
| Email Campaigns | 4-step wizard: details → content → audience & sending limit (100/200/300/500/1000/custom, random pick, batches, exclusions) → review, test email, send now or schedule. Pause / resume / cancel. Duplicate. "Send to more" never repeats a recipient |
| Email Editor | Drag-and-drop block builder (logo, heading, text, image upload, button, divider, spacer, social links, footer), HTML code editor with live preview, plain-text mode, desktop/mobile preview, personalisation variables with fallbacks |
| Templates | Library with create/edit/duplicate/preview/delete + 8 starter Aristokrat templates |
| Campaign Reports | Per-campaign stats, funnel, batches, per-recipient status (delivered/opened/clicked/bounced/unsubscribed), activity log, Excel export |
| Brevo Integration | Encrypted API key, connection test, credits, verified senders, webhook registration, two-way suppression sync, optional full contact sync |
| Settings | Company postal address (required footer), fallbacks, default sender, users & roles, password |

## How sending works

1. On confirmation, recipients are snapshotted (subscribed, not suppressed, not already sent this campaign; database-enforced unique per campaign + email).
2. A background job creates a Brevo list with exactly those contacts (`/contacts/import`), creates a Brevo email campaign for that list (`/emailCampaigns`) and sends it (`/emailCampaigns/{id}/sendNow`).
3. Brevo delivers. Statistics are polled from Brevo every 15 minutes; per-recipient events (delivered, opened, click, bounce, unsubscribe, spam) arrive via a Brevo marketing webhook registered automatically.
4. Unsubscribes, hard bounces and spam complaints go to the suppression list, are blocklisted in Brevo, and are never emailed again.

Test emails use Brevo's transactional endpoint (`/smtp/email`) so they never touch contact lists.

## Deploy (Render, ~10 minutes)

1. Render → **New → Blueprint** → connect this GitHub repository → branch `aristokrat-mail-v2`.
2. Enter `ADMIN_EMAIL` and `ADMIN_PASSWORD` when asked. Everything else (database, secret, URL) is created automatically.
3. Open the URL Render gives you, sign in, then: **Settings** → add the company postal address; **Brevo Integration** → paste the API key.

Cost on Render: web service *Starter* (~$7/month) + Postgres *Basic-256mb* (~$6/month). Free tiers are not suitable: the free web service sleeps (scheduled campaigns would not run) and the free database is deleted after 30 days.

Any Docker host works too (`Dockerfile` included) — set the variables from `.env.example`.

## Development

```bash
npm install
cp .env.example .env    # point DATABASE_URL at a local Postgres
node --env-file=.env server/index.js   # API on :3000
npm run dev:client      # UI on :5173 (proxies /api)
```

End-to-end test of the full workflow (1,000-row Excel import → segment → campaign → send → stats → exports), using a local stand-in for the Brevo API so no real email is sent:

```bash
DATABASE_URL=postgres://postgres@localhost/emailtest npm run test:workflow
```
