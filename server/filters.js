// One filter engine used everywhere: contact list, exports, segments and campaign audiences.
import { one } from './db.js';

const ids = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : String(v).split(','))
  .map((x) => parseInt(x, 10))
  .filter(Number.isFinite);
const strs = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : []).map((x) => String(x).trim()).filter(Boolean);

export function normalizeFilters(f = {}) {
  return {
    search: String(f.search || '').trim(),
    country_ids: ids(f.country_ids),
    city_ids: ids(f.city_ids),
    category_ids: ids(f.category_ids),
    languages: strs(f.languages),
    tag_ids: ids(f.tag_ids),
    statuses: strs(f.statuses).filter((s) => ['subscribed', 'unsubscribed', 'bounced'].includes(s)),
    contact_ids: ids(f.contact_ids),
  };
}

export const CONTACT_FROM = `
  FROM contacts c
  LEFT JOIN countries co ON co.id = c.country_id
  LEFT JOIN cities ci ON ci.id = c.city_id
  LEFT JOIN categories ca ON ca.id = c.category_id`;

export const CONTACT_COLUMNS = `
  c.id, c.email, c.full_name, c.first_name, c.last_name, c.company, c.phone, c.language, c.status, c.notes,
  c.created_at, c.updated_at, c.country_id, c.city_id, c.category_id,
  co.name AS country, ci.name AS city, ca.name AS category,
  COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = c.id), '{}') AS tags`;

/** Returns { where: 'WHERE ...', params: [...] } for the normalised filters. */
export function buildWhere(filters, startIndex = 1) {
  const f = normalizeFilters(filters);
  const clauses = [];
  const params = [];
  let i = startIndex;
  const p = (v) => {
    params.push(v);
    return `$${i++}`;
  };
  if (f.search) {
    const term = `%${f.search.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`;
    const t = p(term);
    clauses.push(`(lower(c.email || ' ' || c.full_name || ' ' || c.first_name || ' ' || c.last_name || ' ' || c.company) LIKE ${t}
      OR lower(COALESCE(co.name,'')) LIKE ${t} OR lower(COALESCE(ci.name,'')) LIKE ${t})`);
  }
  if (f.country_ids.length) clauses.push(`c.country_id = ANY(${p(f.country_ids)}::int[])`);
  if (f.city_ids.length) clauses.push(`c.city_id = ANY(${p(f.city_ids)}::int[])`);
  if (f.category_ids.length) clauses.push(`c.category_id = ANY(${p(f.category_ids)}::int[])`);
  if (f.languages.length) clauses.push(`lower(c.language) = ANY(${p(f.languages.map((l) => l.toLowerCase()))}::text[])`);
  if (f.tag_ids.length) clauses.push(`EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ANY(${p(f.tag_ids)}::int[]))`);
  if (f.statuses.length) clauses.push(`c.status = ANY(${p(f.statuses)}::text[])`);
  if (f.contact_ids.length) clauses.push(`c.id = ANY(${p(f.contact_ids)}::bigint[])`);
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params, filters: f };
}

/** Human description, e.g. "Azerbaijan · Baku · Travel Agencies". */
export async function describeFilters(filters) {
  const f = normalizeFilters(filters);
  const parts = [];
  const names = async (table, list) =>
    list.length ? (await one(`SELECT string_agg(name, ', ' ORDER BY name) AS n FROM ${table} WHERE id = ANY($1::int[])`, [list]))?.n : null;
  const co = await names('countries', f.country_ids);
  const ci = await names('cities', f.city_ids);
  const ca = await names('categories', f.category_ids);
  const tg = await names('tags', f.tag_ids);
  parts.push(co ? `Country: ${co}` : 'All countries');
  if (ci) parts.push(`City: ${ci}`);
  if (ca) parts.push(`Category: ${ca}`);
  if (f.languages.length) parts.push(`Language: ${f.languages.join(', ')}`);
  if (tg) parts.push(`Tags: ${tg}`);
  if (f.search) parts.push(`Search: "${f.search}"`);
  if (f.contact_ids.length) parts.push(`${f.contact_ids.length} selected contacts`);
  return parts.join(' · ');
}
