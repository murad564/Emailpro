import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Send, Copy, Trash2, BarChart3, Pencil } from 'lucide-react';
import { get, post, del, fmt } from '../api.js';
import { Badge, Empty, ErrorBox, Loading, PageHeader, Tabs, useConfirm, useToast } from '../ui.jsx';

export default function Campaigns() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('all');
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const load = useCallback(() => get('/campaigns').then((r) => { setRows(r.rows); setError(null); }).catch(setError), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);
  const groups = {
    all: () => true,
    draft: (c) => c.status === 'draft',
    scheduled: (c) => ['scheduled', 'sending', 'paused'].includes(c.status),
    sent: (c) => ['sent', 'partially_sent', 'failed', 'cancelled'].includes(c.status),
  };
  const list = (rows || []).filter(groups[tab]);
  const duplicate = async (c) => {
    try {
      const r = await post(`/campaigns/${c.id}/duplicate`);
      toast.success('Campaign duplicated.');
      navigate(`/campaigns/${r.id}`);
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async (c) => {
    if (!(await confirm({ title: 'Delete campaign', message: `Delete "${c.name}"?${c.status !== 'draft' ? '\nIts report and recipient history will be deleted too.' : ''}`, danger: true, confirmText: 'Delete' }))) return;
    try {
      await del(`/campaigns/${c.id}`);
      toast.success('Campaign deleted.');
      load();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <>
      <PageHeader title="Email Campaigns" subtitle="Create, schedule and send campaigns through Brevo."
        actions={<Link to="/campaigns/new" className="btn-primary"><Plus size={16} /> New campaign</Link>} />
      <ErrorBox error={error} onRetry={load} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'all', label: 'All', count: rows?.length },
        { value: 'draft', label: 'Drafts', count: rows?.filter(groups.draft).length },
        { value: 'scheduled', label: 'Scheduled & sending', count: rows?.filter(groups.scheduled).length },
        { value: 'sent', label: 'Sent', count: rows?.filter(groups.sent).length },
      ]} />
      {!rows ? <Loading /> : list.length === 0 ? (
        <div className="card"><Empty icon={Send} title="No campaigns here yet" text="Create a campaign, choose your audience by country and city, and send it through Brevo." action={<Link to="/campaigns/new" className="btn-primary"><Plus size={16} /> New campaign</Link>} /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Campaign</th><th>Status</th><th>Audience</th><th className="text-right">Recipients</th><th className="text-right">Opens</th><th className="text-right">Clicks</th><th>Date</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {list.map((c) => {
                const s = c.stats || {};
                return (
                  <tr key={c.id}>
                    <td className="max-w-[320px]">
                      <Link to={c.status === 'draft' ? `/campaigns/${c.id}` : `/reports/${c.id}`} className="font-medium text-navy-900 hover:underline">{c.name}</Link>
                      <div className="truncate text-xs text-slate-500">{c.subject || 'No subject'}</div>
                      {c.error && c.status !== 'sent' && <div className="truncate text-xs text-red-600" title={c.error}>{c.error}</div>}
                    </td>
                    <td><Badge value={c.status} /></td>
                    <td className="max-w-[240px] truncate text-slate-600" title={c.audience_label}>{c.audience_label || '—'}</td>
                    <td className="text-right tabular-nums">{c.recipients ? fmt.n(c.recipients) : '—'}</td>
                    <td className="text-right tabular-nums">{s.delivered ? fmt.pct(fmt.rate(s.unique_opens, s.delivered)) : '—'}</td>
                    <td className="text-right tabular-nums">{s.delivered ? fmt.pct(fmt.rate(s.unique_clicks, s.delivered)) : '—'}</td>
                    <td className="whitespace-nowrap text-slate-500">{c.sent_at ? fmt.dt(c.sent_at) : c.scheduled_at ? `⏱ ${fmt.dt(c.scheduled_at)}` : `Edited ${fmt.date(c.updated_at)}`}</td>
                    <td className="whitespace-nowrap text-right">
                      <button className="btn-ghost btn-sm" title="Open" onClick={() => navigate(`/campaigns/${c.id}`)}><Pencil size={15} /></button>
                      {c.status !== 'draft' && <button className="btn-ghost btn-sm" title="Report" onClick={() => navigate(`/reports/${c.id}`)}><BarChart3 size={15} /></button>}
                      <button className="btn-ghost btn-sm" title="Duplicate" onClick={() => duplicate(c)}><Copy size={15} /></button>
                      {!['sending', 'scheduled'].includes(c.status) && <button className="btn-ghost btn-sm text-red-600" title="Delete" onClick={() => remove(c)}><Trash2 size={15} /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
