// Countries, cities, categories and tags management.
import { Router } from 'express';
import { one, many, query, tx } from '../db.js';
import { asyncH, HttpError, cleanStr } from '../util.js';

const r = Router();
const TABLES = { countries: 'country_id', categories: 'category_id', tags: null };

r.get('/overview', asyncH(async (req, res) => {
  const countries = await many(
    `SELECT co.id, co.name,
       count(c.id)::int AS contacts,
       count(c.id) FILTER (WHERE c.status = 'subscribed')::int AS subscribed,
       (SELECT count(*)::int FROM cities ci WHERE ci.country_id = co.id) AS cities
     FROM countries co LEFT JOIN contacts c ON c.country_id = co.id
     GROUP BY co.id ORDER BY contacts DESC, co.name`
  );
  const cities = await many(
    `SELECT ci.id, ci.name, ci.country_id,
       count(c.id)::int AS contacts,
       count(c.id) FILTER (WHERE c.status = 'subscribed')::int AS subscribed
     FROM cities ci LEFT JOIN contacts c ON c.city_id = ci.id
     GROUP BY ci.id ORDER BY contacts DESC, ci.name`
  );
  const unassigned = await one(
    `SELECT count(*) FILTER (WHERE country_id IS NULL)::int AS no_country, count(*) FILTER (WHERE city_id IS NULL)::int AS no_city FROM contacts`
  );
  res.json({ countries, cities, unassigned });
}));

for (const [table, fk] of Object.entries(TABLES)) {
  r.post(`/${table}`, asyncH(async (req, res) => {
    const name = cleanStr(req.body.name, 120);
    if (!name) throw new HttpError(400, 'Name is required.');
    const exists = await one(`SELECT id FROM ${table} WHERE lower(name) = lower($1)`, [name]);
    if (exists) throw new HttpError(409, `"${name}" already exists.`);
    res.status(201).json(await one(`INSERT INTO ${table} (name) VALUES ($1) RETURNING id, name`, [name]));
  }));

  // Rename; if the new name already exists the two are merged.
  r.put(`/${table}/:id(\\d+)`, asyncH(async (req, res) => {
    const name = cleanStr(req.body.name, 120);
    if (!name) throw new HttpError(400, 'Name is required.');
    const id = Number(req.params.id);
    const other = await one(`SELECT id FROM ${table} WHERE lower(name) = lower($1) AND id <> $2`, [name, id]);
    if (!other) {
      await query(`UPDATE ${table} SET name = $2 WHERE id = $1`, [id, name]);
      return res.json({ id, merged: false });
    }
    await tx(async (c) => {
      if (table === 'tags') {
        await c.query('INSERT INTO contact_tags (contact_id, tag_id) SELECT contact_id, $2 FROM contact_tags WHERE tag_id = $1 ON CONFLICT DO NOTHING', [id, other.id]);
      } else {
        await c.query(`UPDATE contacts SET ${fk} = $2 WHERE ${fk} = $1`, [id, other.id]);
        if (table === 'countries') {
          // Move cities, merging same-named ones.
          const cities = (await c.query('SELECT id, name FROM cities WHERE country_id = $1', [id])).rows;
          for (const ci of cities) {
            const twin = (await c.query('SELECT id FROM cities WHERE country_id = $1 AND lower(name) = lower($2)', [other.id, ci.name])).rows[0];
            if (twin) {
              await c.query('UPDATE contacts SET city_id = $2 WHERE city_id = $1', [ci.id, twin.id]);
              await c.query('DELETE FROM cities WHERE id = $1', [ci.id]);
            } else {
              await c.query('UPDATE cities SET country_id = $2 WHERE id = $1', [ci.id, other.id]);
            }
          }
        }
      }
      await c.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    });
    res.json({ id: other.id, merged: true });
  }));

  r.delete(`/${table}/:id(\\d+)`, asyncH(async (req, res) => {
    const n = (await query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id])).rowCount;
    if (!n) throw new HttpError(404, 'Not found.');
    res.json({ deleted: true });
  }));
}

r.post('/cities', asyncH(async (req, res) => {
  const name = cleanStr(req.body.name, 120);
  const countryId = req.body.country_id ? Number(req.body.country_id) : null;
  if (!name) throw new HttpError(400, 'City name is required.');
  const exists = await one('SELECT id FROM cities WHERE COALESCE(country_id,0) = COALESCE($1::int,0) AND lower(name) = lower($2)', [countryId, name]);
  if (exists) throw new HttpError(409, `"${name}" already exists in this country.`);
  res.status(201).json(await one('INSERT INTO cities (country_id, name) VALUES ($1, $2) RETURNING id, name, country_id', [countryId, name]));
}));

r.put('/cities/:id(\\d+)', asyncH(async (req, res) => {
  const id = Number(req.params.id);
  const city = await one('SELECT * FROM cities WHERE id = $1', [id]);
  if (!city) throw new HttpError(404, 'City not found.');
  const name = cleanStr(req.body.name, 120) || city.name;
  const countryId = req.body.country_id !== undefined ? (req.body.country_id ? Number(req.body.country_id) : null) : city.country_id;
  const twin = await one('SELECT id FROM cities WHERE COALESCE(country_id,0) = COALESCE($1::int,0) AND lower(name) = lower($2) AND id <> $3', [countryId, name, id]);
  if (twin) {
    await tx(async (c) => {
      await c.query('UPDATE contacts SET city_id = $2 WHERE city_id = $1', [id, twin.id]);
      await c.query('DELETE FROM cities WHERE id = $1', [id]);
    });
    return res.json({ id: twin.id, merged: true });
  }
  await tx(async (c) => {
    await c.query('UPDATE cities SET name = $2, country_id = $3 WHERE id = $1', [id, name, countryId]);
    if (countryId !== city.country_id) await c.query('UPDATE contacts SET country_id = $2 WHERE city_id = $1', [id, countryId]);
  });
  res.json({ id, merged: false });
}));

r.delete('/cities/:id(\\d+)', asyncH(async (req, res) => {
  const n = (await query('DELETE FROM cities WHERE id = $1', [req.params.id])).rowCount;
  if (!n) throw new HttpError(404, 'City not found.');
  res.json({ deleted: true });
}));

export default r;
