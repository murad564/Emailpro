// TEST-ONLY stand-in for the Brevo v3 API, mirroring the request/response shapes of the endpoints the app uses.
// The real app never uses this: it only runs when BREVO_BASE_URL points at it during automated tests.
import express from 'express';

export function startMockBrevo(port = 4555, { key = 'xkeysib-test-key', credits = 100000, verifiedSenders = ['marketing@aristokrat.az'] } = {}) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  const state = {
    calls: [], contacts: new Map(), lists: new Map(), folders: [], campaigns: new Map(), attributes: new Set(['FIRSTNAME', 'LASTNAME']),
    webhooks: [], transactional: [], nextId: 10, credits,
  };
  const id = () => state.nextId++;
  app.use((req, res, next) => {
    state.calls.push(`${req.method} ${req.path}`);
    if (req.get('api-key') !== key) return res.status(401).json({ code: 'unauthorized', message: 'Key not found' });
    next();
  });
  app.get('/v3/account', (req, res) =>
    res.json({ email: 'nizami@aristokrat.az', companyName: 'Aristokrat Travel', firstName: 'Nizami', lastName: 'Hasanov',
      plan: [{ type: 'subscription', credits: state.credits, creditsType: 'sendLimit', endDate: '2027-01-01' }] }));
  app.get('/v3/senders', (req, res) => res.json({ senders: verifiedSenders.map((e, i) => ({ id: i + 1, name: 'Aristokrat', email: e, active: true })) }));
  app.get('/v3/contacts/attributes', (req, res) => res.json({ attributes: [...state.attributes].map((name) => ({ name, category: 'normal', type: 'text' })) }));
  app.post('/v3/contacts/attributes/normal/:name', (req, res) => {
    if (state.attributes.has(req.params.name)) return res.status(400).json({ code: 'invalid_parameter', message: 'Attribute name already exists' });
    state.attributes.add(req.params.name);
    res.status(201).end();
  });
  app.get('/v3/contacts/folders', (req, res) => res.json({ folders: state.folders, count: state.folders.length }));
  app.post('/v3/contacts/folders', (req, res) => {
    const f = { id: id(), name: req.body.name };
    state.folders.push(f);
    res.status(201).json({ id: f.id });
  });
  app.post('/v3/contacts/lists', (req, res) => {
    if (!req.body.folderId) return res.status(400).json({ code: 'missing_parameter', message: 'folderId is missing' });
    const l = { id: id(), name: req.body.name, members: new Set() };
    state.lists.set(l.id, l);
    res.status(201).json({ id: l.id });
  });
  app.get('/v3/contacts/lists/:id', (req, res) => {
    const l = state.lists.get(Number(req.params.id));
    if (!l) return res.status(404).json({ code: 'document_not_found', message: 'List ID does not exist' });
    res.json({ id: l.id, name: l.name, totalSubscribers: l.members.size, uniqueSubscribers: l.members.size });
  });
  app.post('/v3/contacts/import', (req, res) => {
    for (const c of req.body.jsonBody || []) {
      const e = c.email.toLowerCase();
      const prev = state.contacts.get(e) || { email: e, emailBlacklisted: false };
      state.contacts.set(e, { ...prev, attributes: { ...(prev.attributes || {}), ...c.attributes }, modifiedAt: new Date().toISOString() });
      for (const lid of req.body.listIds || []) state.lists.get(lid)?.members.add(e);
    }
    res.status(202).json({ processId: id() });
  });
  app.get('/v3/processes/:id', (req, res) => res.json({ id: Number(req.params.id), status: 'completed' }));
  app.post('/v3/contacts', (req, res) => {
    const e = req.body.email.toLowerCase();
    state.contacts.set(e, { ...(state.contacts.get(e) || { email: e }), emailBlacklisted: !!req.body.emailBlacklisted, modifiedAt: new Date().toISOString() });
    res.status(201).json({ id: id() });
  });
  app.put('/v3/contacts/:email', (req, res) => {
    const e = decodeURIComponent(req.params.email).toLowerCase();
    if (!state.contacts.has(e)) return res.status(404).json({ code: 'document_not_found', message: 'Contact does not exist' });
    Object.assign(state.contacts.get(e), req.body);
    res.status(204).end();
  });
  app.get('/v3/contacts', (req, res) => {
    const all = [...state.contacts.values()];
    const off = Number(req.query.offset || 0);
    res.json({ contacts: all.slice(off, off + Number(req.query.limit || 50)), count: all.length });
  });
  app.post('/v3/emailCampaigns', (req, res) => {
    const b = req.body;
    if (!verifiedSenders.includes(b.sender?.email)) return res.status(400).json({ code: 'invalid_parameter', message: 'Sender is invalid / inactive' });
    if (!b.htmlContent?.includes('{{ unsubscribe }}')) return res.status(400).json({ code: 'invalid_parameter', message: 'Unsubscribe link missing' });
    const c = { id: id(), ...b, status: 'draft' };
    state.campaigns.set(c.id, c);
    res.status(201).json({ id: c.id });
  });
  app.post('/v3/emailCampaigns/:id/sendNow', (req, res) => {
    const c = state.campaigns.get(Number(req.params.id));
    if (!c) return res.status(404).json({ code: 'document_not_found', message: 'Campaign ID does not exist' });
    const n = c.recipients.listIds.reduce((s, l) => s + (state.lists.get(l)?.members.size || 0), 0);
    if (n > state.credits) return res.status(402).json({ code: 'not_enough_credits', message: 'Not enough credits' });
    state.credits -= n;
    c.status = 'sent';
    c.sentCount = n;
    res.status(204).end();
  });
  app.get('/v3/emailCampaigns/:id', (req, res) => {
    const c = state.campaigns.get(Number(req.params.id));
    if (!c) return res.status(404).json({ code: 'document_not_found', message: 'Campaign ID does not exist' });
    const n = c.sentCount || 0;
    const g = { sent: n, delivered: n - Math.floor(n * 0.02), uniqueViews: Math.floor(n * 0.35), viewed: Math.floor(n * 0.5), trackableViews: Math.floor(n * 0.3),
      uniqueClicks: Math.floor(n * 0.08), clickers: Math.floor(n * 0.08), softBounces: Math.floor(n * 0.01), hardBounces: Math.floor(n * 0.01),
      unsubscriptions: Math.floor(n * 0.01), complaints: 0, deferred: 0 };
    res.json({ id: c.id, name: c.name, status: c.status, statistics: { globalStats: g, campaignStats: [] } });
  });
  app.put('/v3/emailCampaigns/:id/status', (req, res) => res.status(204).end());
  app.post('/v3/smtp/email', (req, res) => {
    const b = req.body;
    if (!verifiedSenders.includes(b.sender?.email)) return res.status(400).json({ code: 'invalid_parameter', message: 'Sender is not valid' });
    state.transactional.push(b);
    res.status(201).json({ messageId: `<${id()}@smtp-relay.mailin.fr>` });
  });
  app.get('/v3/webhooks', (req, res) => res.json({ webhooks: state.webhooks }));
  app.post('/v3/webhooks', (req, res) => {
    const w = { id: id(), ...req.body };
    state.webhooks.push(w);
    res.status(201).json({ id: w.id });
  });
  app.delete('/v3/webhooks/:id', (req, res) => res.status(204).end());
  const server = app.listen(port);
  return { state, close: () => server.close() };
}

if (process.argv[1] && process.argv[1].endsWith('mock-brevo.js')) {
  startMockBrevo(Number(process.env.PORT || 4555));
  console.log('Mock Brevo on', process.env.PORT || 4555);
}
