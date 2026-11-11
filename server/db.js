import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// BIGINT / COUNT(*) come back as strings by default; our counts fit safely in JS numbers.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Configure a PostgreSQL database.');
  process.exit(1);
}

const needsSsl = /sslmode=require/.test(connectionString) || process.env.DATABASE_SSL === 'true';

export const pool = new pg.Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_SIZE || 10),
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => console.error('Postgres pool error', err));

export const query = (text, params) => pool.query(text, params);

export async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}

export async function many(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  // Advisory lock so two instances starting together don't race on DDL.
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(424242)');
    await client.query(sql);
  } finally {
    await client.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
    client.release();
  }
}
