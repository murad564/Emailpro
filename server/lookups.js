// Find-or-create helpers for countries, cities, categories and tags (case-insensitive).
import { cleanStr } from './util.js';

const titleish = (s) => cleanStr(s, 120);

export async function getOrCreate(client, table, name, cache) {
  const n = titleish(name);
  if (!n) return null;
  const key = n.toLowerCase();
  if (cache?.has(key)) return cache.get(key);
  let r = await client.query(`SELECT id FROM ${table} WHERE lower(name) = lower($1)`, [n]);
  if (!r.rows[0]) {
    r = await client.query(
      `INSERT INTO ${table} (name) VALUES ($1) ON CONFLICT (lower(name)) DO UPDATE SET name = ${table}.name RETURNING id`,
      [n]
    );
  }
  const id = r.rows[0].id;
  cache?.set(key, id);
  return id;
}

export async function getOrCreateCity(client, countryId, name, cache) {
  const n = titleish(name);
  if (!n) return null;
  const key = `${countryId || 0}:${n.toLowerCase()}`;
  if (cache?.has(key)) return cache.get(key);
  let r = await client.query(
    'SELECT id FROM cities WHERE COALESCE(country_id,0) = COALESCE($1::int,0) AND lower(name) = lower($2)',
    [countryId, n]
  );
  if (!r.rows[0]) {
    r = await client.query(
      `INSERT INTO cities (country_id, name) VALUES ($1, $2)
       ON CONFLICT (COALESCE(country_id,0), lower(name)) DO UPDATE SET name = cities.name RETURNING id`,
      [countryId, n]
    );
  }
  const id = r.rows[0].id;
  cache?.set(key, id);
  return id;
}

export function parseTags(v) {
  if (Array.isArray(v)) return v.map((t) => cleanStr(t, 60)).filter(Boolean);
  return String(v || '')
    .split(/[,;|]/)
    .map((t) => cleanStr(t, 60))
    .filter(Boolean);
}

export async function setContactTags(client, contactId, tagNames, cache, { replace = true } = {}) {
  if (replace) await client.query('DELETE FROM contact_tags WHERE contact_id = $1', [contactId]);
  for (const t of tagNames) {
    const tagId = await getOrCreate(client, 'tags', t, cache);
    if (tagId) await client.query('INSERT INTO contact_tags (contact_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [contactId, tagId]);
  }
}
