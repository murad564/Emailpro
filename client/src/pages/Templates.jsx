import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, LayoutTemplate, Pencil, Copy, Trash2, Eye, Send, Sparkles, Search } from 'lucide-react';
import { get, post, del, fmt } from '../api.js';
import { EmailPreview } from '../components/EmailEditor.jsx';
import { STARTER_TEMPLATES, renderDesign } from '../components/blocks.js';
import { Empty, ErrorBox, Loading, Modal, PageHeader, Spinner, useConfirm, useToast } from '../ui.jsx';

function Thumb({ html }) {
  return (
    <div className="relative h-48 overflow-hidden rounded-t-xl border-b border-slate-200 bg-slate-100">
      <iframe title="thumbnail" sandbox="" srcDoc={html} className="pointer-events-none absolute left-0 top-0 origin-top-left bg-white" style={{ width: 700, height: 900, transform: 'scale(0.42)' }} tabIndex={-1} />
    </div>
  );
}

export default function Templates() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [q, setQ] = useState('');
  const [seeding, setSeeding] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const load = useCallback(() => get('/templates').then((r) => { setRows(r.rows); setError(null); }).catch(setError), []);
  useEffect(() => {
    load();
  }, [load]);

  const seed = async () => {
    setSeeding(true);
    try {
      const s = await get('/settings');
      const existing = new Set((rows || []).map((t) => t.name));
      let n = 0;
      for (const t of STARTER_TEMPLATES) {
        if (existing.has(t.name)) continue;
        await post('/templates', { ...t, editor_mode: 'visual', html: renderDesign(t.design, { companyAddress: s.general.company_address }) });
        n++;
      }
      toast.success(n ? `Added ${n} starter templates. Edit them to add your logo and images.` : 'Starter templates are already in your library.');
      load();
    } catch (e) {
      toast.error(e);
    } finally {
      setSeeding(false);
    }
  };
  const act = async (fn, msg) => {
    try {
      await fn();
      toast.success(msg);
      load();
    } catch (e) {
      toast.error(e);
    }
  };
  const list = (rows || []).filter((t) => !q || `${t.name} ${t.category} ${t.subject}`.toLowerCase().includes(q.toLowerCase()));
  const categories = [...new Set(list.map((t) => t.category || 'Uncategorised'))].sort();

  return (
    <>
      <PageHeader title="Templates" subtitle="Reusable email designs for packages, hotel offers, B2B, MICE and promotions."
        actions={<>
          <button className="btn-secondary" disabled={seeding} onClick={seed}>{seeding ? <Spinner size={14} /> : <Sparkles size={16} />} Add starter templates</button>
          <button className="btn-primary" onClick={() => navigate('/editor')}><Plus size={16} /> New template</button>
        </>} />
      <ErrorBox error={error} onRetry={load} />
      {!rows ? <Loading /> : rows.length === 0 ? (
        <div className="card"><Empty icon={LayoutTemplate} title="Your template library is empty"
          text="Start with 8 ready-made Aristokrat designs (Azerbaijan Travel Packages, Hotel Offers, B2B Partnerships, MICE, Seasonal, New Year, Summer, Corporate) or build your own."
          action={<div className="flex gap-2"><button className="btn-primary" disabled={seeding} onClick={seed}>{seeding ? <Spinner size={14} /> : <Sparkles size={16} />} Add starter templates</button><button className="btn-secondary" onClick={() => navigate('/editor')}>Start from scratch</button></div>} /></div>
      ) : (
        <>
          <div className="relative mb-4 max-w-sm"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="input pl-9" placeholder="Search templates…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {categories.map((cat) => (
            <div key={cat} className="mb-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{cat}</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {list.filter((t) => (t.category || 'Uncategorised') === cat).map((t) => (
                  <div key={t.id} className="card flex flex-col">
                    <button onClick={() => setPreview(t)}><Thumb html={t.editor_mode === 'text' ? '' : t.html} /></button>
                    <div className="flex flex-1 flex-col p-3">
                      <div className="font-medium text-navy-900">{t.name}</div>
                      <div className="truncate text-xs text-slate-500">{t.subject || 'No subject'}</div>
                      <div className="mt-1 text-[11px] text-slate-400">{t.editor_mode} · updated {fmt.date(t.updated_at)}</div>
                      <div className="mt-3 flex flex-wrap gap-1">
                        <button className="btn-primary btn-sm" onClick={() => navigate(`/campaigns/new?template_id=${t.id}`)}><Send size={13} /> Use</button>
                        <button className="btn-ghost btn-sm" title="Preview" onClick={() => setPreview(t)}><Eye size={14} /></button>
                        <button className="btn-ghost btn-sm" title="Edit" onClick={() => navigate(`/editor?template=${t.id}`)}><Pencil size={14} /></button>
                        <button className="btn-ghost btn-sm" title="Duplicate" onClick={() => act(() => post(`/templates/${t.id}/duplicate`), 'Template duplicated.')}><Copy size={14} /></button>
                        <button className="btn-ghost btn-sm text-red-600" title="Delete" onClick={async () => {
                          if (await confirm({ title: 'Delete template', message: `Delete "${t.name}"? Campaigns already created from it are not affected.`, danger: true, confirmText: 'Delete' })) act(() => del(`/templates/${t.id}`), 'Template deleted.');
                        }}><Trash2 size={14} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
      {preview && <PreviewModal t={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

function PreviewModal({ t, onClose }) {
  const [device, setDevice] = useState('desktop');
  const [full, setFull] = useState(null);
  useEffect(() => {
    get(`/templates/${t.id}`).then(setFull).catch(() => {});
  }, [t.id]);
  return (
    <Modal open onClose={onClose} title={t.name} size="xl"
      footer={<>
        <button className={`btn btn-sm ${device === 'desktop' ? 'bg-navy-800 text-white' : 'btn-secondary'}`} onClick={() => setDevice('desktop')}>Desktop</button>
        <button className={`btn btn-sm mr-auto ${device === 'mobile' ? 'bg-navy-800 text-white' : 'btn-secondary'}`} onClick={() => setDevice('mobile')}>Mobile</button>
        <button className="btn-secondary" onClick={onClose}>Close</button>
      </>}>
      <div className="bg-slate-100 p-3">
        {!full ? <Loading /> : <EmailPreview html={full.html} editorMode={full.editor_mode} textBody={full.text_body} preheader={full.preheader} subject={full.subject} device={device} height={620} />}
      </div>
    </Modal>
  );
}
