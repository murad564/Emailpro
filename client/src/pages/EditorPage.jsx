import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Save, Send, CopyPlus, FlaskConical } from 'lucide-react';
import { get, post, put } from '../api.js';
import EmailEditor from '../components/EmailEditor.jsx';
import { defaultDesign, renderDesign } from '../components/blocks.js';
import { Field, Loading, Modal, PageHeader, Spinner, useToast } from '../ui.jsx';

export const TEMPLATE_CATEGORIES = ['Travel Packages', 'Hotels', 'B2B', 'MICE', 'Promotions', 'Corporate', 'Newsletter', 'Other'];

export default function EditorPage() {
  const [sp, setSp] = useSearchParams();
  const templateId = sp.get('template');
  const [t, setT] = useState(null);
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const s = await get('/settings');
      setSettings(s);
      if (templateId) {
        setT(await get(`/templates/${templateId}`));
      } else {
        const design = defaultDesign();
        setT({ name: '', category: '', subject: '', preheader: '', editor_mode: 'visual', design, html: renderDesign(design, { companyAddress: s.general.company_address }), text_body: '' });
      }
    })().catch(toast.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  if (!t || !settings) return <Loading />;
  const patch = (p) => setT((x) => ({ ...x, ...p }));

  const save = async (asNew = false) => {
    if (!t.name.trim()) {
      toast.error('Give the template a name first.');
      return null;
    }
    setSaving(true);
    try {
      if (t.id && !asNew) {
        await put(`/templates/${t.id}`, t);
        toast.success('Template saved.');
        return t.id;
      }
      const r = await post('/templates', { ...t, name: asNew && t.id ? `${t.name} (copy)` : t.name });
      toast.success('Template saved to your library.');
      setSp({ template: r.id }, { replace: true });
      return r.id;
    } catch (e) {
      toast.error(e);
      return null;
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Email Editor" subtitle={t.id ? `Editing template: ${t.name}` : 'Design an email and save it as a reusable template.'}
        actions={<>
          <button className="btn-secondary" onClick={() => setTestOpen(true)}><FlaskConical size={16} /> Send test</button>
          {t.id && <button className="btn-secondary" disabled={saving} onClick={() => save(true)}><CopyPlus size={16} /> Save as copy</button>}
          <button className="btn-secondary" disabled={saving} onClick={() => save()}>{saving ? <Spinner size={14} /> : <Save size={16} />} Save template</button>
          <button className="btn-primary" disabled={saving} onClick={async () => { const id = await save(); if (id) navigate(`/campaigns/new?template_id=${id}`); }}><Send size={16} /> Use in campaign</button>
        </>} />
      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Template name"><input className="input" value={t.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Hotel Offers – Winter" /></Field>
        <Field label="Category">
          <input className="input" list="tpl-cats" value={t.category} onChange={(e) => patch({ category: e.target.value })} />
          <datalist id="tpl-cats">{TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Default subject"><input className="input" value={t.subject} onChange={(e) => patch({ subject: e.target.value })} /></Field>
        <Field label="Preheader"><input className="input" value={t.preheader} onChange={(e) => patch({ preheader: e.target.value })} /></Field>
      </div>
      <EmailEditor value={t} onChange={patch} subject={t.subject} preheader={t.preheader} companyAddress={settings.general.company_address} />
      {testOpen && <TestEmailModal content={t} sender={settings.sender} onClose={() => setTestOpen(false)} />}
    </>
  );
}

export function TestEmailModal({ content, sender, onClose }) {
  const [to, setTo] = useState('');
  const [from, setFrom] = useState(sender.sender_email || '');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const send = async () => {
    setBusy(true);
    try {
      await post('/campaigns/test', { ...content, sender_name: sender.sender_name, sender_email: from, reply_to: sender.reply_to, to });
      toast.success(`Test email sent to ${to} via Brevo.`);
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Send a test email" size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!to || !from || busy} onClick={send}>{busy && <Spinner size={14} />} Send test</button></>}>
      <div className="space-y-3">
        <Field label="Send to"><input className="input" type="email" autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@aristokrat.az" /></Field>
        <Field label="From (verified Brevo sender)"><input className="input" type="email" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <p className="text-xs text-slate-500">Variables use your fallback values. The subject is prefixed with [TEST].</p>
      </div>
    </Modal>
  );
}
