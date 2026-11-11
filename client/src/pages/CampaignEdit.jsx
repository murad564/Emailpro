import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import {
  Save, Send, ArrowLeft, ArrowRight, Users, Filter, Globe2, UserCheck, Shuffle, Clock, FlaskConical, CheckCircle2, AlertTriangle, LayoutTemplate,
  Pause, Play, XCircle, BarChart3, Search,
} from 'lucide-react';
import { get, post, put, fmt, qs } from '../api.js';
import EmailEditor, { EmailPreview } from '../components/EmailEditor.jsx';
import FilterBar, { EMPTY_FILTERS, filterParams } from '../components/FilterBar.jsx';
import { renderDesign, defaultDesign } from '../components/blocks.js';
import { Badge, Field, Loading, Modal, Spinner, useConfirm, useToast } from '../ui.jsx';

const LIMIT_PRESETS = [100, 200, 300, 500, 1000];

function blankCampaign(sender, sp) {
  const audience = sp.get('segment_id')
    ? { type: 'segment', segment_id: Number(sp.get('segment_id')) }
    : sp.get('country_ids') || sp.get('city_ids')
      ? { type: 'filters', filters: { ...EMPTY_FILTERS, country_ids: (sp.get('country_ids') || '').split(',').filter(Boolean).map(Number), city_ids: (sp.get('city_ids') || '').split(',').filter(Boolean).map(Number) } }
      : sp.get('contact_ids')
        ? { type: 'contacts', contact_ids: sp.get('contact_ids').split(',').map(Number) }
        : { type: 'all' };
  return {
    name: '', subject: '', preheader: '', sender_name: sender.sender_name || '', sender_email: sender.sender_email || '', reply_to: sender.reply_to || '',
    editor_mode: 'visual', html: '', text_body: '', design: null, template_id: null, audience, send_limit: null, randomize: false,
    batch_size: null, batch_interval_minutes: 60, status: 'draft',
  };
}

export default function CampaignEdit() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [c, setC] = useState(null);
  const [settings, setSettings] = useState(null);
  const [step, setStep] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const isNew = id === 'new';

  useEffect(() => {
    (async () => {
      try {
        const s = await get('/settings');
        setSettings(s);
        if (isNew) {
          const base = blankCampaign(s.sender, sp);
          const tid = sp.get('template_id');
          if (tid) {
            const t = await get(`/templates/${tid}`);
            Object.assign(base, { name: t.name, subject: t.subject, preheader: t.preheader, editor_mode: t.editor_mode, html: t.html, text_body: t.text_body, design: t.design, template_id: t.id });
          }
          if (base.editor_mode === 'visual' && !base.design) {
            base.design = defaultDesign();
            base.html = renderDesign(base.design, { companyAddress: s.general.company_address });
          }
          setC(base);
        } else {
          setC(await get(`/campaigns/${id}`));
        }
      } catch (e) {
        toast.error(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const patch = useCallback((p) => {
    setC((x) => ({ ...x, ...p }));
    setDirty(true);
  }, []);

  const save = async ({ quiet = false } = {}) => {
    setSaving(true);
    try {
      const body = { ...c };
      if (body.editor_mode === 'visual' && body.design) body.html = renderDesign(body.design, { companyAddress: settings?.general?.company_address });
      if (isNew || !c.id) {
        const r = await post('/campaigns', body);
        setDirty(false);
        if (!quiet) toast.success('Draft saved.');
        navigate(`/campaigns/${r.id}`, { replace: true });
        return r.id;
      }
      await put(`/campaigns/${c.id}`, body);
      setDirty(false);
      if (!quiet) toast.success('Campaign saved.');
      return c.id;
    } catch (e) {
      toast.error(e);
      return null;
    } finally {
      setSaving(false);
    }
  };

  if (!c || !settings) return <Loading />;
  const locked = ['sending', 'scheduled', 'paused'].includes(c.status) || c.status === 'cancelled';
  if (locked) return <LockedCampaign c={c} reload={async () => setC(await get(`/campaigns/${c.id}`))} />;

  const steps = ['Details', 'Content', 'Audience & limit', 'Review & send'];
  const goto = async (n) => {
    if (dirty && c.id) await save({ quiet: true });
    setStep(n);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button className="btn-ghost btn-sm" onClick={() => navigate('/campaigns')}><ArrowLeft size={16} /> Campaigns</button>
        <h1 className="text-xl font-semibold text-navy-900">{c.name || 'New campaign'}</h1>
        <Badge value={c.status} />
        <div className="ml-auto flex gap-2">
          <button className="btn-secondary" onClick={() => setTemplateOpen(true)}><LayoutTemplate size={16} /> Use template</button>
          <button className="btn-secondary" onClick={() => save()} disabled={saving}>{saving ? <Spinner size={14} /> : <Save size={16} />} Save draft</button>
        </div>
      </div>
      {['sent', 'partially_sent', 'failed'].includes(c.status) && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          This campaign was already sent. You can send it to <b>more</b> recipients: anyone who already received it is excluded automatically. <Link className="underline" to={`/reports/${c.id}`}>View report</Link>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((s, i) => (
          <button key={s} onClick={() => goto(i)} className={`rounded-lg border px-3 py-2 text-left text-sm transition ${i === step ? 'border-navy-700 bg-navy-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-navy-300'}`}>
            <div className="text-[11px] opacity-70">Step {i + 1}</div>
            <div className="font-medium">{s}</div>
          </button>
        ))}
      </div>

      {step === 0 && <DetailsStep c={c} patch={patch} />}
      {step === 1 && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Subject"><input className="input" value={c.subject} onChange={(e) => patch({ subject: e.target.value })} /></Field>
            <Field label="Preheader"><input className="input" value={c.preheader} onChange={(e) => patch({ preheader: e.target.value })} /></Field>
          </div>
          <EmailEditor value={c} onChange={patch} subject={c.subject} preheader={c.preheader} companyAddress={settings.general.company_address} />
        </div>
      )}
      {step === 2 && <AudienceStep c={c} patch={patch} />}
      {step === 3 && <ReviewStep c={c} settings={settings} save={save} dirty={dirty} />}

      <div className="mt-5 flex justify-between">
        <button className="btn-secondary" disabled={step === 0} onClick={() => goto(step - 1)}><ArrowLeft size={16} /> Back</button>
        {step < 3 && (
          <button className="btn-primary" onClick={async () => {
            if (!c.id) {
              const newId = await save({ quiet: true });
              if (!newId) return;
            }
            goto(step + 1);
          }}>Next: {steps[step + 1]} <ArrowRight size={16} /></button>
        )}
      </div>
      {templateOpen && <TemplatePicker onClose={() => setTemplateOpen(false)} onPick={async (t) => {
        if ((c.html || c.text_body) && !(await confirm({ title: 'Replace content?', message: `Load "${t.name}"? Your current email content will be replaced.`, confirmText: 'Load template' }))) return;
        const full = await get(`/templates/${t.id}`);
        patch({ subject: c.subject || full.subject, preheader: c.preheader || full.preheader, editor_mode: full.editor_mode, html: full.html, text_body: full.text_body, design: full.design, template_id: full.id, name: c.name || full.name });
        setTemplateOpen(false);
        setStep(1);
      }} />}
    </div>
  );
}

function DetailsStep({ c, patch }) {
  const [senders, setSenders] = useState(null);
  useEffect(() => {
    get('/brevo/senders').then((r) => setSenders(r.senders)).catch(() => setSenders([]));
  }, []);
  const verified = senders?.find((s) => s.email.toLowerCase() === (c.sender_email || '').toLowerCase());
  return (
    <div className="card grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
      <Field label="Campaign name" hint="Internal name, recipients don't see it" className="md:col-span-2"><input className="input" autoFocus value={c.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. UAE agencies – November offers" /></Field>
      <Field label="Email subject" hint="You can use {{first_name}}, {{company_name}}…"><input className="input" value={c.subject} onChange={(e) => patch({ subject: e.target.value })} /></Field>
      <Field label="Preheader text" hint="Short preview shown after the subject in the inbox"><input className="input" value={c.preheader} onChange={(e) => patch({ preheader: e.target.value })} /></Field>
      <Field label="Sender name"><input className="input" value={c.sender_name} onChange={(e) => patch({ sender_name: e.target.value })} /></Field>
      <div>
        <span className="label">Sender email</span>
        {senders?.length ? (
          <select className="input" value={c.sender_email} onChange={(e) => {
            const s = senders.find((x) => x.email === e.target.value);
            patch({ sender_email: e.target.value, sender_name: c.sender_name || s?.name || '' });
          }}>
            <option value="">— Choose a verified Brevo sender —</option>
            {senders.map((s) => <option key={s.id} value={s.email} disabled={!s.active}>{s.name} &lt;{s.email}&gt;{s.active ? '' : ' (inactive)'}</option>)}
            {c.sender_email && !verified && <option value={c.sender_email}>{c.sender_email} (not verified in Brevo)</option>}
          </select>
        ) : (
          <input className="input" type="email" value={c.sender_email} onChange={(e) => patch({ sender_email: e.target.value })} />
        )}
        <span className="mt-1 block text-xs text-slate-400">
          {senders === null ? 'Loading Brevo senders…' : senders.length ? 'Only senders verified in your Brevo account can send.' : 'Connect Brevo to choose from your verified senders.'}
        </span>
      </div>
      <Field label="Reply-to email" hint="Where replies go (optional)"><input className="input" type="email" value={c.reply_to} onChange={(e) => patch({ reply_to: e.target.value })} /></Field>
    </div>
  );
}

function AudienceStep({ c, patch }) {
  const a = c.audience || { type: 'all' };
  const [segments, setSegments] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [preview, setPreview] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customLimit, setCustomLimit] = useState(c.send_limit && !LIMIT_PRESETS.includes(c.send_limit) ? String(c.send_limit) : '');
  useEffect(() => {
    get('/segments').then((r) => setSegments(r.rows)).catch(() => {});
    get('/campaigns?status=sent,partially_sent,sending').then((r) => setCampaigns(r.rows.filter((x) => x.id !== c.id))).catch(() => {});
  }, [c.id]);
  const setA = (p) => patch({ audience: { ...a, ...p } });
  const key = JSON.stringify([a, c.send_limit]);
  useEffect(() => {
    setPreview(null);
    const t = setTimeout(() => post('/campaigns/preview-audience', { id: c.id, audience: a, send_limit: c.send_limit }).then(setPreview).catch((e) => setPreview({ error: e.message })), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const types = [
    { t: 'all', label: 'All subscribed contacts', icon: Users },
    { t: 'filters', label: 'Country / city / category', icon: Globe2 },
    { t: 'segment', label: 'Saved segment', icon: Filter },
    { t: 'contacts', label: 'Selected contacts', icon: UserCheck },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <div className="card p-5">
          <div className="mb-3 text-sm font-semibold text-navy-900">Who should receive this campaign?</div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {types.map((x) => (
              <button key={x.t} onClick={() => setA({ type: x.t })} className={`flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left text-sm transition ${a.type === x.t ? 'border-navy-700 bg-navy-50 text-navy-900 ring-1 ring-navy-700' : 'border-slate-200 hover:border-navy-300'}`}>
                <x.icon size={18} className="text-navy-600" /> <span className="font-medium">{x.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-4">
            {a.type === 'filters' && <FilterBar value={{ ...EMPTY_FILTERS, ...(a.filters || {}) }} onChange={(f) => setA({ filters: filterParams(f) })} showStatus={false} />}
            {a.type === 'segment' && (
              <select className="input" value={a.segment_id || ''} onChange={(e) => setA({ segment_id: Number(e.target.value) || null })}>
                <option value="">— Choose a segment —</option>
                {segments.map((s) => <option key={s.id} value={s.id}>{s.name} ({fmt.n(s.subscribed)} subscribed)</option>)}
              </select>
            )}
            {a.type === 'contacts' && (
              <div className="flex items-center gap-3">
                <button className="btn-secondary" onClick={() => setPickerOpen(true)}><UserCheck size={16} /> Choose contacts</button>
                <span className="text-sm text-slate-600">{fmt.n((a.contact_ids || []).length)} selected</span>
              </div>
            )}
            {a.type === 'all' && <p className="text-sm text-slate-500">Every subscribed contact in your database.</p>}
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-1 text-sm font-semibold text-navy-900">Sending limit</div>
          <p className="mb-3 text-sm text-slate-500">Send to a limited number of recipients from this audience. Run the campaign again later to reach the next group: people who already received it are always skipped.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => { patch({ send_limit: null }); setCustomLimit(''); }} className={`rounded-lg border px-3 py-1.5 text-sm ${!c.send_limit ? 'border-navy-700 bg-navy-800 text-white' : 'border-slate-300 bg-white'}`}>No limit</button>
            {LIMIT_PRESETS.map((n) => (
              <button key={n} onClick={() => { patch({ send_limit: n }); setCustomLimit(''); }} className={`rounded-lg border px-3 py-1.5 text-sm ${c.send_limit === n && !customLimit ? 'border-navy-700 bg-navy-800 text-white' : 'border-slate-300 bg-white'}`}>{fmt.n(n)}</button>
            ))}
            <input className="input w-36" type="number" min={1} placeholder="Custom…" value={customLimit}
              onChange={(e) => { setCustomLimit(e.target.value); patch({ send_limit: e.target.value ? Number(e.target.value) : null }); }} />
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.randomize} onChange={(e) => patch({ randomize: e.target.checked })} /> <Shuffle size={15} className="text-slate-400" /> Pick recipients randomly (otherwise oldest contacts first)</label>
        </div>

        <details className="card p-5">
          <summary className="cursor-pointer text-sm font-semibold text-navy-900">Advanced: batches & exclusions</summary>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Batch size (optional)" hint="Split large sends into batches. Leave empty to send all at once."><input className="input" type="number" min={10} value={c.batch_size || ''} onChange={(e) => patch({ batch_size: e.target.value ? Number(e.target.value) : null })} placeholder="e.g. 500" /></Field>
            <Field label="Minutes between batches"><input className="input" type="number" min={5} value={c.batch_interval_minutes || 60} onChange={(e) => patch({ batch_interval_minutes: Number(e.target.value) })} /></Field>
            <div className="md:col-span-2">
              <span className="label">Also exclude people who received these campaigns</span>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {campaigns.length === 0 && <div className="text-sm text-slate-400">No other sent campaigns.</div>}
                {campaigns.map((x) => (
                  <label key={x.id} className="flex items-center gap-2 py-0.5 text-sm">
                    <input type="checkbox" checked={(a.exclude_campaign_ids || []).includes(x.id)} onChange={(e) => setA({ exclude_campaign_ids: e.target.checked ? [...(a.exclude_campaign_ids || []), x.id] : (a.exclude_campaign_ids || []).filter((i) => i !== x.id) })} />
                    {x.name} <span className="text-xs text-slate-400">({fmt.date(x.sent_at)})</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </details>
      </div>

      <AudienceSummary preview={preview} />
      {pickerOpen && <ContactPicker initial={a.contact_ids || []} onClose={() => setPickerOpen(false)} onDone={(ids) => { setA({ contact_ids: ids }); setPickerOpen(false); }} />}
    </div>
  );
}

function AudienceSummary({ preview }) {
  return (
    <div className="card h-fit p-5 xl:sticky xl:top-6">
      <div className="mb-3 text-sm font-semibold text-navy-900">Recipients</div>
      {!preview ? <div className="flex items-center gap-2 text-sm text-slate-400"><Spinner size={14} /> Counting…</div>
        : preview.error ? <div className="text-sm text-red-600">{preview.error}</div> : (
        <>
          <div className="text-xs text-slate-500">{preview.label}</div>
          <div className="mt-3 space-y-1.5 text-sm">
            <Row label="Matching contacts" v={preview.matching} />
            <Row label="Unsubscribed (excluded)" v={preview.unsubscribed} muted />
            <Row label="Bounced (excluded)" v={preview.bounced} muted />
            <Row label="Already received this campaign" v={preview.already_received} muted />
            <Row label="Eligible now" v={preview.eligible} />
            {preview.limit && <Row label="Sending limit" v={preview.limit} />}
          </div>
          <div className="mt-4 rounded-lg bg-navy-800 px-4 py-3 text-white">
            <div className="text-xs opacity-80">Will be sent to</div>
            <div className="text-3xl font-semibold tabular-nums">{fmt.n(preview.will_send)}</div>
            <div className="text-xs opacity-80">recipients</div>
          </div>
        </>
      )}
    </div>
  );
}
const Row = ({ label, v, muted }) => (
  <div className={`flex justify-between ${muted ? 'text-slate-400' : 'text-slate-700'}`}><span>{label}</span><span className="tabular-nums">{fmt.n(v)}</span></div>
);

function ContactPicker({ initial, onClose, onDone }) {
  const [sel, setSel] = useState(new Set(initial));
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, statuses: ['subscribed'] });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], total: 0 });
  useEffect(() => {
    const t = setTimeout(() => get(`/contacts${qs({ ...filterParams(filters), page, pageSize: 50 })}`).then(setData).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [filters, page]);
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = data.rows.length > 0 && data.rows.every((r) => sel.has(r.id));
  return (
    <Modal open onClose={onClose} title="Choose recipients" size="xl"
      footer={<><span className="mr-auto self-center text-sm text-slate-600">{fmt.n(sel.size)} selected</span><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => onDone([...sel])}>Use {fmt.n(sel.size)} contacts</button></>}>
      <FilterBar value={filters} onChange={(f) => { setFilters(f); setPage(1); }} showStatus={false} />
      <div className="mt-3 max-h-[420px] overflow-y-auto rounded-lg border border-slate-200">
        <table className="table">
          <thead><tr><th className="w-8"><input type="checkbox" checked={allOn} onChange={() => setSel((s) => { const n = new Set(s); data.rows.forEach((r) => (allOn ? n.delete(r.id) : n.add(r.id))); return n; })} /></th><th>Name</th><th>Email</th><th>Company</th><th>Country</th><th>City</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} onClick={() => toggle(r.id)} className="cursor-pointer">
                <td><input type="checkbox" readOnly checked={sel.has(r.id)} /></td>
                <td>{r.full_name || '—'}</td><td>{r.email}</td><td>{r.company || '—'}</td><td>{r.country || '—'}</td><td>{r.city || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm text-slate-500">
        <span>{fmt.n(data.total)} matching</span>
        <div className="flex gap-1">
          <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <button className="btn-secondary btn-sm" disabled={page * 50 >= data.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
    </Modal>
  );
}

function ReviewStep({ c, settings, save, dirty }) {
  const [check, setCheck] = useState(null);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testSent, setTestSent] = useState(null);
  const [when, setWhen] = useState('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [device, setDevice] = useState('desktop');
  const toast = useToast();
  const navigate = useNavigate();

  const runCheck = useCallback(async () => {
    if (!c.id) return;
    if (dirty) await save({ quiet: true });
    setCheck(await post(`/campaigns/${c.id}/validate`).catch((e) => ({ problems: [e.message], preview: null })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const sendTest = async () => {
    setTesting(true);
    try {
      const html = c.editor_mode === 'visual' && c.design ? renderDesign(c.design, { companyAddress: settings.general.company_address }) : c.html;
      await post('/campaigns/test', { ...c, html, to: testTo });
      setTestSent(testTo);
      toast.success(`Test email sent to ${testTo} via Brevo.`);
    } catch (e) {
      toast.error(e);
    } finally {
      setTesting(false);
    }
  };

  const send = async () => {
    setSending(true);
    try {
      const r = await post(`/campaigns/${c.id}/send`, { scheduled_at: when === 'later' ? new Date(scheduledAt).toISOString() : null });
      toast.success(r.scheduled_at ? `Scheduled for ${fmt.dt(r.scheduled_at)} — ${fmt.n(r.recipients)} recipients.` : `Sending started to ${fmt.n(r.recipients)} recipients.`);
      navigate(`/reports/${c.id}`);
    } catch (e) {
      toast.error(e);
      setConfirmOpen(false);
      runCheck();
    } finally {
      setSending(false);
    }
  };

  const p = check?.preview;
  const ready = check && check.problems.length === 0 && p?.will_send > 0;
  const minDate = useMemo(() => {
    const d = new Date(Date.now() + 5 * 60_000);
    d.setSeconds(0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }, []);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
      <div className="card bg-slate-100 p-4">
        <div className="mb-3 flex justify-end gap-1">
          <button className={`btn-sm btn ${device === 'desktop' ? 'bg-navy-800 text-white' : 'bg-white'}`} onClick={() => setDevice('desktop')}>Desktop</button>
          <button className={`btn-sm btn ${device === 'mobile' ? 'bg-navy-800 text-white' : 'bg-white'}`} onClick={() => setDevice('mobile')}>Mobile</button>
        </div>
        <EmailPreview html={c.editor_mode === 'visual' && c.design ? renderDesign(c.design, { companyAddress: settings.general.company_address }) : c.html}
          editorMode={c.editor_mode} textBody={c.text_body} preheader={c.preheader} subject={c.subject} device={device} height={680} />
      </div>
      <div className="space-y-4">
        <div className="card p-5">
          <div className="mb-3 text-sm font-semibold text-navy-900">Summary</div>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Subject</dt><dd className="text-right font-medium">{c.subject || '—'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">From</dt><dd className="text-right">{c.sender_name} &lt;{c.sender_email || '—'}&gt;</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Reply-to</dt><dd className="text-right">{c.reply_to || '—'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Audience</dt><dd className="text-right">{p?.label || '…'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Limit</dt><dd className="text-right">{c.send_limit ? fmt.n(c.send_limit) : 'No limit'}{c.randomize ? ' · random' : ''}</dd></div>
            {c.batch_size && <div className="flex justify-between gap-3"><dt className="text-slate-500">Batches</dt><dd className="text-right">{fmt.n(c.batch_size)} every {c.batch_interval_minutes} min</dd></div>}
          </dl>
          <div className="mt-4 rounded-lg bg-navy-50 px-4 py-3">
            <div className="text-xs text-slate-500">Recipients</div>
            <div className="text-2xl font-semibold text-navy-900 tabular-nums">{p ? fmt.n(p.will_send) : '…'}</div>
          </div>
          {check?.problems?.length > 0 && (
            <div className="mt-3 space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              {check.problems.map((x) => <div key={x} className="flex gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> {x}</div>)}
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy-900"><FlaskConical size={16} /> Send a test email</div>
          <div className="flex gap-2">
            <input className="input" type="email" placeholder="you@aristokrat.az" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            <button className="btn-secondary" disabled={!testTo || testing} onClick={sendTest}>{testing ? <Spinner size={14} /> : <Send size={15} />} Test</button>
          </div>
          {testSent && <p className="mt-2 flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 size={14} /> Test sent to {testSent}. Check the inbox (and spam folder).</p>}
        </div>

        <div className="card p-5">
          <div className="mb-3 text-sm font-semibold text-navy-900">When to send</div>
          <label className="mb-2 flex items-center gap-2 text-sm"><input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} /> Send now</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" checked={when === 'later'} onChange={() => setWhen('later')} /> <Clock size={15} className="text-slate-400" /> Schedule for later</label>
          {when === 'later' && <input className="input mt-2" type="datetime-local" min={minDate} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />}
          <button className="btn-primary mt-4 w-full py-2.5" disabled={!ready || (when === 'later' && !scheduledAt)} onClick={() => setConfirmOpen(true)}>
            <Send size={16} /> {when === 'later' ? 'Schedule campaign' : 'Send campaign'}
          </button>
        </div>
      </div>

      <Modal open={confirmOpen} onClose={() => !sending && setConfirmOpen(false)} title="Confirm campaign" size="sm"
        footer={<><button className="btn-secondary" disabled={sending} onClick={() => setConfirmOpen(false)}>Go back</button><button className="btn-primary" disabled={sending} onClick={send}>{sending && <Spinner size={14} />} {when === 'later' ? 'Yes, schedule' : 'Yes, send now'}</button></>}>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-navy-800 p-4 text-center text-white">
            <div className="text-xs opacity-80">You are about to {when === 'later' ? 'schedule' : 'send'}</div>
            <div className="text-lg font-semibold">"{c.subject}"</div>
            <div className="mt-1 text-4xl font-bold tabular-nums">{fmt.n(p?.will_send)}</div>
            <div className="text-xs opacity-80">recipients{when === 'later' && scheduledAt ? ` on ${fmt.dt(scheduledAt)}` : ''}</div>
          </div>
          <p className="text-slate-600">Emails are sent through your Brevo account and cannot be recalled once delivered. Unsubscribed, bounced and suppressed contacts are excluded automatically.</p>
        </div>
      </Modal>
    </div>
  );
}

function TemplatePicker({ onClose, onPick }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    get('/templates').then((r) => setRows(r.rows)).catch(() => setRows([]));
  }, []);
  const list = (rows || []).filter((t) => !q || `${t.name} ${t.category}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal open onClose={onClose} title="Start from a template" size="lg">
      <div className="relative mb-3"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="input pl-9" placeholder="Search templates…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {!rows ? <Loading /> : list.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No templates yet. Create some in Templates.</p> : (
        <div className="grid max-h-[480px] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {list.map((t) => (
            <button key={t.id} onClick={() => onPick(t)} className="rounded-lg border border-slate-200 p-3 text-left hover:border-navy-400 hover:bg-navy-50">
              <div className="font-medium text-navy-900">{t.name}</div>
              <div className="text-xs text-slate-500">{t.category || 'Uncategorised'} · {t.editor_mode}</div>
              <div className="mt-1 truncate text-xs text-slate-400">{t.subject}</div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function LockedCampaign({ c, reload }) {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const act = async (action, msg, opts) => {
    if (opts && !(await confirm(opts))) return;
    try {
      await post(`/campaigns/${c.id}/${action}`);
      toast.success(msg);
      reload();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="mx-auto max-w-2xl">
      <button className="btn-ghost btn-sm mb-4" onClick={() => navigate('/campaigns')}><ArrowLeft size={16} /> Campaigns</button>
      <div className="card p-6">
        <div className="flex items-center gap-3"><h1 className="text-xl font-semibold text-navy-900">{c.name}</h1><Badge value={c.status} /></div>
        <p className="mt-2 text-sm text-slate-600">
          {c.status === 'scheduled' && `Scheduled for ${fmt.dt(c.scheduled_at)}. Pause or cancel it to make changes.`}
          {c.status === 'sending' && 'This campaign is being sent through Brevo.'}
          {c.status === 'paused' && 'Paused. Remaining batches are on hold until you resume.'}
          {c.status === 'cancelled' && 'This campaign was cancelled. Duplicate it from the campaign list to send it again.'}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link className="btn-primary" to={`/reports/${c.id}`}><BarChart3 size={16} /> View progress & report</Link>
          {['sending', 'scheduled'].includes(c.status) && <button className="btn-secondary" onClick={() => act('pause', 'Campaign paused.')}><Pause size={16} /> Pause</button>}
          {c.status === 'paused' && <button className="btn-secondary" onClick={() => act('resume', 'Campaign resumed.')}><Play size={16} /> Resume</button>}
          {['sending', 'scheduled', 'paused'].includes(c.status) && (
            <button className="btn-danger" onClick={() => act('cancel', 'Campaign cancelled.', { title: 'Cancel campaign?', message: 'Recipients who have not been handed to Brevo yet will not receive this email. Emails already sent cannot be recalled.', danger: true, confirmText: 'Cancel campaign' })}><XCircle size={16} /> Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}
