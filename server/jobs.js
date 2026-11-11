// Postgres-backed background job queue (no Redis needed).
// Jobs survive restarts; a crashed job is retried with backoff.
import { pool, query } from './db.js';

const handlers = new Map();
let running = false;
let timer = null;
const POLL_MS = Number(process.env.JOB_POLL_MS || 3000);
const CONCURRENCY = Number(process.env.JOB_CONCURRENCY || 2);
let active = 0;

export function registerJob(type, fn) {
  handlers.set(type, fn);
}

export async function enqueue(type, payload = {}, { runAt = new Date(), uniqueKey = null, maxAttempts = 5 } = {}) {
  const r = await query(
    `INSERT INTO jobs (type, payload, run_at, unique_key, max_attempts) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (unique_key) WHERE status IN ('pending','running') AND unique_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [type, JSON.stringify(payload), runAt, uniqueKey, maxAttempts]
  );
  return r.rows[0]?.id || null;
}

async function claim() {
  const r = await query(
    `UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
     WHERE id = (
       SELECT id FROM jobs WHERE status = 'pending' AND run_at <= now()
       ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1
     ) RETURNING *`
  );
  return r.rows[0] || null;
}

async function runOne(job) {
  const fn = handlers.get(job.type);
  try {
    if (!fn) throw new Error(`No handler for job type ${job.type}`);
    await fn(job.payload, job);
    await query("UPDATE jobs SET status = 'done', locked_at = NULL, last_error = NULL WHERE id = $1", [job.id]);
  } catch (e) {
    console.error(`Job ${job.id} (${job.type}) failed:`, e.message);
    const retry = job.attempts < job.max_attempts && !e.permanent;
    const backoffSec = Math.min(60 * 2 ** (job.attempts - 1), 3600);
    await query(
      `UPDATE jobs SET status = $2, locked_at = NULL, last_error = $3, run_at = now() + ($4 || ' seconds')::interval WHERE id = $1`,
      [job.id, retry ? 'pending' : 'failed', String(e.message).slice(0, 2000), String(backoffSec)]
    );
    if (!retry) {
      const onFail = handlers.get(`${job.type}:failed`);
      if (onFail) await onFail(job.payload, e).catch((err) => console.error('onFail handler error', err));
    }
  }
}

async function tick() {
  if (!running) return;
  try {
    while (active < CONCURRENCY) {
      const job = await claim();
      if (!job) break;
      active++;
      runOne(job).finally(() => {
        active--;
      });
    }
  } catch (e) {
    console.error('Job poll error', e.message);
  } finally {
    if (running) timer = setTimeout(tick, POLL_MS);
  }
}

export async function startWorker() {
  // Jobs left "running" by a previous process that died get retried.
  await query("UPDATE jobs SET status = 'pending', locked_at = NULL WHERE status = 'running' AND locked_at < now() - interval '30 minutes'");
  running = true;
  tick();
}

export async function stopWorker() {
  running = false;
  clearTimeout(timer);
  const start = Date.now();
  while (active > 0 && Date.now() - start < 20000) await new Promise((r) => setTimeout(r, 200));
}

export { pool };
