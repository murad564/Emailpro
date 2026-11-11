-- Aristokrat Mail database schema. Idempotent: safe to run on every start.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS countries (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS countries_name_uq ON countries (lower(name));

CREATE TABLE IF NOT EXISTS cities (
  id         SERIAL PRIMARY KEY,
  country_id INTEGER REFERENCES countries(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cities_country_name_uq ON cities (COALESCE(country_id, 0), lower(name));

CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_uq ON categories (lower(name));

CREATE TABLE IF NOT EXISTS tags (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_uq ON tags (lower(name));

CREATE TABLE IF NOT EXISTS import_history (
  id                 SERIAL PRIMARY KEY,
  file_name          TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','cancelled')),
  total_rows         INTEGER NOT NULL DEFAULT 0,
  imported           INTEGER NOT NULL DEFAULT 0,
  updated            INTEGER NOT NULL DEFAULT 0,
  skipped_existing   INTEGER NOT NULL DEFAULT 0,
  duplicates_in_file INTEGER NOT NULL DEFAULT 0,
  invalid            INTEGER NOT NULL DEFAULT 0,
  suppressed         INTEGER NOT NULL DEFAULT 0,
  mapping            JSONB NOT NULL DEFAULT '{}',
  options            JSONB NOT NULL DEFAULT '{}',
  invalid_rows       JSONB NOT NULL DEFAULT '[]',
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS contacts (
  id           BIGSERIAL PRIMARY KEY,
  email        TEXT NOT NULL,
  full_name    TEXT NOT NULL DEFAULT '',
  first_name   TEXT NOT NULL DEFAULT '',
  last_name    TEXT NOT NULL DEFAULT '',
  company      TEXT NOT NULL DEFAULT '',
  country_id   INTEGER REFERENCES countries(id) ON DELETE SET NULL,
  city_id      INTEGER REFERENCES cities(id) ON DELETE SET NULL,
  phone        TEXT NOT NULL DEFAULT '',
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  language     TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'subscribed' CHECK (status IN ('subscribed','unsubscribed','bounced')),
  notes        TEXT NOT NULL DEFAULT '',
  import_id    INTEGER REFERENCES import_history(id) ON DELETE SET NULL,
  status_changed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_uq ON contacts (lower(email));
CREATE INDEX IF NOT EXISTS contacts_country_idx ON contacts (country_id);
CREATE INDEX IF NOT EXISTS contacts_city_idx ON contacts (city_id);
CREATE INDEX IF NOT EXISTS contacts_category_idx ON contacts (category_id);
CREATE INDEX IF NOT EXISTS contacts_language_idx ON contacts (lower(language));
CREATE INDEX IF NOT EXISTS contacts_status_idx ON contacts (status);
CREATE INDEX IF NOT EXISTS contacts_created_idx ON contacts (created_at DESC);
CREATE INDEX IF NOT EXISTS contacts_search_trgm ON contacts
  USING gin ((lower(email || ' ' || full_name || ' ' || first_name || ' ' || last_name || ' ' || company)) gin_trgm_ops);

CREATE TABLE IF NOT EXISTS contact_tags (
  contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);
CREATE INDEX IF NOT EXISTS contact_tags_tag_idx ON contact_tags (tag_id);

CREATE TABLE IF NOT EXISTS suppression_list (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('unsubscribed','hard_bounce','spam','manual','brevo_blocklist')),
  source      TEXT NOT NULL DEFAULT '',
  campaign_id INTEGER,
  synced_to_brevo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS suppression_email_uq ON suppression_list (lower(email));

CREATE TABLE IF NOT EXISTS segments (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  filters     JSONB NOT NULL DEFAULT '{}',
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_templates (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  subject     TEXT NOT NULL DEFAULT '',
  preheader   TEXT NOT NULL DEFAULT '',
  editor_mode TEXT NOT NULL DEFAULT 'html' CHECK (editor_mode IN ('html','visual','text')),
  html        TEXT NOT NULL DEFAULT '',
  text_body   TEXT NOT NULL DEFAULT '',
  design      JSONB,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  subject       TEXT NOT NULL DEFAULT '',
  preheader     TEXT NOT NULL DEFAULT '',
  sender_name   TEXT NOT NULL DEFAULT '',
  sender_email  TEXT NOT NULL DEFAULT '',
  reply_to      TEXT NOT NULL DEFAULT '',
  editor_mode   TEXT NOT NULL DEFAULT 'html' CHECK (editor_mode IN ('html','visual','text')),
  html          TEXT NOT NULL DEFAULT '',
  text_body     TEXT NOT NULL DEFAULT '',
  design        JSONB,
  template_id   INTEGER REFERENCES email_templates(id) ON DELETE SET NULL,
  audience      JSONB NOT NULL DEFAULT '{"type":"all"}',
  audience_label TEXT NOT NULL DEFAULT '',
  send_limit    INTEGER,
  randomize     BOOLEAN NOT NULL DEFAULT FALSE,
  batch_size    INTEGER,
  batch_interval_minutes INTEGER NOT NULL DEFAULT 60,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','scheduled','sending','paused','sent','partially_sent','failed','cancelled')),
  scheduled_at  TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  error         TEXT,
  stats         JSONB NOT NULL DEFAULT '{}',
  stats_synced_at TIMESTAMPTZ,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns (status);

-- One "batch" = one Brevo email campaign sent to one Brevo list.
CREATE TABLE IF NOT EXISTS campaign_batches (
  id                SERIAL PRIMARY KEY,
  campaign_id       INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  batch_no          INTEGER NOT NULL,
  recipient_count   INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','sent','failed','cancelled')),
  run_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  brevo_list_id     INTEGER,
  brevo_campaign_id INTEGER,
  sent_at           TIMESTAMPTZ,
  error             TEXT,
  stats             JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS batches_campaign_idx ON campaign_batches (campaign_id);
CREATE INDEX IF NOT EXISTS batches_brevo_idx ON campaign_batches (brevo_campaign_id);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id              BIGSERIAL PRIMARY KEY,
  campaign_id     INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  batch_id        INTEGER REFERENCES campaign_batches(id) ON DELETE SET NULL,
  contact_id      BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  email           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','sent','delivered','soft_bounce','hard_bounce','failed','skipped','cancelled')),
  opened_at       TIMESTAMPTZ,
  clicked_at      TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  spam_at         TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  bounced_at      TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The core guarantee: a campaign can never reach the same address twice.
CREATE UNIQUE INDEX IF NOT EXISTS recipients_campaign_email_uq ON campaign_recipients (campaign_id, lower(email));
CREATE INDEX IF NOT EXISTS recipients_batch_idx ON campaign_recipients (batch_id);
CREATE INDEX IF NOT EXISTS recipients_contact_idx ON campaign_recipients (contact_id);

CREATE TABLE IF NOT EXISTS sending_logs (
  id          BIGSERIAL PRIMARY KEY,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  batch_id    INTEGER REFERENCES campaign_batches(id) ON DELETE CASCADE,
  level       TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error')),
  message     TEXT NOT NULL,
  data        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS logs_campaign_idx ON sending_logs (campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_events (
  id          BIGSERIAL PRIMARY KEY,
  event       TEXT NOT NULL,
  email       TEXT,
  brevo_campaign_id INTEGER,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id         BIGSERIAL PRIMARY KEY,
  type       TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}',
  run_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  locked_at  TIMESTAMPTZ,
  unique_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_pending_idx ON jobs (status, run_at);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_unique_pending ON jobs (unique_key) WHERE status IN ('pending','running') AND unique_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS media (
  id         TEXT PRIMARY KEY,
  file_name  TEXT NOT NULL DEFAULT '',
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  data       BYTEA NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
