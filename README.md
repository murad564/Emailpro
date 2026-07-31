# EmailPro — Bulk Email Marketing Platform

A bulk email marketing platform built with Next.js 14, Prisma, SQLite, and Brevo.

## Quick start

```bash
npm install
npm run setup     # creates prisma/dev.db + generates the Prisma client
npm run db:seed   # optional: 80 demo contacts, 3 segments, 3 campaigns
npm run dev       # → http://localhost:3000
```

No environment variables, no external accounts, and no login are required to
boot the app. It opens straight onto the dashboard. You only need a Brevo API
key when you actually want to *send* mail — add it in **Settings** in the UI, or
set `BREVO_API_KEY` (see [Sending email](#sending-email)).

## Features

- **Contacts** — CRUD, CSV import/export, tag management, bulk delete
- **Segments** — Filter contacts by tags for targeted campaigns
- **Campaign Composer** — Rich text editor (Tiptap) with full formatting toolbar
- **Bulk Sending** — Rate-limited batch sending via Brevo API
- **Open Tracking** — 1×1 pixel tracking per contact per campaign
- **Click Tracking** — Link wrapping with redirect-and-record
- **Webhooks** — Brevo delivery event webhooks (delivered, bounced, complained)
- **Unsubscribe** — Auto-generated token-based unsubscribe page
- **Analytics** — Open rate, click rate, bounce rate charts (Recharts)
- **Dashboard** — 30-day overview with line + pie + bar charts

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Auth | None — single local demo user (`lib/current-user.ts`) |
| Database | SQLite (`prisma/dev.db`) via Prisma ORM |
| Email | Brevo API |
| Editor | Tiptap |
| Charts | Recharts |
| CSV | PapaParse |

## Setup

### 1. Clone & install

```bash
cd emailpro
npm install
```

### 2. Database

The app uses a local SQLite file — nothing to provision.

```bash
npm run setup      # prisma db push + prisma generate → creates prisma/dev.db
```

The database path is hardcoded in `prisma/schema.prisma`; `DATABASE_URL` is not
read.

### 3. Seed with demo data (optional)

```bash
npm run db:seed
```

Creates the demo user, 80 contacts, 3 segments and 3 campaigns. Re-running it
wipes and recreates that data.

> Note: the seed fills in each campaign's aggregate counters but does not create
> `email_events` rows. The Campaigns list reads the counters, while Analytics and
> the dashboard charts derive their numbers from events — so with seed data only,
> Analytics shows zeroes while Campaigns shows open/click rates. Sending a real
> campaign populates both.

### 4. Start dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). There is no login — every
request is attributed to a single local demo user defined in
`lib/current-user.ts`.

### 5. Environment variables (optional)

None are required to run the app. `.env.example` lists the two that matter:

| Variable | Purpose | Default if unset |
|----------|---------|------------------|
| `BREVO_API_KEY` | Sending mail. The Settings page stores a key in the database, which takes priority over this. | unset — sending fails |
| `NEXT_PUBLIC_APP_URL` | Base URL baked into tracking pixels and click-redirect links. | `http://localhost:3000` |

```bash
cp .env.example .env.local   # only if you want to set these
```

## Sending email

Sending goes through [Brevo](https://www.brevo.com) (free tier: 300 emails/day).

1. Get an API key: Brevo → **Settings → API Keys → Create a new API key**
2. Paste it into the app's **Settings** page (stored per-user in the database),
   or set `BREVO_API_KEY` in `.env.local`
3. Use **Settings → send a test email** to verify before running a campaign

The daily send cap is configurable in Settings (`dailySendLimit`, default 300)
and enforced by `lib/bulk-sender.ts`.

### Webhook setup

For delivery/bounce/complaint events, point a Brevo webhook at
`https://yourdomain.com/api/webhooks/brevo` and select the `delivered`, `bounced`
(hard + soft) and `spam` events.

> `app/api/webhooks/resend/` and `lib/resend.ts` are leftovers from an earlier
> Resend integration and are not part of the active send path.

## Project Structure

```
emailpro/
├── app/
│   ├── (dashboard)/     # Dashboard pages
│   │   ├── page.tsx          # Dashboard home
│   │   ├── contacts/         # Contact management
│   │   ├── segments/         # Audience segments
│   │   ├── campaigns/        # Campaign composer + list
│   │   ├── analytics/        # Analytics overview
│   │   └── settings/         # Brevo API key + send limit
│   ├── api/
│   │   ├── contacts/         # Contact CRUD + CSV import/export
│   │   ├── segments/         # Segment CRUD
│   │   ├── campaigns/        # Campaign CRUD + send trigger
│   │   ├── settings/         # Settings read/write + test email
│   │   ├── sync/brevo/       # Pull stats back from Brevo
│   │   ├── track/
│   │   │   ├── open/         # 1x1 pixel tracking
│   │   │   └── click/        # Click-through tracking
│   │   └── webhooks/brevo/   # Brevo delivery webhooks
│   └── unsubscribe/[token]/  # Public unsubscribe page
├── components/
│   ├── ui/              # Button, Input, Card, Badge, Modal
│   ├── layout/          # Sidebar, TopNav
│   ├── contacts/        # ContactForm, CsvImport
│   ├── campaigns/       # TiptapEditor
│   ├── segments/        # SegmentForm
│   ├── settings/        # SettingsForm
│   └── dashboard/       # StatsCard, Charts, SyncButton
├── lib/
│   ├── prisma.ts        # Prisma singleton
│   ├── brevo.ts         # Brevo API client
│   ├── current-user.ts  # Local demo user (stands in for auth)
│   ├── email-tracker.ts # Pixel + link injection
│   └── bulk-sender.ts   # Batched send engine
└── prisma/
    ├── schema.prisma    # DB schema
    ├── dev.db           # SQLite database (gitignored)
    └── seed.ts          # Demo data seed
```

## Database Schema

```
users          → Local demo user
user_settings  → Per-user Brevo API key + daily send limit
contacts       → Email list with tags
segments       → Named filters (all / by-tag)
campaigns      → Email campaigns with stats counters
email_events   → Every tracking event (sent/opened/clicked/bounced/etc.)
unsubscribes   → Per-contact per-campaign unsubscribe tokens
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run setup` | One-shot first-run: create `prisma/dev.db` + generate the client |
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run db:push` | Push Prisma schema to DB |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:migrate` | Run migrations (dev) |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Open Prisma Studio |
| `npm run typecheck` | TypeScript type check |
