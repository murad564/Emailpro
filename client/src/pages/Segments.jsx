import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Filter, Pencil, Copy, Trash2, Users, Send } from 'lucide-react';
import { get, post, put, del, qs, fmt } from '../api.js';
import FilterBar, { EMPTY_FILTERS, filterParams } from '../components/FilterBar.jsx';
import { Empty, ErrorBox, Field, Loading, Modal, PageHeader, Spinner, useConfirm, useToast } from '../ui.jsx';

export default function Segments() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const load = useCallback(() => get('/segments').then((r) => { setRows(r.rows); setError(null); }).catch(setError), []);
  useEffect(() => {
    load();
  }, [load]);
  const act = async (fn, msg) => {
    try {
      await fn();
      toast.success(msg);
      load();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <>
      <PageHeader title="Audience Segments" subtitle="Reusable audiences built from country, city, category, language and tags. They update automatically as contacts change."
        actions={<button className="btn-primary" onClick={() => setEditing({})}><Plus size={16} /> New segment</button>} />
      <ErrorBox error={error} onRetry={load} />
      {!rows ? <Loading /> : rows.length === 0 ? (
        <div className="card"><Empty icon={Filter} title="No segments yet" text='Create segments like "Travel Agencies – Azerbaijan" or "Tour Operators – Saudi Arabia" and reuse them in campaigns.' action={<button className="btn-primary" onClick={() => setEditing({})}><Plus size={16} /> Create your first segment</button>} /></div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => (
            <div key={s.id} className="card flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-navy-900">{s.name}</div>
                  {s.description && <div className="mt-0.5 text-sm text-slate-500">{s.description}</div>}
                </div>
                <Filter size={18} className="shrink-0 text-navy-300" />
              </div>
              <div className="mt-3 text-xs leading-relaxed text-slate-500">{s.description_auto}</div>
              <div className="mt-4 flex gap-6">
                <div><div className="text-2xl font-semibold text-navy-900 tabular-nums">{fmt.n(s.subscribed)}</div><div className="text-xs text-slate-500">subscribed</div></div>
                <div><div className="text-2xl font-semibold text-slate-400 tabular-nums">{fmt.n(s.total)}</div><div className="text-xs text-slate-500">total contacts</div></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
                <button className="btn-primary btn-sm" onClick={() => navigate(`/campaigns/new?segment_id=${s.id}`)}><Send size={14} /> Campaign</button>
                <button className="btn-secondary btn-sm" onClick={() => navigate(`/contacts${qs(s.filters)}`)}><Users size={14} /> Contacts</button>
                <button className="btn-ghost btn-sm" title="Edit" onClick={() => setEditing(s)}><Pencil size={14} /></button>
                <button className="btn-ghost btn-sm" title="Duplicate" onClick={() => act(() => post(`/segments/${s.id}/duplicate`), 'Segment duplicated.')}><Copy size={14} /></button>
                <button className="btn-ghost btn-sm text-red-600" title="Delete" onClick={async () => {
                  if (await confirm({ title: 'Delete segment', message: `Delete "${s.name}"? Contacts are not affected.`, danger: true, confirmText: 'Delete' })) act(() => del(`/segments/${s.id}`), 'Segment deleted.');
                }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <SegmentModal segment={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function SegmentModal({ segment, onClose, onSaved }) {
  const [name, setName] = useState(segment.name || '');
  const [description, setDescription] = useState(segment.description || '');
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, ...(segment.filters || {}) });
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    const t = setTimeout(() => post('/contacts/count', { filters: filterParams(filters) }).then(setCount).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [filters]);
  const save = async () => {
    setBusy(true);
    try {
      const body = { name, description, filters: filterParams(filters) };
      if (segment.id) await put(`/segments/${segment.id}`, body);
      else await post('/segments', body);
      toast.success('Segment saved.');
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={segment.id ? 'Edit segment' : 'New segment'} size="lg"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!name.trim() || busy} onClick={save}>{busy && <Spinner size={14} />} Save segment</button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Segment name"><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Agencies – Baku" /></Field>
        <Field label="Description (optional)"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <div className="mt-4 rounded-lg border border-slate-200 p-4">
        <FilterBar value={filters} onChange={setFilters} showStatus={false} compact />
      </div>
      <div className="mt-3 rounded-lg bg-navy-50 px-4 py-3 text-sm text-navy-900">
        {count ? <>Matches <b>{fmt.n(count.total)}</b> contacts, of which <b>{fmt.n(count.subscribed)}</b> are subscribed and can receive campaigns.</> : 'Counting…'}
      </div>
    </Modal>
  );
}
