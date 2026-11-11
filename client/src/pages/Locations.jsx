import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronDown, Plus, Pencil, Trash2, Users, Globe2, Send } from 'lucide-react';
import { get, post, put, del, fmt } from '../api.js';
import { useLookups } from '../App.jsx';
import { Empty, Field, Loading, Modal, PageHeader, Tabs, useConfirm, useToast } from '../ui.jsx';

export default function Locations() {
  const [tab, setTab] = useState('locations');
  return (
    <>
      <PageHeader title="Countries & Cities" subtitle="See how your contacts are distributed and keep locations, categories and tags tidy." />
      <Tabs tabs={[{ value: 'locations', label: 'Countries & cities' }, { value: 'categories', label: 'Categories' }, { value: 'tags', label: 'Tags' }]} value={tab} onChange={setTab} />
      {tab === 'locations' ? <LocationTree /> : <SimpleList table={tab} />}
    </>
  );
}

function NameModal({ title, initial = '', extra, onSave, onClose }) {
  const [name, setName] = useState(initial);
  return (
    <Modal open onClose={onClose} title={title} size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save</button></>}>
      <Field label="Name" hint={initial ? 'If another entry already has this name, the two will be merged.' : undefined}>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())} />
      </Field>
      {extra}
    </Modal>
  );
}

function LocationTree() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(new Set());
  const [modal, setModal] = useState(null);
  const [q, setQ] = useState('');
  const toast = useToast();
  const confirm = useConfirm();
  const L = useLookups();
  const navigate = useNavigate();
  const load = useCallback(() => get('/locations/overview').then(setData).catch(toast.error), [toast]);
  useEffect(() => {
    load();
  }, [load]);
  const refresh = () => {
    load();
    L.reload();
  };
  const run = async (fn, msg) => {
    try {
      const r = await fn();
      toast.success(r?.merged ? 'Merged with the existing entry.' : msg);
      setModal(null);
      refresh();
    } catch (e) {
      toast.error(e);
    }
  };
  if (!data) return <Loading />;
  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const countries = data.countries.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || data.cities.some((ci) => ci.country_id === c.id && ci.name.toLowerCase().includes(q.toLowerCase())));
  const removeCountry = async (c) => {
    if (await confirm({ title: `Delete ${c.name}?`, message: `${fmt.n(c.contacts)} contact(s) will keep their data but lose this country and its cities. This cannot be undone.`, danger: true, confirmText: 'Delete' }))
      run(() => del(`/locations/countries/${c.id}`), 'Country deleted.');
  };
  const removeCity = async (c) => {
    if (await confirm({ title: `Delete ${c.name}?`, message: `${fmt.n(c.contacts)} contact(s) will lose this city.`, danger: true, confirmText: 'Delete' }))
      run(() => del(`/locations/cities/${c.id}`), 'City deleted.');
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card p-4"><div className="text-xs text-slate-500">Countries</div><div className="text-xl font-semibold text-navy-900">{fmt.n(data.countries.length)}</div></div>
        <div className="card p-4"><div className="text-xs text-slate-500">Cities</div><div className="text-xl font-semibold text-navy-900">{fmt.n(data.cities.length)}</div></div>
        <div className="card p-4"><div className="text-xs text-slate-500">Contacts without country</div><div className="text-xl font-semibold text-amber-700">{fmt.n(data.unassigned.no_country)}</div></div>
        <div className="card p-4"><div className="text-xs text-slate-500">Contacts without city</div><div className="text-xl font-semibold text-amber-700">{fmt.n(data.unassigned.no_city)}</div></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search country or city…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary ml-auto" onClick={() => setModal({ type: 'addCountry' })}><Plus size={16} /> Add country</button>
      </div>
      <div className="card overflow-x-auto">
        {countries.length === 0 ? (
          <Empty icon={Globe2} title="No countries yet" text="Countries and cities are created automatically when you import or add contacts." />
        ) : (
          <table className="table">
            <thead><tr><th className="w-8"></th><th>Country / City</th><th className="text-right">Contacts</th><th className="text-right">Subscribed</th><th className="text-right">Cities</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {countries.map((c) => {
                const cities = data.cities.filter((ci) => ci.country_id === c.id);
                const isOpen = open.has(c.id) || !!q;
                return [
                  <tr key={`c${c.id}`} className="bg-white">
                    <td><button className="text-slate-400" onClick={() => toggle(c.id)}>{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button></td>
                    <td className="font-semibold text-navy-900"><button onClick={() => toggle(c.id)}>{c.name}</button></td>
                    <td className="text-right tabular-nums">{fmt.n(c.contacts)}</td>
                    <td className="text-right tabular-nums text-emerald-700">{fmt.n(c.subscribed)}</td>
                    <td className="text-right tabular-nums">{fmt.n(c.cities)}</td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn-ghost btn-sm" title="View contacts" onClick={() => navigate(`/contacts?country_ids=${c.id}`)}><Users size={15} /></button>
                      <button className="btn-ghost btn-sm" title="New campaign for this country" onClick={() => navigate(`/campaigns/new?country_ids=${c.id}`)}><Send size={15} /></button>
                      <button className="btn-ghost btn-sm" title="Add city" onClick={() => setModal({ type: 'addCity', country: c })}><Plus size={15} /></button>
                      <button className="btn-ghost btn-sm" title="Rename" onClick={() => setModal({ type: 'renameCountry', item: c })}><Pencil size={15} /></button>
                      <button className="btn-ghost btn-sm text-red-600" title="Delete" onClick={() => removeCountry(c)}><Trash2 size={15} /></button>
                    </td>
                  </tr>,
                  ...(isOpen ? cities.filter((ci) => !q || ci.name.toLowerCase().includes(q.toLowerCase()) || c.name.toLowerCase().includes(q.toLowerCase())).map((ci) => (
                    <tr key={`ci${ci.id}`} className="bg-slate-50/50">
                      <td></td>
                      <td className="pl-8 text-slate-700">{ci.name}</td>
                      <td className="text-right tabular-nums">{fmt.n(ci.contacts)}</td>
                      <td className="text-right tabular-nums text-emerald-700">{fmt.n(ci.subscribed)}</td>
                      <td></td>
                      <td className="text-right whitespace-nowrap">
                        <button className="btn-ghost btn-sm" title="View contacts" onClick={() => navigate(`/contacts?country_ids=${c.id}&city_ids=${ci.id}`)}><Users size={15} /></button>
                        <button className="btn-ghost btn-sm" title="New campaign for this city" onClick={() => navigate(`/campaigns/new?country_ids=${c.id}&city_ids=${ci.id}`)}><Send size={15} /></button>
                        <button className="btn-ghost btn-sm" title="Rename" onClick={() => setModal({ type: 'renameCity', item: ci })}><Pencil size={15} /></button>
                        <button className="btn-ghost btn-sm text-red-600" title="Delete" onClick={() => removeCity(ci)}><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  )) : []),
                ];
              })}
            </tbody>
          </table>
        )}
      </div>
      {modal?.type === 'addCountry' && <NameModal title="Add country" onClose={() => setModal(null)} onSave={(name) => run(() => post('/locations/countries', { name }), 'Country added.')} />}
      {modal?.type === 'addCity' && <NameModal title={`Add city in ${modal.country.name}`} onClose={() => setModal(null)} onSave={(name) => run(() => post('/locations/cities', { name, country_id: modal.country.id }), 'City added.')} />}
      {modal?.type === 'renameCountry' && <NameModal title="Rename country" initial={modal.item.name} onClose={() => setModal(null)} onSave={(name) => run(() => put(`/locations/countries/${modal.item.id}`, { name }), 'Country renamed.')} />}
      {modal?.type === 'renameCity' && <NameModal title="Rename city" initial={modal.item.name} onClose={() => setModal(null)} onSave={(name) => run(() => put(`/locations/cities/${modal.item.id}`, { name }), 'City renamed.')} />}
    </div>
  );
}

function SimpleList({ table }) {
  const L = useLookups();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [modal, setModal] = useState(null);
  const items = table === 'categories' ? L.categories : L.tags;
  const label = table === 'categories' ? 'category' : 'tag';
  const param = table === 'categories' ? 'category_ids' : 'tag_ids';
  const run = async (fn, msg) => {
    try {
      const r = await fn();
      toast.success(r?.merged ? 'Merged with the existing entry.' : msg);
      setModal(null);
      L.reload();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button className="btn-primary" onClick={() => setModal({ type: 'add' })}><Plus size={16} /> Add {label}</button></div>
      <div className="card overflow-x-auto">
        {items.length === 0 ? <Empty title={`No ${table} yet`} text="They are created automatically from imports and contact edits." /> : (
          <table className="table">
            <thead><tr><th>Name</th><th className="text-right">Contacts</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id}>
                  <td className="font-medium">{x.name}</td>
                  <td className="text-right tabular-nums">{fmt.n(x.contacts)}</td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn-ghost btn-sm" title="View contacts" onClick={() => navigate(`/contacts?${param}=${x.id}`)}><Users size={15} /></button>
                    <button className="btn-ghost btn-sm" title="Rename" onClick={() => setModal({ type: 'rename', item: x })}><Pencil size={15} /></button>
                    <button className="btn-ghost btn-sm text-red-600" title="Delete" onClick={async () => {
                      if (await confirm({ title: `Delete ${x.name}?`, message: `It will be removed from ${fmt.n(x.contacts)} contact(s).`, danger: true, confirmText: 'Delete' })) run(() => del(`/locations/${table}/${x.id}`), 'Deleted.');
                    }}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {modal?.type === 'add' && <NameModal title={`Add ${label}`} onClose={() => setModal(null)} onSave={(name) => run(() => post(`/locations/${table}`, { name }), 'Added.')} />}
      {modal?.type === 'rename' && <NameModal title={`Rename ${label}`} initial={modal.item.name} onClose={() => setModal(null)} onSave={(name) => run(() => put(`/locations/${table}/${modal.item.id}`, { name }), 'Renamed.')} />}
    </div>
  );
}
