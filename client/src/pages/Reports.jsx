import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download, RefreshCw, ArrowLeft, Pause, Play, XCircle, BarChart3, Send, Copy } from 'lucide-react';
import { get, post, qs, download, fmt } from '../api.js';
import { PairBar, SimpleBar } from '../components/charts.jsx';
import { Badge, Empty, ErrorBox, Loading, PageHeader, Pagination, Spinner, StatCard, Tabs, useConfirm, useToast } from '../ui.jsx';

function rowStats(c) {
  const s = c.stats || {};
  return {
    sent: s.sent || 0, delivered: s.delivered || 0, opened: s.unique_opens || 0, clicked: s.unique_clicks || 0,
    bounced: (s.hard_bounces || 0) + (s.soft_bounces || 0), failed: s.failed || 0, unsub: s.unsubscriptions || 0,
  };
}

export default function Reports() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const load = useCallback(() => get('/campaigns').then((r) => { setRows(r.rows.filter((c) => c.status !== 'draft')); setError(null); }).catch(setError), []);
  useEffect(() => {
    load();
  }, [load]);
  const chart = (rows || []).filter((c) => c.stats?.delivered).slice(0, 10).reverse().map((c) => ({
    name: c.name, open: fmt.rate(c.stats.unique_opens, c.stats.delivered), click: fmt.rate(c.stats.unique_clicks, c.stats.delivered),
  }));
  return (
    <>
      <PageHeader title="Campaign Reports" subtitle="Delivery, opens, clicks, bounces and unsubscribes for every campaign, synced from Brevo."
        actions={<button className="btn-secondary" disabled={!rows?.length} onClick={() => download('/campaigns/report.xlsx')}><Download size={16} /> Export all to Excel</button>} />
      <ErrorBox error={error} onRetry={load} />
      {!rows ? <Loading /> : rows.length === 0 ? (
        <div className="card"><Empty icon={BarChart3} title="No reports yet" text="Reports appear here once a campaign has been sent." action={<Link className="btn-primary" to="/campaigns/new"><Send size={16} /> Create a campaign</Link>} /></div>
      ) : (
        <>
          {chart.length > 0 && (
            <div className="card mb-4 p-5">
              <div className="mb-1 text-sm font-semibold text-navy-900">Campaign performance</div>
              <div className="mb-3 text-xs text-slate-500">Open and click rate, % of delivered</div>
              <PairBar data={chart} x="name" a={{ key: 'open', name: 'Open rate' }} b={{ key: 'click', name: 'Click rate' }} fmt={(v) => `${v}%`} />
            </div>
          )}
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr>
                <th>Campaign</th><th>Subject</th><th>Date & time</th><th>Country</th><th>City</th><th>Audience</th>
                <th className="text-right">Recipients</th><th className="text-right">Sent</th><th className="text-right">Delivered</th><th className="text-right">Opened</th>
                <th className="text-right">Clicked</th><th className="text-right">Bounced</th><th className="text-right">Failed</th><th className="text-right">Unsub.</th>
              </tr></thead>
              <tbody>
                {rows.map((c) => {
                  const s = rowStats(c);
                  return (
                    <tr key={c.id} className="cursor-pointer" onClick={() => navigate(`/reports/${c.id}`)}>
                      <td className="font-medium text-navy-900"><div className="flex items-center gap-2">{c.name} <Badge value={c.status} /></div></td>
                      <td className="max-w-[220px] truncate text-slate-600">{c.subject}</td>
                      <td className="whitespace-nowrap text-slate-500">{fmt.dt(c.sent_at || c.scheduled_at)}</td>
                      <td className="max-w-[140px] truncate">{c.audience?.summary?.countries || '—'}</td>
                      <td className="max-w-[140px] truncate">{c.audience?.summary?.cities || '—'}</td>
                      <td className="max-w-[200px] truncate text-slate-500" title={c.audience_label}>{c.audience_label}</td>
                      <td className="text-right tabular-nums">{fmt.n(c.recipients)}</td>
                      <td className="text-right tabular-nums">{fmt.n(s.sent)}</td>
                      <td className="text-right tabular-nums">{fmt.n(s.delivered)}</td>
                      <td className="text-right tabular-nums">{fmt.n(s.opened)}</td>
                      <td className="text-right tabular-nums">{fmt.n(s.clicked)}</td>
                      <td className="text-right tabular-nums">{fmt.n(s.bounced)}</td>
                      <td className="text-right tabular-nums">{fmt.n(s.failed)}</td>
                      <td className="text-right tabular-nums">{fmt.n(s.unsub)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

const RECIPIENT_TABS = [
  ['all', 'All'], ['sent', 'Sent'], ['delivered', 'Delivered'], ['opened', 'Opened'], ['clicked', 'Clicked'], ['bounced', 'Bounced'],
  ['unsubscribed', 'Unsubscribed'], ['failed', 'Failed'], ['queued', 'Queued'], ['skipped', 'Skipped / cancelled'],
];

export function ReportDetail() {
  const { id } = useParams();
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const load = useCallback(() => get(`/campaigns/${id}/report`).then((x) => { setR(x); setError(null); }).catch(setError), [id]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!r || !['sending', 'scheduled'].includes(r.campaign.status)) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [r, load]);

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!r) return <Loading />;
  const c = r.campaign;
  const s = c.stats || {};
  const L = r.local;
  const sent = Math.max(s.sent || 0, L.sent);
  const delivered = s.delivered || 0;
  const opened = s.unique_opens || 0;
  const clicked = s.unique_clicks || 0;
  const bounced = (s.hard_bounces || 0) + (s.soft_bounces || 0);

  const sync = async () => {
    setSyncing(true);
    try {
      const out = await post(`/campaigns/${id}/sync-stats`);
      toast[out.errors ? 'error' : 'success'](out.errors ? 'Some Brevo statistics could not be refreshed. See the activity log.' : 'Statistics refreshed from Brevo.');
      load();
    } catch (e) {
      toast.error(e);
    } finally {
      setSyncing(false);
    }
  };
  const act = async (action, msg, opts) => {
    if (opts && !(await confirm(opts))) return;
    try {
      await post(`/campaigns/${id}/${action}`);
      toast.success(msg);
      load();
    } catch (e) {
      toast.error(e);
    }
  };
  const funnel = [
    { stage: 'Recipients', n: L.total }, { stage: 'Sent', n: sent }, { stage: 'Delivered', n: delivered },
    { stage: 'Opened', n: opened }, { stage: 'Clicked', n: clicked },
  ];

  return (
    <>
      <button className="btn-ghost btn-sm mb-3" onClick={() => navigate('/reports')}><ArrowLeft size={16} /> All reports</button>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{c.name} <Badge value={c.status} /></span>}
        subtitle={<>{c.subject} · {c.audience_label}{c.sent_at ? ` · sent ${fmt.dt(c.sent_at)}` : c.scheduled_at ? ` · scheduled ${fmt.dt(c.scheduled_at)}` : ''}</>}
        actions={<>
          {['sending', 'scheduled'].includes(c.status) && <button className="btn-secondary" onClick={() => act('pause', 'Paused.')}><Pause size={16} /> Pause</button>}
          {c.status === 'paused' && <button className="btn-secondary" onClick={() => act('resume', 'Resumed.')}><Play size={16} /> Resume</button>}
          {['sending', 'scheduled', 'paused'].includes(c.status) && <button className="btn-danger" onClick={() => act('cancel', 'Cancelled.', { title: 'Cancel campaign?', message: 'Recipients not yet handed to Brevo will not receive this email.', danger: true, confirmText: 'Cancel campaign' })}><XCircle size={16} /> Cancel</button>}
          {['sent', 'partially_sent', 'failed'].includes(c.status) && <Link className="btn-secondary" to={`/campaigns/${c.id}`}><Send size={16} /> Send to more</Link>}
          <button className="btn-secondary" onClick={async () => { const x = await post(`/campaigns/${c.id}/duplicate`); navigate(`/campaigns/${x.id}`); }}><Copy size={16} /> Duplicate</button>
          <button className="btn-secondary" disabled={syncing} onClick={sync}>{syncing ? <Spinner size={14} /> : <RefreshCw size={16} />} Refresh stats</button>
          <button className="btn-primary" onClick={() => download(`/campaigns/${c.id}/report.xlsx`)}><Download size={16} /> Export Excel</button>
        </>} />
      {c.error && ['failed', 'partially_sent'].includes(c.status) && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{c.error}</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Recipients" value={fmt.n(L.total)} hint={L.queued ? `${fmt.n(L.queued)} queued` : undefined} />
        <StatCard label="Sent" value={fmt.n(sent)} />
        <StatCard label="Delivered" value={fmt.n(delivered)} hint={fmt.pct(fmt.rate(delivered, sent))} tone="green" />
        <StatCard label="Opened" value={fmt.n(opened)} hint={`${fmt.pct(fmt.rate(opened, delivered))} open rate`} />
        <StatCard label="Clicked" value={fmt.n(clicked)} hint={`${fmt.pct(fmt.rate(clicked, delivered))} click rate`} tone="sky" />
        <StatCard label="Bounced" value={fmt.n(bounced)} hint={`${fmt.n(s.hard_bounces || 0)} hard · ${fmt.n(s.soft_bounces || 0)} soft`} tone="amber" />
        <StatCard label="Failed" value={fmt.n(L.failed)} tone={L.failed ? 'red' : 'slate'} />
        <StatCard label="Unsubscribed" value={fmt.n(s.unsubscriptions || 0)} hint={s.complaints ? `${fmt.n(s.complaints)} spam reports` : undefined} tone="slate" />
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Statistics from Brevo{c.stats_synced_at ? `, last refreshed ${fmt.dt(c.stats_synced_at)}` : ' (refreshed automatically every 15 minutes after sending)'}. Opens can be under-counted when email clients block images.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="card p-5">
          <div className="mb-3 text-sm font-semibold text-navy-900">Delivery funnel</div>
          <SimpleBar data={funnel} x="stage" y="n" name="Emails" fmt={(v) => v.toLocaleString()} height={240} />
        </div>
        <div className="card overflow-x-auto xl:col-span-2">
          <div className="px-5 pt-4 text-sm font-semibold text-navy-900">Batches sent through Brevo</div>
          <table className="table mt-2">
            <thead><tr><th>#</th><th>Status</th><th className="text-right">Recipients</th><th>Scheduled / sent</th><th>Brevo campaign</th><th className="text-right">Delivered</th><th className="text-right">Opens</th><th className="text-right">Clicks</th></tr></thead>
            <tbody>
              {r.batches.length === 0 ? <tr><td colSpan={8} className="py-6 text-center text-slate-400">No batches.</td></tr> : r.batches.map((b) => (
                <tr key={b.id}>
                  <td>{b.batch_no}</td>
                  <td><Badge value={b.status} />{b.error && <div className="max-w-[260px] truncate text-xs text-red-600" title={b.error}>{b.error}</div>}</td>
                  <td className="text-right tabular-nums">{fmt.n(b.recipient_count)}</td>
                  <td className="whitespace-nowrap text-slate-500">{fmt.dt(b.sent_at || b.run_at)}</td>
                  <td className="text-slate-500">{b.brevo_campaign_id ? `#${b.brevo_campaign_id}` : '—'}</td>
                  <td className="text-right tabular-nums">{fmt.n(b.stats?.delivered)}</td>
                  <td className="text-right tabular-nums">{fmt.n(b.stats?.unique_opens)}</td>
                  <td className="text-right tabular-nums">{fmt.n(b.stats?.unique_clicks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Recipients id={id} />

      <details className="card mt-4 p-5">
        <summary className="cursor-pointer text-sm font-semibold text-navy-900">Activity log ({r.logs.length})</summary>
        <div className="mt-3 max-h-80 space-y-1 overflow-y-auto text-sm">
          {r.logs.map((l) => (
            <div key={l.id} className={`flex gap-3 ${l.level === 'error' ? 'text-red-700' : l.level === 'warn' ? 'text-amber-700' : 'text-slate-600'}`}>
              <span className="w-36 shrink-0 text-xs text-slate-400">{fmt.dt(l.created_at)}</span><span>{l.message}</span>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}

function Recipients({ id }) {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [data, setData] = useState({ rows: [], total: 0, pageSize: 50 });
  useEffect(() => {
    const t = setTimeout(() => get(`/campaigns/${id}/recipients${qs({ filter, page, search })}`).then(setData).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [id, filter, page, search]);
  return (
    <div className="card mt-4 p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-navy-900">Recipients</div>
        <input className="input max-w-xs" placeholder="Search email…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>
      <Tabs value={filter} onChange={(v) => { setFilter(v); setPage(1); }} tabs={RECIPIENT_TABS.map(([value, label]) => ({ value, label }))} />
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>Email</th><th>Name</th><th>Company</th><th>Country</th><th>City</th><th>Batch</th><th>Status</th><th>Opened</th><th>Clicked</th><th>Unsubscribed</th></tr></thead>
          <tbody>
            {data.rows.length === 0 ? <tr><td colSpan={10} className="py-8 text-center text-slate-400">No recipients in this view.</td></tr> : data.rows.map((x) => (
              <tr key={x.id}>
                <td className="font-medium">{x.email}</td>
                <td>{x.full_name || '—'}</td>
                <td className="max-w-[180px] truncate">{x.company || '—'}</td>
                <td>{x.country || '—'}</td>
                <td>{x.city || '—'}</td>
                <td>{x.batch_no ?? '—'}</td>
                <td><Badge value={x.status} />{x.error && <div className="max-w-[220px] truncate text-xs text-slate-400" title={x.error}>{x.error}</div>}</td>
                <td className="whitespace-nowrap text-slate-500">{x.opened_at ? fmt.dt(x.opened_at) : '—'}</td>
                <td className="whitespace-nowrap text-slate-500">{x.clicked_at ? fmt.dt(x.clicked_at) : '—'}</td>
                <td className="whitespace-nowrap text-slate-500">{x.unsubscribed_at ? fmt.dt(x.unsubscribed_at) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
    </div>
  );
}
