import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Download, Trash2, Users, Filter, Tag, ArrowUpDown, Pencil, ShieldOff, UserX } from 'lucide-react';
import { get, post, put, del, qs, download, fmt } from '../api.js';
import { useLookups, useAuth } from '../App.jsx';
import FilterBar, { EMPTY_FILTERS, filterParams, hasFilters } from '../components/FilterBar.jsx';
import { Badge, Empty, ErrorBox, Field, Modal, PageHeader, Pagination, Spinner, Tabs, useConfirm, useToast } from '../ui.jsx';

function useDebounced(v, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function filtersFromSearch(sp) {
  const arr = (k) => (sp.get(k) ? sp.get(k).split(',').map((x) => (isNaN(x) ? x : Number(x))) : []);
  return { ...EMPTY_FILTERS, search: sp.get('search') || '', country_ids: arr('country_ids'), city_ids: arr('city_ids'), category_ids: arr('category_ids'), languages: sp.get('languages') ? sp.get('languages').split(',') : [], tag_ids: arr('tag_ids'), statuses: sp.get('statuses') ? sp.get('statuses').split(',') : [] };
}

export default function Contacts() {
  const [tab, setTab] = useState('contacts');
  return (
    <>
      <PageHeader title="Contacts" subtitle="Manage your email contacts, subscriptions and suppression list." />
      <Tabs tabs={[{ value: 'contacts', label: 'All contacts' }, { value: 'suppression', label: 'Unsubscribes & suppression' }]} value={tab} onChange={setTab} />
      {tab === 'contacts' ? <ContactList /> : <SuppressionList />}
    </>
  );
}

function ContactList() {
  const [sp] = useSearchParams();
  const [filters, setFilters] = useState(() => filtersFromSearch(sp));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState({ by: 'created_at', dir: 'desc' });
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [editing, setEditing] = useState(null);
  const [segmentOpen, setSegmentOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const L = useLookups();
  const navigate = useNavigate();
  const search = useDebounced(filters.search);
  const effective = useMemo(() => ({ ...filters, search }), [filters, search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await get(`/contacts${qs({ ...filterParams(effective), page, pageSize, sort: sort.by, dir: sort.dir })}`));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [effective, page, pageSize, sort]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
    setAllMatching(false);
  }, [effective]);

  const pageIds = data.rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleAll = () => {
    const s = new Set(selected);
    if (allOnPage) pageIds.forEach((id) => s.delete(id));
    else pageIds.forEach((id) => s.add(id));
    setSelected(s);
    setAllMatching(false);
  };
  const toggle = (id) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
    setAllMatching(false);
  };
  const selCount = allMatching ? data.total : selected.size;
  const bulkBody = () => (allMatching ? { all_matching: true, filters: filterParams(effective) } : { ids: [...selected] });

  const bulkDelete = async () => {
    if (!(await confirm({ title: 'Delete contacts', message: `Permanently delete ${fmt.n(selCount)} contact(s)? Campaign history keeps their email address.`, danger: true, confirmText: 'Delete' }))) return;
    try {
      const r = await post('/contacts/bulk-delete', bulkBody());
      toast.success(`Deleted ${fmt.n(r.deleted)} contact(s).`);
      setSelected(new Set());
      setAllMatching(false);
      load();
      L.reload();
    } catch (e) {
      toast.error(e);
    }
  };

  const exportSel = () => {
    if (allMatching) return download(`/contacts/export${qs({ ...filterParams(effective), filename: 'contacts_filtered' })}`);
    download(`/contacts/export${qs({ contact_ids: [...selected], filename: 'contacts_selected' })}`);
  };

  const sortBy = (by) => setSort((s) => ({ by, dir: s.by === by && s.dir === 'asc' ? 'desc' : 'asc' }));
  const Th = ({ by, children }) => (
    <th>
      <button className="inline-flex items-center gap-1 uppercase" onClick={() => sortBy(by)}>
        {children} <ArrowUpDown size={12} className={sort.by === by ? 'text-navy-700' : 'text-slate-300'} />
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <FilterBar value={filters} onChange={setFilters} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={() => setEditing({})}>
          <Plus size={16} /> Add contact
        </button>
        <button className="btn-secondary" onClick={() => download(`/contacts/export${qs({ ...filterParams(effective), filename: hasFilters(effective) ? 'contacts_filtered' : 'contacts_all' })}`)}>
          <Download size={16} /> Export {hasFilters(effective) ? 'filtered' : 'all'} ({fmt.n(data.total)})
        </button>
        {hasFilters(effective) && (
          <button className="btn-secondary" onClick={() => setSegmentOpen(true)}>
            <Filter size={16} /> Save as segment
          </button>
        )}
        <div className="ml-auto text-sm text-slate-500">{fmt.n(data.total)} contacts</div>
      </div>

      {selCount > 0 && (
        <div className="card flex flex-wrap items-center gap-2 border-navy-200 bg-navy-50 px-4 py-2.5 text-sm">
          <span className="font-medium text-navy-800">{fmt.n(selCount)} selected</span>
          {!allMatching && allOnPage && data.total > pageIds.length && (
            <button className="text-navy-600 underline" onClick={() => setAllMatching(true)}>
              Select all {fmt.n(data.total)} matching contacts
            </button>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <button className="btn-secondary btn-sm" onClick={exportSel}><Download size={14} /> Export selected</button>
            <button className="btn-secondary btn-sm" onClick={() => setBulkOpen(true)}><Tag size={14} /> Update</button>
            <button className="btn-danger btn-sm" onClick={bulkDelete}><Trash2 size={14} /> Delete</button>
            <button className="btn-ghost btn-sm" onClick={() => { setSelected(new Set()); setAllMatching(false); }}>Clear</button>
          </div>
        </div>
      )}

      <ErrorBox error={error} onRetry={load} />
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-10"><input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Select page" /></th>
                <Th by="full_name">Name</Th>
                <Th by="email">Email</Th>
                <Th by="company">Company</Th>
                <Th by="country">Country</Th>
                <Th by="city">City</Th>
                <Th by="category">Category</Th>
                <th>Language</th>
                <th>Tags</th>
                <Th by="status">Status</Th>
                <Th by="created_at">Added</Th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && !data.rows.length ? (
                <tr><td colSpan={12} className="py-10 text-center text-slate-400"><Spinner className="inline" /> Loading…</td></tr>
              ) : data.rows.length === 0 ? (
                <tr><td colSpan={12}>
                  <Empty icon={Users} title={hasFilters(effective) ? 'No contacts match these filters' : 'No contacts yet'}
                    text={hasFilters(effective) ? 'Try removing some filters.' : 'Add contacts one by one or import an Excel/CSV file.'}
                    action={!hasFilters(effective) && <button className="btn-primary" onClick={() => navigate('/import-export')}>Import contacts</button>} />
                </td></tr>
              ) : (
                data.rows.map((c) => (
                  <tr key={c.id} className={loading ? 'opacity-60' : ''}>
                    <td><input type="checkbox" checked={allMatching || selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                    <td className="font-medium text-slate-800">{c.full_name || '—'}</td>
                    <td className="text-slate-600">{c.email}</td>
                    <td className="max-w-[200px] truncate">{c.company || '—'}</td>
                    <td>{c.country || '—'}</td>
                    <td>{c.city || '—'}</td>
                    <td className="max-w-[160px] truncate">{c.category || '—'}</td>
                    <td>{c.language || '—'}</td>
                    <td className="max-w-[160px]">
                      <div className="flex flex-wrap gap-1">{(c.tags || []).slice(0, 3).map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{t}</span>)}</div>
                    </td>
                    <td><Badge value={c.status} /></td>
                    <td className="whitespace-nowrap text-slate-500">{fmt.date(c.created_at)}</td>
                    <td><button className="btn-ghost btn-sm" onClick={() => setEditing(c)} title="Edit"><Pencil size={15} /></button></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between border-t border-slate-100">
          <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} />
          <select className="input mr-3 w-auto py-1 text-xs" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} per page</option>)}
          </select>
        </div>
      </div>

      {editing && <ContactForm contact={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); L.reload(); }} />}
      {segmentOpen && <SaveSegmentModal filters={effective} total={data.total} onClose={() => setSegmentOpen(false)} />}
      {bulkOpen && <BulkUpdateModal count={selCount} body={bulkBody()} onClose={() => setBulkOpen(false)} onDone={() => { setBulkOpen(false); load(); L.reload(); }} />}
    </div>
  );
}

export function SaveSegmentModal({ filters, total, onClose }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const save = async () => {
    setBusy(true);
    try {
      await post('/segments', { name, description, filters: filterParams({ ...filters, statuses: [] }) });
      toast.success(`Segment "${name}" saved.`);
      onClose();
      navigate('/segments');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Save as audience segment" size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!name.trim() || busy} onClick={save}>{busy && <Spinner size={14} />} Save segment</button></>}>
      <p className="mb-3 text-sm text-slate-500">The segment saves these filters (currently {fmt.n(total)} contacts). New contacts that match will be included automatically.</p>
      <Field label="Segment name" className="mb-3"><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Travel Agencies – Azerbaijan" /></Field>
      <Field label="Description (optional)"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
    </Modal>
  );
}

function BulkUpdateModal({ count, body, onClose, onDone }) {
  const [category, setCategory] = useState('');
  const [language, setLanguage] = useState('');
  const [tags, setTags] = useState('');
  const [unsub, setUnsub] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const L = useLookups();
  const save = async () => {
    const set = {};
    if (category) set.category = category;
    if (language) set.language = language;
    if (tags) set.add_tags = tags;
    if (unsub) set.status = 'unsubscribed';
    if (!Object.keys(set).length) return toast.info('Choose at least one change.');
    setBusy(true);
    try {
      const r = await post('/contacts/bulk-update', { ...body, set });
      toast.success(`Updated ${fmt.n(r.updated)} contact(s).`);
      onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Update ${fmt.n(count)} contacts`} size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>{busy && <Spinner size={14} />} Apply</button></>}>
      <div className="space-y-3">
        <Field label="Set category" hint="Leave empty to keep current"><input className="input" list="bulk-cats" value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
        <datalist id="bulk-cats">{L.categories.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        <Field label="Set language"><input className="input" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. English" /></Field>
        <Field label="Add tags" hint="Comma separated"><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. VIP, 2026 fair" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={unsub} onChange={(e) => setUnsub(e.target.checked)} /> Mark as unsubscribed (adds to suppression list)</label>
      </div>
    </Modal>
  );
}

export function ContactForm({ contact, onClose, onSaved }) {
  const isNew = !contact.id;
  const [f, setF] = useState(() => ({
    full_name: contact.full_name || '', first_name: contact.first_name || '', last_name: contact.last_name || '', email: contact.email || '',
    company: contact.company || '', country: contact.country || '', city: contact.city || '', phone: contact.phone || '',
    category: contact.category || '', language: contact.language || '', tags: (contact.tags || []).join(', '), status: contact.status || 'subscribed', notes: contact.notes || '',
  }));
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();
  const L = useLookups();
  useEffect(() => {
    if (contact.id) get(`/contacts/${contact.id}`).then((c) => { setHistory(c.history); setF((x) => ({ ...x, notes: c.notes || '' })); }).catch(() => {});
  }, [contact.id]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const countryObj = L.countries.find((c) => c.name.toLowerCase() === f.country.trim().toLowerCase());
  const cityOptions = L.cities.filter((c) => !countryObj || c.country_id === countryObj.id);

  const save = async () => {
    if (contact.id && contact.status !== 'subscribed' && f.status === 'subscribed') {
      if (!(await confirm({ title: 'Resubscribe contact?', message: 'Only resubscribe if this person has agreed to receive marketing emails again. They will be removed from the suppression list in this app and in Brevo.', confirmText: 'Yes, they agreed' }))) return;
    }
    setBusy(true);
    try {
      if (isNew) await post('/contacts', f);
      else await put(`/contacts/${contact.id}`, f);
      toast.success(isNew ? 'Contact added.' : 'Contact saved.');
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Delete contact', message: `Delete ${contact.email}?`, danger: true, confirmText: 'Delete' }))) return;
    try {
      await del(`/contacts/${contact.id}`);
      toast.success('Contact deleted.');
      onSaved();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal open onClose={onClose} title={isNew ? 'Add contact' : 'Edit contact'} size="lg"
      footer={<>
        {!isNew && <button className="btn-ghost mr-auto text-red-600" onClick={remove}><Trash2 size={15} /> Delete</button>}
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || !f.email} onClick={save}>{busy && <Spinner size={14} />} {isNew ? 'Add contact' : 'Save changes'}</button>
      </>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Email address *"><input className="input" type="email" value={f.email} onChange={set('email')} autoFocus={isNew} /></Field>
        <Field label="First name"><input className="input" value={f.first_name} onChange={set('first_name')} /></Field>
        <Field label="Last name"><input className="input" value={f.last_name} onChange={set('last_name')} /></Field>
        <Field label="Full name" hint="Filled from first + last if empty"><input className="input" value={f.full_name} onChange={set('full_name')} /></Field>
        <Field label="Company name"><input className="input" value={f.company} onChange={set('company')} /></Field>
        <Field label="Phone number"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Country"><input className="input" list="cf-countries" value={f.country} onChange={set('country')} placeholder="e.g. Azerbaijan" /></Field>
        <Field label="City"><input className="input" list="cf-cities" value={f.city} onChange={set('city')} placeholder="e.g. Baku" /></Field>
        <Field label="Contact category"><input className="input" list="cf-cats" value={f.category} onChange={set('category')} placeholder="e.g. Travel Agencies" /></Field>
        <Field label="Language"><input className="input" list="cf-langs" value={f.language} onChange={set('language')} placeholder="e.g. English" /></Field>
        <Field label="Tags" hint="Comma separated"><input className="input" value={f.tags} onChange={set('tags')} /></Field>
        <Field label="Contact status">
          <select className="input" value={f.status} onChange={set('status')}>
            <option value="subscribed">Subscribed</option>
            <option value="unsubscribed">Unsubscribed</option>
            <option value="bounced">Bounced</option>
          </select>
        </Field>
        <Field label="Notes" className="sm:col-span-2 lg:col-span-3"><textarea className="input min-h-[80px]" value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <datalist id="cf-countries">{L.countries.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <datalist id="cf-cities">{cityOptions.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <datalist id="cf-cats">{L.categories.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <datalist id="cf-langs">{L.languages.map((c) => <option key={c.name} value={c.name} />)}</datalist>
      {!isNew && (
        <div className="mt-4 text-xs text-slate-500">
          Added {fmt.dt(contact.created_at)}
          {history?.length > 0 && (
            <div className="mt-3">
              <div className="label">Campaign history</div>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200">
                {history.map((h) => (
                  <div key={h.campaign_id} className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 last:border-0">
                    <span className="truncate text-slate-700">{h.campaign_name}</span>
                    <span className="flex items-center gap-2">
                      {h.opened_at && <span className="text-emerald-600">opened</span>}
                      {h.clicked_at && <span className="text-sky-600">clicked</span>}
                      <Badge value={h.status} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function SuppressionList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [data, setData] = useState({ rows: [], total: 0, byReason: [] });
  const [addOpen, setAddOpen] = useState(false);
  const [emails, setEmails] = useState('');
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const s = useDebounced(search);
  const load = useCallback(() => get(`/suppression${qs({ page, search: s, reason })}`).then(setData).catch(toast.error), [page, s, reason, toast]);
  useEffect(() => {
    load();
  }, [load]);
  const add = async () => {
    try {
      const r = await post('/suppression', { emails });
      toast.success(`${r.added} address(es) suppressed.`);
      setAddOpen(false);
      setEmails('');
      load();
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async (email) => {
    if (!(await confirm({ title: 'Remove from suppression list', message: `Only do this if ${email} has explicitly agreed to receive marketing emails again.\n\nThe contact will be marked Subscribed here and unblocked in Brevo.`, confirmText: 'They agreed — remove' }))) return;
    try {
      await del(`/suppression/${encodeURIComponent(email)}`, { confirm_consent: true });
      toast.success('Removed from suppression list.');
      load();
    } catch (e) {
      toast.error(e);
    }
  };
  const reasonLabel = { unsubscribed: 'Unsubscribed', hard_bounce: 'Hard bounce', spam: 'Spam complaint', manual: 'Manual', brevo_blocklist: 'Brevo blocklist' };
  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm text-slate-600">
        Addresses on this list never receive marketing campaigns. Unsubscribes, hard bounces and spam complaints from Brevo are added automatically, and anything added here is blocklisted in Brevo too.
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search email…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="input w-auto" value={reason} onChange={(e) => { setReason(e.target.value); setPage(1); }}>
          <option value="">All reasons</option>
          {Object.entries(reasonLabel).map(([k, v]) => <option key={k} value={k}>{v} ({data.byReason.find((x) => x.reason === k)?.n || 0})</option>)}
        </select>
        <button className="btn-primary ml-auto" onClick={() => setAddOpen(true)}><UserX size={16} /> Suppress addresses</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Email</th><th>Reason</th><th>Source</th><th>Campaign</th><th>Synced to Brevo</th><th>Date</th><th></th></tr></thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr><td colSpan={7}><Empty icon={ShieldOff} title="Suppression list is empty" text="Unsubscribes and bounces will appear here." /></td></tr>
            ) : data.rows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.email}</td>
                <td>{reasonLabel[r.reason]}</td>
                <td className="text-slate-500">{r.source}</td>
                <td className="text-slate-500">{r.campaign_name || '—'}</td>
                <td>{r.synced_to_brevo ? 'Yes' : 'Pending'}</td>
                <td className="text-slate-500">{fmt.dt(r.created_at)}</td>
                <td>{user?.role === 'admin' && <button className="btn-ghost btn-sm" onClick={() => remove(r.email)}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} pageSize={data.pageSize || 50} total={data.total} onPage={setPage} />
      </div>
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Suppress email addresses" size="sm"
        footer={<><button className="btn-secondary" onClick={() => setAddOpen(false)}>Cancel</button><button className="btn-primary" onClick={add} disabled={!emails.trim()}>Suppress</button></>}>
        <Field label="Email addresses" hint="One per line or separated by commas"><textarea className="input min-h-[140px]" value={emails} onChange={(e) => setEmails(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}
