import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Download, ArrowRight, ArrowLeft, RotateCcw, History } from 'lucide-react';
import { get, post, qs, download, fmt } from '../api.js';
import { useLookups } from '../App.jsx';
import FilterBar, { EMPTY_FILTERS, filterParams, hasFilters } from '../components/FilterBar.jsx';
import { Badge, Field, PageHeader, Spinner, Tabs, useConfirm, useToast } from '../ui.jsx';

export const FIELDS = [
  { key: 'email', label: 'Email Address', required: true, guess: ['email', 'e-mail', 'email address', 'mail', 'e-poçt', 'epoct', 'почта', 'электронная почта'] },
  { key: 'full_name', label: 'Full Name', guess: ['full name', 'name', 'contact name', 'contact', 'ad soyad', 'фио', 'имя фамилия'] },
  { key: 'first_name', label: 'First Name', guess: ['first name', 'firstname', 'first', 'given name', 'ad', 'имя'] },
  { key: 'last_name', label: 'Last Name', guess: ['last name', 'lastname', 'surname', 'family name', 'soyad', 'фамилия'] },
  { key: 'company', label: 'Company Name', guess: ['company', 'company name', 'organization', 'organisation', 'agency', 'şirkət', 'компания', 'firma'] },
  { key: 'country', label: 'Country', guess: ['country', 'ölkə', 'страна', 'nation'] },
  { key: 'city', label: 'City', guess: ['city', 'şəhər', 'город', 'town'] },
  { key: 'phone', label: 'Phone Number', guess: ['phone', 'phone number', 'mobile', 'tel', 'telephone', 'telefon', 'телефон', 'whatsapp'] },
  { key: 'category', label: 'Contact Category', guess: ['category', 'contact category', 'type', 'segment', 'kateqoriya', 'категория'] },
  { key: 'language', label: 'Language', guess: ['language', 'lang', 'dil', 'язык'] },
  { key: 'tags', label: 'Tags', guess: ['tags', 'tag', 'labels'] },
  { key: 'notes', label: 'Notes', guess: ['notes', 'note', 'comment', 'comments', 'qeyd', 'примечание'] },
];

const EMAIL_RE = /^[^\s@"'<>(),;:\\[\]]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;
export const normEmail = (v) => String(v ?? '').trim().replace(/^mailto:/i, '').toLowerCase();
export const validEmail = (v) => {
  const e = normEmail(v);
  return !!e && e.length <= 254 && e.split('@')[0].length <= 64 && !e.includes('..') && EMAIL_RE.test(e);
};
const colLetter = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

export default function ImportExport() {
  const [tab, setTab] = useState('import');
  return (
    <>
      <PageHeader title="Import / Export" subtitle="Import contacts from Excel or CSV and export them back to Excel." />
      <Tabs tabs={[{ value: 'import', label: 'Import contacts' }, { value: 'export', label: 'Export contacts' }, { value: 'history', label: 'Import history' }]} value={tab} onChange={setTab} />
      {tab === 'import' && <ImportWizard onDone={() => setTab('history')} />}
      {tab === 'export' && <ExportPanel />}
      {tab === 'history' && <ImportHistory />}
    </>
  );
}

function Steps({ step }) {
  const items = ['Upload', 'Preview', 'Map columns', 'Validate', 'Import'];
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
      {items.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-navy-800 text-white' : 'bg-slate-200 text-slate-500'}`}>{i < step ? '✓' : i + 1}</span>
          <span className={i === step ? 'font-medium text-navy-900' : 'text-slate-500'}>{s}</span>
          {i < items.length - 1 && <span className="mx-1 h-px w-6 bg-slate-300" />}
        </div>
      ))}
    </div>
  );
}

function ImportWizard({ onDone }) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [wb, setWb] = useState(null);
  const [sheet, setSheet] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState({});
  const [parsing, setParsing] = useState(false);
  const [validation, setValidation] = useState(null);
  const [options, setOptions] = useState({ existing: 'skip', default_category: '', default_country: '', default_city: '', default_language: '', add_tags: '' });
  const [progress, setProgress] = useState(null);
  const [report, setReport] = useState(null);
  const cancelRef = useRef(false);
  const toast = useToast();
  const confirm = useConfirm();
  const L = useLookups();

  const grid = useMemo(() => {
    if (!wb || !sheet) return [];
    return XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: '', blankrows: false });
  }, [wb, sheet]);
  const width = useMemo(() => grid.reduce((m, r) => Math.max(m, r.length), 0), [grid]);
  const headers = useMemo(() => Array.from({ length: width }, (_, i) => (hasHeader ? String(grid[0]?.[i] ?? '').trim() : '') || `Column ${colLetter(i)}`), [grid, width, hasHeader]);
  const dataRows = useMemo(() => (hasHeader ? grid.slice(1) : grid), [grid, hasHeader]);

  // Auto-map columns by header name.
  useEffect(() => {
    if (!width) return;
    const m = {};
    const used = new Set();
    for (const f of FIELDS) {
      const idx = headers.findIndex((h, i) => !used.has(i) && f.guess.includes(h.toLowerCase().replace(/[_*]+/g, ' ').replace(/\s+/g, ' ').trim()));
      if (idx >= 0) { m[f.key] = idx; used.add(idx); }
    }
    if (m.email === undefined) {
      // Fall back to the column where most values look like emails.
      let best = -1, bestN = 0;
      for (let i = 0; i < width; i++) {
        const n = dataRows.slice(0, 200).filter((r) => validEmail(r[i])).length;
        if (n > bestN) { best = i; bestN = n; }
      }
      if (best >= 0) m.email = best;
    }
    setMapping(m);
  }, [headers, width, dataRows]);

  const onFile = async (f) => {
    if (!f) return;
    if (!/\.(xlsx|xls|csv|txt)$/i.test(f.name)) return toast.error('Please choose an .xlsx, .xls or .csv file.');
    setParsing(true);
    try {
      const buf = await f.arrayBuffer();
      const book = /\.(csv|txt)$/i.test(f.name)
        ? XLSX.read(new TextDecoder('utf-8').decode(buf), { type: 'string', raw: true })
        : XLSX.read(buf, { type: 'array', cellDates: true, dense: true });
      setFile(f);
      setWb(book);
      setSheet(book.SheetNames[0]);
      setStep(1);
    } catch (e) {
      toast.error(`Could not read this file: ${e.message}`);
    } finally {
      setParsing(false);
    }
  };

  const mappedRows = () =>
    dataRows.map((r, i) => {
      const o = { __row: i + (hasHeader ? 2 : 1) };
      for (const f of FIELDS) if (mapping[f.key] !== undefined && mapping[f.key] !== '') o[f.key] = String(r[mapping[f.key]] ?? '').trim();
      return o;
    });

  const runValidation = async () => {
    setParsing(true);
    try {
      const rows = mappedRows();
      const seen = new Set();
      let invalid = 0, dupes = 0;
      const invalidSamples = [];
      const unique = [];
      for (const r of rows) {
        const e = normEmail(r.email);
        if (!validEmail(e)) { invalid++; if (invalidSamples.length < 200) invalidSamples.push({ row: r.__row, email: r.email || '(empty)' }); continue; }
        if (seen.has(e)) { dupes++; continue; }
        seen.add(e);
        unique.push(e);
      }
      let existing = 0, suppressed = 0;
      for (let i = 0; i < unique.length; i += 5000) {
        const res = await post('/contacts/check-duplicates', { emails: unique.slice(i, i + 5000) });
        existing += res.existing.length;
        const exSet = new Set(res.existing);
        suppressed += res.suppressed.filter((x) => !exSet.has(x)).length;
      }
      setValidation({ total: rows.length, invalid, dupes, unique: unique.length, existing, suppressed, newCount: unique.length - existing, invalidSamples });
      setStep(3);
    } catch (e) {
      toast.error(e);
    } finally {
      setParsing(false);
    }
  };

  const runImport = async () => {
    const rows = mappedRows();
    const willImport = validation.newCount + (options.existing === 'update' ? validation.existing : 0);
    if (!(await confirm({ title: 'Confirm import', message: `Import ${fmt.n(willImport)} contact(s) from ${file.name}?${options.existing === 'update' ? `\n${fmt.n(validation.existing)} existing contacts will be updated.` : ''}`, confirmText: 'Start import' }))) return;
    cancelRef.current = false;
    setStep(4);
    setProgress({ done: 0, total: rows.length });
    try {
      const mapNames = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, headers[v]]));
      const { id } = await post('/imports', { file_name: file.name, total_rows: rows.length, mapping: mapNames, options });
      const CHUNK = 2000;
      for (let i = 0; i < rows.length; i += CHUNK) {
        if (cancelRef.current) break;
        let attempt = 0;
        for (;;) {
          try {
            await post(`/imports/${id}/rows`, { rows: rows.slice(i, i + CHUNK) });
            break;
          } catch (e) {
            if (++attempt >= 3 || (e.status && e.status < 500)) throw e;
            await new Promise((r) => setTimeout(r, 1500 * attempt));
          }
        }
        setProgress({ done: Math.min(i + CHUNK, rows.length), total: rows.length });
      }
      const result = await post(`/imports/${id}/finish`, { cancelled: cancelRef.current });
      setReport(result);
      L.reload();
      toast.success(`Import ${result.status}: ${fmt.n(result.imported)} new contacts.`);
    } catch (e) {
      toast.error(`Import stopped: ${e.message}`);
      setProgress((p) => ({ ...p, error: e.message }));
    }
  };

  const reset = () => { setStep(0); setFile(null); setWb(null); setValidation(null); setProgress(null); setReport(null); };

  return (
    <div className="card p-5">
      <Steps step={step} />

      {step === 0 && (
        <label
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-navy-200 bg-navy-50/40 px-6 py-16 text-center transition hover:bg-navy-50"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}
        >
          {parsing ? <Spinner size={30} className="text-navy-600" /> : <Upload size={34} className="text-navy-500" />}
          <div className="mt-3 font-semibold text-navy-900">{parsing ? 'Reading file…' : 'Drop your Excel or CSV file here'}</div>
          <div className="mt-1 text-sm text-slate-500">or click to browse · .xlsx, .xls, .csv · up to 50,000+ rows</div>
          <input type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={(e) => onFile(e.target.files[0])} />
        </label>
      )}

      {step === 1 && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 font-medium text-navy-900"><FileSpreadsheet size={18} /> {file.name}</span>
            <span className="text-slate-500">{fmt.n(dataRows.length)} data rows · {width} columns</span>
            {wb.SheetNames.length > 1 && (
              <select className="input w-auto py-1" value={sheet} onChange={(e) => setSheet(e.target.value)}>
                {wb.SheetNames.map((s) => <option key={s}>{s}</option>)}
              </select>
            )}
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> First row contains column headers</label>
          </div>
          <SheetPreview grid={grid} width={width} hasHeader={hasHeader} />
          <div className="mt-4 flex justify-between">
            <button className="btn-secondary" onClick={reset}><ArrowLeft size={16} /> Choose another file</button>
            <button className="btn-primary" disabled={!dataRows.length} onClick={() => setStep(2)}>Map columns <ArrowRight size={16} /></button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <p className="mb-4 text-sm text-slate-500">Match each field to a column from your file. We've guessed based on the header names. Only Email Address is required.</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {FIELDS.map((f) => {
              const idx = mapping[f.key];
              const sample = idx !== undefined && idx !== '' ? dataRows.slice(0, 3).map((r) => r[idx]).filter(Boolean).join(' · ') : '';
              return (
                <div key={f.key} className={`rounded-lg border p-3 ${f.required && (idx === undefined || idx === '') ? 'border-red-300 bg-red-50/40' : 'border-slate-200'}`}>
                  <div className="mb-1.5 text-sm font-medium text-slate-700">{f.label}{f.required && <span className="text-red-500"> *</span>}</div>
                  <select className="input" value={idx ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value === '' ? '' : Number(e.target.value) }))}>
                    <option value="">— Don't import —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{colLetter(i)}: {h}</option>)}
                  </select>
                  <div className="mt-1 truncate text-xs text-slate-400">{sample ? `e.g. ${sample}` : ' '}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-between">
            <button className="btn-secondary" onClick={() => setStep(1)}><ArrowLeft size={16} /> Back</button>
            <button className="btn-primary" disabled={mapping.email === undefined || mapping.email === '' || parsing} onClick={runValidation}>
              {parsing && <Spinner size={14} />} Validate data <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {step === 3 && validation && (
        <div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Rows in file" v={validation.total} />
            <Stat label="Valid unique emails" v={validation.unique} tone="green" />
            <Stat label="Invalid emails" v={validation.invalid} tone={validation.invalid ? 'red' : 'slate'} />
            <Stat label="Duplicates in file" v={validation.dupes} tone={validation.dupes ? 'amber' : 'slate'} />
            <Stat label="Already in database" v={validation.existing} tone={validation.existing ? 'amber' : 'slate'} />
            <Stat label="New contacts" v={validation.newCount} tone="navy" />
          </div>
          {validation.suppressed > 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {fmt.n(validation.suppressed)} address(es) previously unsubscribed or bounced. They will be imported as <b>unsubscribed</b> and never emailed.
            </div>
          )}
          {validation.invalidSamples.length > 0 && (
            <details className="mt-3 rounded-lg border border-slate-200 p-3 text-sm">
              <summary className="cursor-pointer font-medium text-red-700">Show invalid email addresses ({fmt.n(validation.invalid)})</summary>
              <div className="mt-2 max-h-48 overflow-y-auto">
                {validation.invalidSamples.map((x, i) => <div key={i} className="flex gap-3 py-0.5 text-slate-600"><span className="w-16 text-slate-400">Row {x.row}</span>{x.email}</div>)}
              </div>
            </details>
          )}

          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="mb-2 text-sm font-semibold text-navy-900">Contacts that already exist</div>
              <label className="mb-1.5 flex items-center gap-2 text-sm"><input type="radio" checked={options.existing === 'skip'} onChange={() => setOptions((o) => ({ ...o, existing: 'skip' }))} /> Skip them (prevent duplicates, keep current data)</label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" checked={options.existing === 'update'} onChange={() => setOptions((o) => ({ ...o, existing: 'update' }))} /> Update them with non-empty values from this file</label>
              <p className="mt-2 text-xs text-slate-400">Subscription status is never changed by an import.</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="mb-2 text-sm font-semibold text-navy-900">Defaults for empty cells (optional)</div>
              <div className="grid grid-cols-2 gap-2">
                <input className="input" list="imp-cats" placeholder="Category" value={options.default_category} onChange={(e) => setOptions((o) => ({ ...o, default_category: e.target.value }))} />
                <input className="input" list="imp-countries" placeholder="Country" value={options.default_country} onChange={(e) => setOptions((o) => ({ ...o, default_country: e.target.value }))} />
                <input className="input" placeholder="City" value={options.default_city} onChange={(e) => setOptions((o) => ({ ...o, default_city: e.target.value }))} />
                <input className="input" placeholder="Language" value={options.default_language} onChange={(e) => setOptions((o) => ({ ...o, default_language: e.target.value }))} />
                <input className="input col-span-2" placeholder="Add tags to every imported contact (comma separated)" value={options.add_tags} onChange={(e) => setOptions((o) => ({ ...o, add_tags: e.target.value }))} />
              </div>
              <datalist id="imp-cats">{L.categories.map((c) => <option key={c.id} value={c.name} />)}</datalist>
              <datalist id="imp-countries">{L.countries.map((c) => <option key={c.id} value={c.name} />)}</datalist>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button className="btn-secondary" onClick={() => setStep(2)}><ArrowLeft size={16} /> Back to mapping</button>
            <div className="text-sm text-slate-600">
              Will import <b>{fmt.n(validation.newCount + (options.existing === 'update' ? validation.existing : 0))}</b> contacts
              {options.existing === 'update' && validation.existing > 0 && <> (including {fmt.n(validation.existing)} updates)</>}
            </div>
            <button className="btn-primary" disabled={validation.unique === 0 || (validation.newCount === 0 && options.existing === 'skip')} onClick={runImport}>
              Confirm import <CheckCircle2 size={16} />
            </button>
          </div>
        </div>
      )}

      {step === 4 && progress && (
        <div className="py-4">
          {!report ? (
            <>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-navy-900">{progress.error ? 'Import stopped' : 'Importing…'}</span>
                <span className="text-slate-500">{fmt.n(progress.done)} / {fmt.n(progress.total)} rows</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-navy-700 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
              {progress.error ? (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  <span><AlertTriangle size={16} className="mr-1 inline" /> {progress.error}. Rows already processed were saved; see Import history.</span>
                  <button className="btn-secondary btn-sm" onClick={reset}>Start over</button>
                </div>
              ) : (
                <button className="btn-ghost btn-sm mt-3" onClick={() => (cancelRef.current = true)}>Stop after current chunk</button>
              )}
            </>
          ) : (
            <ImportReport report={report} onNew={reset} onHistory={onDone} />
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, v, tone = 'slate' }) {
  const c = { slate: 'text-slate-800', green: 'text-emerald-700', red: 'text-red-700', amber: 'text-amber-700', navy: 'text-navy-800' }[tone];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${c}`}>{fmt.n(v)}</div>
    </div>
  );
}

function ImportReport({ report, onNew, onHistory }) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-lg font-semibold text-emerald-700"><CheckCircle2 /> Import {report.status}</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Rows processed" v={report.total_rows} />
        <Stat label="New contacts imported" v={report.imported} tone="green" />
        <Stat label="Existing updated" v={report.updated} tone="navy" />
        <Stat label="Existing skipped" v={report.skipped_existing} tone="amber" />
        <Stat label="Duplicates in file" v={report.duplicates_in_file} tone="amber" />
        <Stat label="Invalid emails" v={report.invalid} tone={report.invalid ? 'red' : 'slate'} />
      </div>
      {report.suppressed > 0 && <p className="mt-3 text-sm text-amber-700">{fmt.n(report.suppressed)} were on the suppression list and were imported as unsubscribed.</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={onNew}><RotateCcw size={16} /> Import another file</button>
        {report.invalid > 0 && <button className="btn-secondary" onClick={() => download(`/imports/${report.id}/invalid.xlsx`)}><Download size={16} /> Download invalid rows</button>}
        <button className="btn-secondary" onClick={onHistory}><History size={16} /> Import history</button>
      </div>
    </div>
  );
}

function SheetPreview({ grid, width, hasHeader }) {
  const shown = grid.slice(0, 101);
  return (
    <div className="max-h-[460px] overflow-auto rounded-lg border border-slate-300">
      <table className="border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="sticky left-0 z-20 w-10 border border-slate-300 bg-slate-100 px-2 py-1 text-slate-500"></th>
            {Array.from({ length: width }, (_, i) => <th key={i} className="min-w-[120px] border border-slate-300 bg-slate-100 px-2 py-1 font-semibold text-slate-500">{colLetter(i)}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, ri) => (
            <tr key={ri} className={hasHeader && ri === 0 ? 'bg-navy-50 font-semibold text-navy-900' : 'bg-white'}>
              <td className="sticky left-0 border border-slate-300 bg-slate-100 px-2 py-1 text-center text-slate-500">{ri + 1}</td>
              {Array.from({ length: width }, (_, ci) => <td key={ci} className="max-w-[260px] truncate border border-slate-200 px-2 py-1">{String(r[ci] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {grid.length > 101 && <div className="sticky left-0 bg-slate-50 px-3 py-2 text-xs text-slate-500">Showing first 100 rows of {fmt.n(grid.length - (hasHeader ? 1 : 0))}.</div>}
    </div>
  );
}

function ExportPanel() {
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [count, setCount] = useState(null);
  const [name, setName] = useState('');
  useEffect(() => {
    const t = setTimeout(() => post('/contacts/count', { filters: filterParams(filters) }).then((r) => setCount(r.total)).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [filters]);
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="mb-3 text-sm font-semibold text-navy-900">Choose which contacts to export</div>
        <FilterBar value={filters} onChange={setFilters} />
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
          <Field label="File name (optional)"><input className="input w-64" value={name} onChange={(e) => setName(e.target.value)} placeholder={hasFilters(filters) ? 'contacts_filtered' : 'contacts_all'} /></Field>
          <button className="btn-primary" disabled={!count} onClick={() => download(`/contacts/export${qs({ ...filterParams(filters), filename: name || (hasFilters(filters) ? 'contacts_filtered' : 'contacts_all') })}`)}>
            <Download size={16} /> Export {count === null ? '' : fmt.n(count)} contacts to Excel
          </button>
        </div>
      </div>
      <p className="text-sm text-slate-500">To export hand-picked contacts, select them on the Contacts page and use "Export selected". Exported files include: Full Name, First Name, Last Name, Email, Company, Country, City, Phone, Category, Language, Tags, Status, Date Added and Notes.</p>
    </div>
  );
}

function ImportHistory() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    get('/imports').then((r) => setRows(r.rows)).catch(() => setRows([]));
  }, []);
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead><tr><th>File</th><th>Date</th><th>By</th><th>Status</th><th>Rows</th><th>Imported</th><th>Updated</th><th>Skipped</th><th>Dupes in file</th><th>Invalid</th><th></th></tr></thead>
        <tbody>
          {!rows ? <tr><td colSpan={11} className="py-8 text-center"><Spinner className="inline" /></td></tr>
            : rows.length === 0 ? <tr><td colSpan={11} className="py-10 text-center text-slate-400">No imports yet.</td></tr>
            : rows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.file_name}</td>
                <td className="whitespace-nowrap text-slate-500">{fmt.dt(r.created_at)}</td>
                <td>{r.created_by_name || '—'}</td>
                <td><Badge value={r.status} /></td>
                <td>{fmt.n(r.total_rows)}</td>
                <td className="text-emerald-700">{fmt.n(r.imported)}</td>
                <td>{fmt.n(r.updated)}</td>
                <td>{fmt.n(r.skipped_existing)}</td>
                <td>{fmt.n(r.duplicates_in_file)}</td>
                <td className={r.invalid ? 'text-red-600' : ''}>{fmt.n(r.invalid)}</td>
                <td>{r.invalid > 0 && <button className="btn-ghost btn-sm" onClick={() => download(`/imports/${r.id}/invalid.xlsx`)}><Download size={14} /> Invalid rows</button>}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
