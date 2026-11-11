import { Search, X } from 'lucide-react';
import { useLookups } from '../App.jsx';
import { MultiSelect } from '../ui.jsx';

export const EMPTY_FILTERS = { search: '', country_ids: [], city_ids: [], category_ids: [], languages: [], tag_ids: [], statuses: [] };

export function hasFilters(f) {
  return !!(f.search || f.country_ids?.length || f.city_ids?.length || f.category_ids?.length || f.languages?.length || f.tag_ids?.length || f.statuses?.length);
}

export default function FilterBar({ value, onChange, showStatus = true, showSearch = true, compact = false }) {
  const L = useLookups();
  const f = { ...EMPTY_FILTERS, ...value };
  const set = (k, v) => {
    const next = { ...f, [k]: v };
    // Drop selected cities that no longer belong to the chosen countries.
    if (k === 'country_ids' && v.length) {
      const allowed = new Set(L.cities.filter((c) => v.map(Number).includes(c.country_id)).map((c) => c.id));
      next.city_ids = next.city_ids.filter((id) => allowed.has(Number(id)));
    }
    onChange(next);
  };
  const cityOpts = L.cities
    .filter((c) => !f.country_ids.length || f.country_ids.map(Number).includes(c.country_id))
    .map((c) => {
      const co = L.countries.find((x) => x.id === c.country_id);
      return { value: c.id, label: f.country_ids.length === 1 || !co ? c.name : `${c.name} (${co.name})`, hint: c.contacts };
    });
  const grid = compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6';
  return (
    <div className="space-y-3">
      {showSearch && (
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search by name, email, company, country or city…"
            value={f.search}
            onChange={(e) => set('search', e.target.value)}
          />
        </div>
      )}
      <div className={`grid gap-3 ${grid}`}>
        <MultiSelect label="Country" placeholder="All countries" value={f.country_ids} onChange={(v) => set('country_ids', v)}
          options={L.countries.map((c) => ({ value: c.id, label: c.name, hint: c.contacts }))} />
        <MultiSelect label="City" placeholder="All cities" value={f.city_ids} onChange={(v) => set('city_ids', v)} options={cityOpts} />
        <MultiSelect label="Category" placeholder="All categories" value={f.category_ids} onChange={(v) => set('category_ids', v)}
          options={L.categories.map((c) => ({ value: c.id, label: c.name, hint: c.contacts }))} />
        <MultiSelect label="Language" placeholder="All languages" value={f.languages} onChange={(v) => set('languages', v)}
          options={L.languages.map((l) => ({ value: l.name, label: l.name, hint: l.contacts }))} />
        <MultiSelect label="Tags" placeholder="Any tags" value={f.tag_ids} onChange={(v) => set('tag_ids', v)}
          options={L.tags.map((t) => ({ value: t.id, label: t.name, hint: t.contacts }))} />
        {showStatus && (
          <MultiSelect label="Status" placeholder="Any status" value={f.statuses} onChange={(v) => set('statuses', v)}
            options={[{ value: 'subscribed', label: 'Subscribed' }, { value: 'unsubscribed', label: 'Unsubscribed' }, { value: 'bounced', label: 'Bounced' }]} />
        )}
      </div>
      {hasFilters(f) && (
        <button className="inline-flex items-center gap-1 text-xs font-medium text-navy-600 hover:underline" onClick={() => onChange({ ...EMPTY_FILTERS })}>
          <X size={13} /> Clear all filters
        </button>
      )}
    </div>
  );
}

/** Converts filter state to API query/body params. */
export function filterParams(f) {
  return {
    search: f.search || undefined,
    country_ids: f.country_ids, city_ids: f.city_ids, category_ids: f.category_ids,
    languages: f.languages, tag_ids: f.tag_ids, statuses: f.statuses,
  };
}
