import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { X, Check, ChevronDown, Loader2, AlertTriangle, CheckCircle2, Info, ChevronLeft, ChevronRight, Search } from 'lucide-react';

// ---------------- Toasts ----------------
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((type, message) => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, type, message }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), type === 'error' ? 7000 : 4000);
  }, []);
  const api = useMemo(
    () => ({ success: (m) => push('success', m), error: (m) => push('error', m?.message || String(m)), info: (m) => push('info', m) }),
    [push]
  );
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg ${
              t.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : t.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-navy-200 bg-white text-slate-700'
            }`}
          >
            {t.type === 'error' ? <AlertTriangle size={18} className="mt-0.5 shrink-0" /> : t.type === 'success' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <Info size={18} className="mt-0.5 shrink-0" />}
            <span className="flex-1">{t.message}</span>
            <button onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))} className="opacity-60 hover:opacity-100">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------- Modal & confirm ----------------
export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`card w-full ${w} my-auto`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h3 className="text-base font-semibold text-navy-900">{title}</h3>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 rounded-b-xl">{footer}</div>}
      </div>
    </div>
  );
}

const ConfirmCtx = createContext(null);
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const confirm = useCallback(
    (opts) => new Promise((resolve) => setState({ ...opts, resolve })),
    []
  );
  const close = (v) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title || 'Are you sure?'}
        size="sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => close(false)}>Cancel</button>
            <button className={state?.danger ? 'btn-danger' : 'btn-primary'} onClick={() => close(true)}>
              {state?.confirmText || 'Confirm'}
            </button>
          </>
        }
      >
        <div className="text-sm text-slate-600 whitespace-pre-line">{state?.message}</div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ---------------- Small pieces ----------------
export const Spinner = ({ size = 18, className = '' }) => <Loader2 size={size} className={`animate-spin ${className}`} />;

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Spinner /> {label}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-navy-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, icon: Icon, hint, tone = 'navy' }) {
  const tones = {
    navy: 'bg-navy-50 text-navy-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    sky: 'bg-sky-50 text-sky-700',
    slate: 'bg-slate-100 text-slate-600',
  };
  return (
    <div className="card flex items-start gap-3 p-4">
      {Icon && (
        <div className={`rounded-lg p-2 ${tones[tone]}`}>
          <Icon size={20} />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className="mt-0.5 text-xl font-semibold text-navy-900 tabular-nums">{value}</div>
        {hint && <div className="mt-0.5 truncate text-xs text-slate-400">{hint}</div>}
      </div>
    </div>
  );
}

const BADGE = {
  subscribed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  unsubscribed: 'bg-slate-100 text-slate-600 ring-slate-200',
  bounced: 'bg-red-50 text-red-700 ring-red-200',
  draft: 'bg-slate-100 text-slate-600 ring-slate-200',
  scheduled: 'bg-sky-50 text-sky-700 ring-sky-200',
  sending: 'bg-amber-50 text-amber-700 ring-amber-200',
  paused: 'bg-orange-50 text-orange-700 ring-orange-200',
  sent: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  partially_sent: 'bg-amber-50 text-amber-800 ring-amber-200',
  failed: 'bg-red-50 text-red-700 ring-red-200',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-200',
  queued: 'bg-slate-100 text-slate-600 ring-slate-200',
  delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  soft_bounce: 'bg-amber-50 text-amber-700 ring-amber-200',
  hard_bounce: 'bg-red-50 text-red-700 ring-red-200',
  skipped: 'bg-slate-100 text-slate-500 ring-slate-200',
  pending: 'bg-slate-100 text-slate-600 ring-slate-200',
  processing: 'bg-amber-50 text-amber-700 ring-amber-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  running: 'bg-amber-50 text-amber-700 ring-amber-200',
  admin: 'bg-navy-100 text-navy-800 ring-navy-200',
  user: 'bg-slate-100 text-slate-600 ring-slate-200',
};
export function Badge({ value, children }) {
  const label = children ?? String(value || '').replace(/_/g, ' ');
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${BADGE[value] || BADGE.draft}`}>{label}</span>;
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm text-slate-500">
      <span>
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft size={14} /> Prev
        </button>
        <span className="px-2">
          Page {page} / {pages.toLocaleString()}
        </span>
        <button className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

export function Empty({ icon: Icon, title, text, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {Icon && (
        <div className="mb-3 rounded-full bg-navy-50 p-3 text-navy-600">
          <Icon size={26} />
        </div>
      )}
      <div className="font-semibold text-navy-900">{title}</div>
      {text && <p className="mt-1 max-w-md text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
            value === t.value ? 'border-navy-700 text-navy-800' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-500">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Searchable multi-select dropdown. options: [{value, label, hint}] */
export function MultiSelect({ options, value = [], onChange, placeholder = 'Any', label, disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const selected = new Set(value.map(String));
  const filtered = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())).slice(0, 300);
  const toggle = (v) => {
    const s = String(v);
    onChange(selected.has(s) ? value.filter((x) => String(x) !== s) : [...value, v]);
  };
  const names = options.filter((o) => selected.has(String(o.value))).map((o) => o.label);
  return (
    <div className="relative" ref={ref}>
      {label && <span className="label">{label}</span>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="input flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed"
      >
        <span className={`truncate ${names.length ? 'text-slate-800' : 'text-slate-400'}`}>
          {names.length ? (names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ')) : placeholder}
        </span>
        <ChevronDown size={16} className="shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[220px] rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-2 py-1.5">
            <Search size={14} className="text-slate-400" />
            <input autoFocus className="w-full py-1 text-sm outline-none" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">No options</div>}
            {filtered.map((o) => (
              <button
                type="button"
                key={o.value}
                onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-navy-50"
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded border ${selected.has(String(o.value)) ? 'border-navy-700 bg-navy-700 text-white' : 'border-slate-300'}`}>
                  {selected.has(String(o.value)) && <Check size={12} />}
                </span>
                <span className="flex-1 truncate">{o.label}</span>
                {o.hint !== undefined && <span className="text-xs text-slate-400">{o.hint}</span>}
              </button>
            ))}
          </div>
          {value.length > 0 && (
            <div className="border-t border-slate-100 px-2 py-1.5 text-right">
              <button type="button" className="text-xs text-navy-600 hover:underline" onClick={() => onChange([])}>
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fn();
      setState({ loading: false, data, error: null });
      return data;
    } catch (error) {
      setState({ loading: false, data: null, error });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { ...state, reload, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="card flex items-center justify-between gap-3 border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <span className="flex items-center gap-2">
        <AlertTriangle size={18} /> {error.message || String(error)}
      </span>
      {onRetry && (
        <button className="btn-secondary btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
