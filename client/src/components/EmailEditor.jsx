import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { html as htmlLang } from '@codemirror/lang-html';
import { EditorView } from '@codemirror/view';
import {
  Monitor, Smartphone, Code2, LayoutGrid, Type, Eye, PenLine, GripVertical, ChevronUp, ChevronDown, Copy, Trash2, Plus, Image as ImageIcon,
  Heading, AlignLeft, MousePointerClick, Minus, MoveVertical, Share2, PanelBottom, BadgeCheck, Braces, Upload,
} from 'lucide-react';
import { get, post } from '../api.js';
import { BLOCK_TYPES, defaultDesign, newBlock, renderBlock, renderDesign } from './blocks.js';
import { Spinner, useConfirm, useToast } from '../ui.jsx';

export const VARIABLES = [
  { v: '{{first_name}}', label: 'First name' },
  { v: '{{last_name}}', label: 'Last name' },
  { v: '{{company_name}}', label: 'Company' },
  { v: '{{country}}', label: 'Country' },
  { v: '{{city}}', label: 'City' },
  { v: '{{unsubscribe_url}}', label: 'Unsubscribe link URL' },
];

const ICONS = { logo: BadgeCheck, heading: Heading, text: AlignLeft, image: ImageIcon, button: MousePointerClick, divider: Minus, spacer: MoveVertical, social: Share2, footer: PanelBottom };

// ---------------- Preview ----------------
export function EmailPreview({ html, editorMode, textBody, preheader, subject, device = 'desktop', height = 640, contactId }) {
  const [out, setOut] = useState({ html: '', subject: '' });
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      post('/campaigns/render-preview', { html, editor_mode: editorMode, text_body: textBody, preheader, subject, contact_id: contactId })
        .then(setOut)
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 350);
    return () => clearTimeout(t);
  }, [html, editorMode, textBody, preheader, subject, contactId]);
  const doc = useMemo(() => (out.html || '').replace(/<head([^>]*)>/i, '<head$1><base target="_blank">'), [out.html]);
  return (
    <div className="flex h-full flex-col items-center">
      <div className={`flex w-full flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm transition-all ${device === 'mobile' ? 'max-w-[390px]' : 'max-w-[900px]'}`}>
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <div className="truncate"><span className="text-slate-400">Subject: </span><span className="font-medium text-slate-700">{out.subject || '(no subject)'}</span></div>
          {preheader && <div className="truncate text-slate-400">{preheader}</div>}
        </div>
        <div className="relative">
          {loading && <div className="absolute right-2 top-2 z-10"><Spinner size={16} className="text-slate-400" /></div>}
          <iframe title="Email preview" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} className="w-full bg-white" style={{ height }} />
        </div>
      </div>
      {out.footer_added && (
        <p className="mt-2 max-w-[900px] text-center text-xs text-slate-500">This design has no unsubscribe link, so a footer with your address and unsubscribe link is added automatically (shown above).</p>
      )}
    </div>
  );
}

function SampleContactPicker({ value, onChange }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    get('/contacts?pageSize=50&statuses=subscribed').then((r) => setRows(r.rows)).catch(() => {});
  }, []);
  return (
    <select className="input w-auto max-w-[220px] py-1 text-xs" value={value || ''} onChange={(e) => onChange(e.target.value || null)} title="Preview personalisation as">
      <option value="">Preview as: no contact (fallbacks)</option>
      {rows.map((c) => <option key={c.id} value={c.id}>{c.first_name || c.full_name || c.email} — {c.company || c.email}</option>)}
    </select>
  );
}

// ---------------- Main editor ----------------
/**
 * value: { editor_mode, html, text_body, design }
 * onChange(patch)
 */
export default function EmailEditor({ value, onChange, subject, preheader, companyAddress = '' }) {
  const mode = value.editor_mode || 'html';
  const [view, setView] = useState('edit');
  const [device, setDevice] = useState('desktop');
  const [contactId, setContactId] = useState(null);
  const confirm = useConfirm();
  const cmRef = useRef(null);
  const textRef = useRef(null);
  const visualInsertRef = useRef(null);

  const switchMode = async (next) => {
    if (next === mode) return;
    if (mode === 'visual' && next === 'html') {
      if (!(await confirm({ title: 'Switch to HTML code?', message: 'Your visual design will be converted to HTML that you can edit freely. Later changes in HTML will not flow back to the visual builder.', confirmText: 'Convert to HTML' }))) return;
      onChange({ editor_mode: 'html', html: renderDesign(value.design || defaultDesign(), { companyAddress }) });
      return;
    }
    if (next === 'visual') {
      const hasHtml = mode === 'html' && value.html?.trim();
      if (hasHtml && !(await confirm({ title: 'Switch to the visual builder?', message: value.design ? 'You will return to your last visual design. Edits made in HTML code will be replaced.' : 'The visual builder starts from a new layout. Your current HTML will be replaced.', confirmText: 'Switch', danger: true }))) return;
      const d = value.design || defaultDesign();
      onChange({ editor_mode: 'visual', design: d, html: renderDesign(d, { companyAddress }) });
      return;
    }
    if (next === 'text') {
      if ((value.html?.trim() || value.design) && !(await confirm({ title: 'Switch to plain text?', message: 'Plain text emails are sent as simple formatted text. Your HTML design is kept and you can switch back.', confirmText: 'Switch' }))) return;
      onChange({ editor_mode: 'text' });
      return;
    }
    onChange({ editor_mode: next });
  };

  const insertVariable = (v) => {
    if (mode === 'html' && cmRef.current) {
      const view = cmRef.current;
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: v }, selection: { anchor: from + v.length } });
      view.focus();
    } else if (mode === 'text' && textRef.current) {
      const el = textRef.current;
      const s = el.selectionStart ?? el.value.length;
      const next = el.value.slice(0, s) + v + el.value.slice(el.selectionEnd ?? s);
      onChange({ text_body: next });
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + v.length, s + v.length); });
    } else if (mode === 'visual') {
      visualInsertRef.current?.(v);
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
          {[
            { m: 'visual', label: 'Visual builder', icon: LayoutGrid },
            { m: 'html', label: 'HTML code', icon: Code2 },
            { m: 'text', label: 'Plain text', icon: Type },
          ].map((x) => (
            <button key={x.m} onClick={() => switchMode(x.m)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 ${mode === x.m ? 'bg-navy-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              <x.icon size={14} /> <span className="hidden sm:inline">{x.label}</span>
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
          <button onClick={() => setView('edit')} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 ${view === 'edit' ? 'bg-navy-100 text-navy-800' : 'text-slate-600'}`}><PenLine size={14} /> Edit</button>
          <button onClick={() => setView('preview')} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 ${view === 'preview' ? 'bg-navy-100 text-navy-800' : 'text-slate-600'}`}><Eye size={14} /> Preview</button>
        </div>
        <VariableMenu onPick={insertVariable} disabled={view === 'preview'} />
        <div className="ml-auto flex items-center gap-2">
          <SampleContactPicker value={contactId} onChange={setContactId} />
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
            <button title="Desktop" onClick={() => setDevice('desktop')} className={`rounded-md px-2 py-1 ${device === 'desktop' ? 'bg-navy-100 text-navy-800' : 'text-slate-500'}`}><Monitor size={15} /></button>
            <button title="Mobile" onClick={() => setDevice('mobile')} className={`rounded-md px-2 py-1 ${device === 'mobile' ? 'bg-navy-100 text-navy-800' : 'text-slate-500'}`}><Smartphone size={15} /></button>
          </div>
        </div>
      </div>

      {view === 'preview' ? (
        <div className="bg-slate-100 p-4">
          <EmailPreview html={value.html} editorMode={mode} textBody={value.text_body} preheader={preheader} subject={subject} device={device} height={720} contactId={contactId} />
        </div>
      ) : mode === 'visual' ? (
        <VisualBuilder design={value.design || defaultDesign()} companyAddress={companyAddress} insertRef={visualInsertRef}
          onChange={(design) => onChange({ design, html: renderDesign(design, { companyAddress }) })} />
      ) : mode === 'html' ? (
        <div className="grid grid-cols-1 xl:grid-cols-2">
          <div className="h-[640px] border-b border-slate-200 xl:border-b-0 xl:border-r">
            <CodeMirror
              value={value.html || ''}
              height="640px"
              extensions={[htmlLang(), EditorView.lineWrapping]}
              onChange={(v) => onChange({ html: v })}
              onCreateEditor={(v) => (cmRef.current = v)}
              placeholder="Paste or write your HTML email here…"
              basicSetup={{ foldGutter: true, highlightActiveLine: true }}
            />
          </div>
          <div className="bg-slate-100 p-3">
            <EmailPreview html={value.html} editorMode="html" preheader={preheader} subject={subject} device={device} height={560} contactId={contactId} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2">
          <div className="p-3">
            <textarea ref={textRef} className="input h-[600px] font-mono text-[13px] leading-relaxed" value={value.text_body || ''} onChange={(e) => onChange({ text_body: e.target.value })}
              placeholder={'Hello {{first_name}},\n\nWe are pleased to introduce our latest Azerbaijan travel packages.\n\nBest regards,\nAristokrat Travel Azerbaijan'} />
            <p className="mt-2 text-xs text-slate-500">Blank lines start new paragraphs. A footer with your address and unsubscribe link is added automatically.</p>
          </div>
          <div className="bg-slate-100 p-3">
            <EmailPreview editorMode="text" textBody={value.text_body} preheader={preheader} subject={subject} device={device} height={560} contactId={contactId} />
          </div>
        </div>
      )}
    </div>
  );
}

function VariableMenu({ onPick, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button disabled={disabled} className="btn-secondary btn-sm" onClick={() => setOpen((o) => !o)}><Braces size={14} /> Insert variable</button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {VARIABLES.map((x) => (
            <button key={x.v} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-navy-50" onClick={() => { onPick(x.v); setOpen(false); }}>
              <span>{x.label}</span><code className="text-xs text-slate-400">{x.v}</code>
            </button>
          ))}
          <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">Missing values use the fallbacks from Settings. Custom fallback: {'{{first_name|Friend}}'}</div>
        </div>
      )}
    </div>
  );
}

// ---------------- Visual builder ----------------
function VisualBuilder({ design, onChange, insertRef, companyAddress = '' }) {
  const addr = (h) => h.replace(/\{\{\s*company_address\s*\}\}/g, (companyAddress || 'Add your postal address in Settings').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'));
  const [selected, setSelected] = useState(design.blocks[0]?.id || null);
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const s = { ...defaultDesign().settings, ...design.settings };
  const blocks = design.blocks;
  const sel = blocks.find((b) => b.id === selected);

  const setBlocks = (next) => onChange({ ...design, blocks: next });
  const update = (id, patch) => setBlocks(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const add = (type, at) => {
    const b = newBlock(type);
    const idx = at ?? (sel ? blocks.findIndex((x) => x.id === sel.id) + 1 : blocks.length);
    const next = [...blocks];
    next.splice(idx, 0, b);
    setBlocks(next);
    setSelected(b.id);
  };
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
  };
  const dup = (i) => {
    const next = [...blocks];
    const copy = { ...structuredClone(blocks[i]), id: Math.random().toString(36).slice(2, 9) };
    next.splice(i + 1, 0, copy);
    setBlocks(next);
    setSelected(copy.id);
  };
  const remove = (i) => {
    const next = blocks.filter((_, k) => k !== i);
    setBlocks(next);
    setSelected(next[Math.min(i, next.length - 1)]?.id || null);
  };
  const drop = (i) => {
    const data = window.__emailDrag;
    window.__emailDrag = null;
    setOverIdx(null);
    if (data?.newType) return add(data.newType, i);
    if (dragIdx === null || dragIdx === i) return;
    const next = [...blocks];
    const [b] = next.splice(dragIdx, 1);
    next.splice(i > dragIdx ? i - 1 : i, 0, b);
    setBlocks(next);
    setDragIdx(null);
  };

  insertRef.current = (v) => {
    if (!sel) return;
    const field = { heading: 'text', text: 'text', button: 'text', footer: 'text' }[sel.type];
    if (field) update(sel.id, { [field]: `${sel[field] || ''}${v}` });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[150px_1fr_300px]">
      <div className="border-b border-slate-200 p-3 lg:border-b-0 lg:border-r">
        <div className="label">Add block</div>
        <div className="grid grid-cols-3 gap-1.5 lg:grid-cols-1">
          {BLOCK_TYPES.map((t) => {
            const I = ICONS[t.type];
            return (
              <button key={t.type} draggable onDragStart={() => (window.__emailDrag = { newType: t.type })} onClick={() => add(t.type)}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left text-xs font-medium text-slate-700 hover:border-navy-300 hover:bg-navy-50">
                <I size={15} className="text-navy-600" /> {t.label}
              </button>
            );
          })}
        </div>
        <p className="mt-3 hidden text-[11px] leading-snug text-slate-400 lg:block">Click to add below the selected block, or drag onto the canvas.</p>
      </div>

      <div className="max-h-[760px] overflow-y-auto p-4" style={{ background: s.bgColor }}>
        <div className="mx-auto rounded-lg shadow-sm" style={{ maxWidth: s.width, background: s.contentBg }}>
          {blocks.length === 0 && (
            <div onDragOver={(e) => e.preventDefault()} onDrop={() => drop(0)} className="p-10 text-center text-sm text-slate-400">Drag blocks here or click a block on the left.</div>
          )}
          {blocks.map((b, i) => (
            <div key={b.id}
              draggable
              onDragStart={() => { setDragIdx(i); window.__emailDrag = null; }}
              onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }}
              onDragLeave={() => setOverIdx(null)}
              onDrop={() => drop(i)}
              onClick={() => setSelected(b.id)}
              className={`group relative cursor-pointer ${selected === b.id ? 'outline outline-2 outline-sky-500' : 'hover:outline hover:outline-1 hover:outline-sky-300'} ${overIdx === i ? 'border-t-4 border-sky-400' : ''}`}>
              <table width="100%" cellPadding="0" cellSpacing="0" style={{ borderCollapse: 'collapse' }}>
                <tbody dangerouslySetInnerHTML={{ __html: addr(renderBlock(b, s)) || `<tr><td style="padding:24px;text-align:center;color:#94a3b8;font:13px Arial;border:2px dashed #cbd5e1;">${b.type === 'image' ? 'Image — add an image URL or upload in the panel →' : 'Empty block'}</td></tr>` }} />
              </table>
              <div className={`absolute right-1 top-1 z-10 gap-0.5 rounded-md bg-white/95 p-0.5 shadow ${selected === b.id ? 'flex' : 'hidden group-hover:flex'}`}>
                <span className="cursor-grab px-1 py-1 text-slate-400" title="Drag to reorder"><GripVertical size={14} /></span>
                <button className="rounded px-1 py-1 hover:bg-slate-100" title="Move up" onClick={(e) => { e.stopPropagation(); move(i, -1); }}><ChevronUp size={14} /></button>
                <button className="rounded px-1 py-1 hover:bg-slate-100" title="Move down" onClick={(e) => { e.stopPropagation(); move(i, 1); }}><ChevronDown size={14} /></button>
                <button className="rounded px-1 py-1 hover:bg-slate-100" title="Duplicate" onClick={(e) => { e.stopPropagation(); dup(i); }}><Copy size={14} /></button>
                <button className="rounded px-1 py-1 text-red-600 hover:bg-red-50" title="Delete" onClick={(e) => { e.stopPropagation(); remove(i); }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          {blocks.length > 0 && <div onDragOver={(e) => { e.preventDefault(); setOverIdx(blocks.length); }} onDrop={() => drop(blocks.length)} className={`h-6 ${overIdx === blocks.length ? 'border-t-4 border-sky-400' : ''}`} />}
        </div>
      </div>

      <div className="max-h-[760px] overflow-y-auto border-t border-slate-200 p-4 lg:border-l lg:border-t-0">
        {sel ? <BlockProps block={sel} onChange={(p) => update(sel.id, p)} /> : <div className="text-sm text-slate-400">Select a block to edit it.</div>}
        <details className="mt-5 border-t border-slate-200 pt-4">
          <summary className="cursor-pointer text-sm font-semibold text-navy-900">Email background & width</summary>
          <div className="mt-3 space-y-3">
            <ColorField label="Page background" value={s.bgColor} onChange={(v) => onChange({ ...design, settings: { ...s, bgColor: v } })} />
            <ColorField label="Content background" value={s.contentBg} onChange={(v) => onChange({ ...design, settings: { ...s, contentBg: v } })} />
            <ColorField label="Link colour" value={s.linkColor} onChange={(v) => onChange({ ...design, settings: { ...s, linkColor: v } })} />
            <NumField label="Content width (px)" value={s.width} min={480} max={800} onChange={(v) => onChange({ ...design, settings: { ...s, width: v } })} />
            <div>
              <span className="label">Font</span>
              <select className="input" value={s.font} onChange={(e) => onChange({ ...design, settings: { ...s, font: e.target.value } })}>
                <option value="Arial, Helvetica, sans-serif">Arial</option>
                <option value="Helvetica, Arial, sans-serif">Helvetica</option>
                <option value="Verdana, Geneva, sans-serif">Verdana</option>
                <option value="Tahoma, Geneva, sans-serif">Tahoma</option>
                <option value="Georgia, 'Times New Roman', serif">Georgia</option>
                <option value="'Trebuchet MS', Helvetica, sans-serif">Trebuchet</option>
              </select>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex gap-2">
        <input type="color" className="h-9 w-10 cursor-pointer rounded border border-slate-300" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} />
        <input className="input" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="none" />
      </div>
    </div>
  );
}
function NumField({ label, value, onChange, min = 0, max = 999 }) {
  return (
    <div>
      <span className="label">{label}</span>
      <input type="number" className="input" min={min} max={max} value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
function TextField({ label, value, onChange, multiline, placeholder, hint }) {
  return (
    <div>
      <span className="label">{label}</span>
      {multiline ? <textarea className="input min-h-[140px] text-sm" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        : <input className="input" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </div>
  );
}
function AlignField({ value, onChange }) {
  return (
    <div>
      <span className="label">Alignment</span>
      <div className="inline-flex rounded-lg border border-slate-300 p-0.5 text-xs">
        {['left', 'center', 'right'].map((a) => <button key={a} onClick={() => onChange(a)} className={`rounded-md px-3 py-1 capitalize ${value === a ? 'bg-navy-800 text-white' : 'text-slate-600'}`}>{a}</button>)}
      </div>
    </div>
  );
}

function ImageUrlField({ label, value, onChange }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const upload = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error('Image must be under 5 MB.');
    setBusy(true);
    try {
      const data = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const out = await post('/media', { data, mime: file.type, file_name: file.name });
      onChange(out.url);
      toast.success('Image uploaded.');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <span className="label">{label}</span>
      <input className="input" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="https://…/image.jpg" />
      <label className="btn-secondary btn-sm mt-1.5 cursor-pointer">
        {busy ? <Spinner size={13} /> : <Upload size={13} />} Upload image
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => upload(e.target.files[0])} />
      </label>
    </div>
  );
}

function BlockProps({ block: b, onChange }) {
  const title = BLOCK_TYPES.find((t) => t.type === b.type)?.label;
  const fmtHint = 'Formatting: **bold**, *italic*, [link text](https://…). Blank line = new paragraph.';
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-navy-900">{title}</div>
      {b.type === 'logo' && (<>
        <ImageUrlField label="Logo image" value={b.src} onChange={(v) => onChange({ src: v })} />
        <TextField label="Alt text / name" value={b.alt} onChange={(v) => onChange({ alt: v })} />
        <NumField label="Width (px)" value={b.width} onChange={(v) => onChange({ width: v })} />
        <TextField label="Link" value={b.link} onChange={(v) => onChange({ link: v })} />
        <AlignField value={b.align} onChange={(v) => onChange({ align: v })} />
      </>)}
      {b.type === 'heading' && (<>
        <TextField label="Text" value={b.text} onChange={(v) => onChange({ text: v })} multiline />
        <NumField label="Font size" value={b.size} onChange={(v) => onChange({ size: v })} />
        <ColorField label="Colour" value={b.color} onChange={(v) => onChange({ color: v })} />
        <AlignField value={b.align} onChange={(v) => onChange({ align: v })} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!b.bold} onChange={(e) => onChange({ bold: e.target.checked })} /> Bold</label>
      </>)}
      {b.type === 'text' && (<>
        <TextField label="Text" value={b.text} onChange={(v) => onChange({ text: v })} multiline hint={fmtHint} />
        <NumField label="Font size" value={b.size} onChange={(v) => onChange({ size: v })} />
        <ColorField label="Colour" value={b.color} onChange={(v) => onChange({ color: v })} />
        <AlignField value={b.align} onChange={(v) => onChange({ align: v })} />
      </>)}
      {b.type === 'image' && (<>
        <ImageUrlField label="Image" value={b.src} onChange={(v) => onChange({ src: v })} />
        <TextField label="Alt text" value={b.alt} onChange={(v) => onChange({ alt: v })} />
        <NumField label="Width (%)" value={b.width} min={10} max={100} onChange={(v) => onChange({ width: v })} />
        <TextField label="Link (optional)" value={b.link} onChange={(v) => onChange({ link: v })} />
        <NumField label="Corner radius" value={b.radius} onChange={(v) => onChange({ radius: v })} />
        <AlignField value={b.align} onChange={(v) => onChange({ align: v })} />
      </>)}
      {b.type === 'button' && (<>
        <TextField label="Button text" value={b.text} onChange={(v) => onChange({ text: v })} />
        <TextField label="Link" value={b.url} onChange={(v) => onChange({ url: v })} placeholder="https://" />
        <ColorField label="Button colour" value={b.bgColor} onChange={(v) => onChange({ bgColor: v })} />
        <ColorField label="Text colour" value={b.color} onChange={(v) => onChange({ color: v })} />
        <NumField label="Corner radius" value={b.radius} onChange={(v) => onChange({ radius: v })} />
        <AlignField value={b.align} onChange={(v) => onChange({ align: v })} />
      </>)}
      {b.type === 'divider' && (<>
        <ColorField label="Line colour" value={b.color} onChange={(v) => onChange({ color: v })} />
        <NumField label="Thickness" value={b.thickness} onChange={(v) => onChange({ thickness: v })} />
      </>)}
      {b.type === 'spacer' && <NumField label="Height (px)" value={b.height} onChange={(v) => onChange({ height: v })} />}
      {b.type === 'social' && (<>
        <span className="label">Links</span>
        {(b.links || []).map((l, i) => (
          <div key={i} className="flex gap-1">
            <input className="input w-28" value={l.network} onChange={(e) => onChange({ links: b.links.map((x, k) => (k === i ? { ...x, network: e.target.value } : x)) })} />
            <input className="input" value={l.url} onChange={(e) => onChange({ links: b.links.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)) })} />
            <button className="btn-ghost btn-sm text-red-600" onClick={() => onChange({ links: b.links.filter((_, k) => k !== i) })}><Trash2 size={13} /></button>
          </div>
        ))}
        <button className="btn-secondary btn-sm" onClick={() => onChange({ links: [...(b.links || []), { network: 'Website', url: 'https://' }] })}><Plus size={13} /> Add link</button>
        <ColorField label="Colour" value={b.color} onChange={(v) => onChange({ color: v })} />
        <AlignField value={b.align} onChange={(v) => onChange({ align: v })} />
      </>)}
      {b.type === 'footer' && (<>
        <TextField label="Footer text" value={b.text} onChange={(v) => onChange({ text: v })} multiline hint="{{company_address}} inserts the address from Settings. An unsubscribe link is always added below." />
        <ColorField label="Text colour" value={b.color} onChange={(v) => onChange({ color: v })} />
        <AlignField value={b.align} onChange={(v) => onChange({ align: v })} />
      </>)}
      {b.type !== 'spacer' && (<>
        <ColorField label="Block background" value={b.bg} onChange={(v) => onChange({ bg: v })} />
        <NumField label="Padding (px)" value={b.padding} onChange={(v) => onChange({ padding: v })} />
      </>)}
    </div>
  );
}
