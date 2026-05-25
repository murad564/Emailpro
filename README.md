# EmailPro — Bulk Email Marketing Platform

A fully functional bulk email marketing platform built with Next.js 14, Supabase, Prisma, and Resend.

## Features

- **Auth** — Supabase signup/login with session management
- **Contacts** — CRUD, CSV import/export, tag management, bulk delete
- **Segments** — Filter contacts by tags for targeted campaigns
- **Campaign Composer** — Rich text editor (Tiptap) with full formatting toolbar
- **Bulk Sending** — Rate-limited batch sending via Resend API
- **Open Tracking** — 1×1 pixel tracking per contact per campaign
- **Click Tracking** — Link wrapping with redirect-and-record
- **Webhooks** — Resend delivery event webhooks (delivered, bounced, complained)
- **Unsubscribe** — Auto-generated token-based unsubscribe page
- **Analytics** — Open rate, click rate, bounce rate charts (Recharts)
- **Dashboard** — 30-day overview with line + pie + bar charts

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Auth | Supabase Auth |
| Database | Supabase Postgres via Prisma ORM |
| Email | Resend API |
| Editor | Tiptap |
| Charts | Recharts |
| CSV | PapaParse |

## Setup

### 1. Clone & install

```bash
cd emailpro
npm install
```

### 2. Environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Where to get it |
|----------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project → Settings → API → anon public key |
| `DATABASE_URL` | Supabase project → Settings → Database → Connection pooling URI (port 6543) |
| `DIRECT_URL` | Supabase project → Settings → Database → Direct connection URI (port 5432) |
| `RESEND_API_KEY` | resend.com → API Keys |
| `RESEND_WEBHOOK_SECRET` | resend.com → Webhooks → your endpoint → Signing Secret |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` (dev) or your deployment URL |

### 3. Supabase setup

1. Create a project at [supabase.com](https://supabase.com)
2. In **Authentication → URL Configuration** add `http://localhost:3000` to allowed redirect URLs
3. Disable email confirmation for easier local dev: **Authentication → Providers → Email → Disable "Confirm email"**

### 4. Database migration

```bash
npm run db:push        # Push schema to Supabase Postgres
npm run db:generate    # Generate Prisma client
```

### 5. Seed with demo data (optional)

First, create a user in Supabase Auth manually (or via the app signup).  
Then run:

```bash
npm run db:seed
```

### 6. Start dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Resend Setup

### Free tier limits
- 3,000 emails/month
- 100 emails/day
- 1 verified domain or use `onboarding@resend.dev` for testing

### Testing without a domain
Set `DEFAULT_FROM_EMAIL=onboarding@resend.dev` and you can send to your own verified email address only.

### Production domain
1. Add your domain in Resend → Domains
2. Add the DNS records shown
3. Update `DEFAULT_FROM_EMAIL` to `you@yourdomain.com`

### Webhook setup
1. In Resend → Webhooks → Add endpoint: `https://yourdomain.com/api/webhooks/resend`
2. Select events: `email.delivered`, `email.bounced`, `email.complained`
3. Copy the signing secret to `RESEND_WEBHOOK_SECRET`

## Project Structure

```
emailpro/
├── app/
│   ├── (auth)/          # Login, signup pages
│   ├── (dashboard)/     # Protected dashboard pages
│   │   ├── page.tsx          # Dashboard home
│   │   ├── contacts/         # Contact management
│   │   ├── segments/         # Audience segments
│   │   ├── campaigns/        # Campaign composer + list
│   │   └── analytics/        # Analytics overview
│   ├── api/
│   │   ├── contacts/         # Contact CRUD + CSV import/export
│   │   ├── segments/         # Segment CRUD
│   │   ├── campaigns/        # Campaign CRUD + send trigger
│   │   ├── track/
│   │   │   ├── open/         # 1x1 pixel tracking
│   │   │   └── click/        # Click-through tracking
│   │   └── webhooks/resend/  # Resend delivery webhooks
│   └── unsubscribe/[token]/  # Public unsubscribe page
├── components/
│   ├── ui/              # Button, Input, Card, Badge, Modal
│   ├── layout/          # Sidebar, TopNav
│   ├── contacts/        # ContactForm, CsvImport
│   ├── campaigns/       # TiptapEditor
│   ├── segments/        # SegmentForm
│   └── dashboard/       # StatsCard, Charts
├── lib/
│   ├── supabase/        # Browser + server clients
│   ├── prisma.ts        # Prisma singleton
│   ├── resend.ts        # Resend singleton
│   ├── email-tracker.ts # Pixel + link injection
│   └── bulk-sender.ts   # Batched send engine
└── prisma/
    ├── schema.prisma    # DB schema
    └── seed.ts          # Demo data seed
```

## Database Schema

```
users          → Prisma mirror of Supabase auth users
contacts       → Email list with tags
segments       → Named filters (all / by-tag)
campaigns      → Email campaigns with stats counters
email_events   → Every tracking event (sent/opened/clicked/bounced/etc.)
unsubscribes   → Per-contact per-campaign unsubscribe tokens
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run db:push` | Push Prisma schema to DB |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:migrate` | Run migrations (dev) |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Open Prisma Studio |
| `npm run typecheck` | TypeScript type check |
