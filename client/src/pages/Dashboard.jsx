import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, Globe2, Building2, UserCheck, UserMinus, Send, MailCheck, MailOpen, MousePointerClick, MailX, AlertOctagon, Gauge, Plus, Upload,
} from 'lucide-react';
import { get, fmt } from '../api.js';
import { SimpleBar, SimpleLine, PairBar } from '../components/charts.jsx';
import { Badge, ErrorBox, Loading, PageHeader, StatCard } from '../ui.jsx';
import { useAuth } from '../App.jsx';

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const { user } = useAuth();
  const load = () => get('/dashboard').then((x) => { setD(x); setError(null); }).catch(setError);
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!d) return <Loading />;
  const { counts: c, email: e, quota } = d;
  const perf = [...d.recent].filter((r) => r.stats?.delivered).reverse().map((r) => ({
    name: r.name, open: fmt.rate(r.stats.unique_opens, r.stats.delivered), click: fmt.rate(r.stats.unique_clicks, r.stats.delivered),
  }));
  return (
    <>
      <PageHeader title={`Welcome${user?.name ? `, ${user.name.split(' ')[0]}` : ''}`} subtitle="Your email marketing at a glance."
        actions={<><Link to="/import-export" className="btn-secondary"><Upload size={16} /> Import contacts</Link><Link to="/campaigns/new" className="btn-primary"><Plus size={16} /> New campaign</Link></>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total contacts" value={fmt.n(c.contacts)} icon={Users} />
        <StatCard label="Countries" value={fmt.n(c.countries)} icon={Globe2} tone="sky" />
        <StatCard label="Cities" value={fmt.n(c.cities)} icon={Building2} tone="sky" />
        <StatCard label="Subscribed" value={fmt.n(c.subscribed)} icon={UserCheck} tone="green" />
        <StatCard label="Unsubscribed" value={fmt.n(c.unsubscribed)} icon={UserMinus} tone="slate" hint={c.bounced ? `${fmt.n(c.bounced)} bounced` : undefined} />
        <StatCard label="Campaigns sent" value={fmt.n(c.campaigns_sent)} icon={Send} />
        <StatCard label="Delivered" value={fmt.n(e.delivered)} icon={MailCheck} tone="green" hint={`of ${fmt.n(e.sent)} sent`} />
        <StatCard label="Open rate" value={fmt.pct(e.open_rate)} icon={MailOpen} hint={`${fmt.n(e.opens)} unique opens`} />
        <StatCard label="Click rate" value={fmt.pct(e.click_rate)} icon={MousePointerClick} tone="sky" hint={`${fmt.n(e.clicks)} unique clicks`} />
        <StatCard label="Bounce rate" value={fmt.pct(e.bounce_rate)} icon={MailX} tone="amber" hint={`${fmt.n(e.bounces)} bounces`} />
        <StatCard label="Failed emails" value={fmt.n(e.failed)} icon={AlertOctagon} tone={e.failed ? 'red' : 'slate'} />
        <StatCard label="Brevo credits left" icon={Gauge} tone="navy"
          value={quota?.credits != null ? fmt.n(quota.credits) : quota?.error ? 'Error' : '—'}
          hint={quota?.error ? 'Check Brevo Integration' : quota ? quota.plan_type || '' : 'Brevo not connected'} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="card p-5 xl:col-span-2">
          <div className="mb-1 text-sm font-semibold text-navy-900">Open & click rate — recent campaigns</div>
          <div className="mb-3 text-xs text-slate-500">% of delivered emails</div>
          {perf.length ? <PairBar data={perf} x="name" a={{ key: 'open', name: 'Open rate' }} b={{ key: 'click', name: 'Click rate' }} fmt={(v) => `${v}%`} />
            : <div className="flex h-[260px] items-center justify-center text-sm text-slate-400">Statistics appear after your first campaign is delivered.</div>}
        </div>
        <div className="card p-5">
          <div className="mb-3 text-sm font-semibold text-navy-900">Contacts by country (top 10)</div>
          {d.byCountry.length ? <SimpleBar data={d.byCountry} x="name" y="contacts" name="Contacts" horizontal fmt={(v) => v.toLocaleString()} />
            : <div className="flex h-[260px] items-center justify-center text-sm text-slate-400">No contacts yet.</div>}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="card p-5">
          <div className="mb-3 text-sm font-semibold text-navy-900">Contacts added per month</div>
          {d.growth.length ? <SimpleLine data={d.growth} x="month" y="contacts" name="New contacts" height={240} />
            : <div className="flex h-[240px] items-center justify-center text-sm text-slate-400">No data yet.</div>}
        </div>
        <div className="card overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between px-5 pt-4">
            <div className="text-sm font-semibold text-navy-900">Recent campaign activity</div>
            <Link className="text-xs font-medium text-navy-600 hover:underline" to="/reports">All reports →</Link>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="table">
              <thead><tr><th>Campaign</th><th>Status</th><th className="text-right">Recipients</th><th className="text-right">Delivered</th><th className="text-right">Opens</th><th className="text-right">Clicks</th><th>Date</th></tr></thead>
              <tbody>
                {d.recent.length === 0 ? <tr><td colSpan={7} className="py-8 text-center text-slate-400">No campaigns sent yet.</td></tr> : d.recent.map((r) => (
                  <tr key={r.id}>
                    <td><Link className="font-medium text-navy-900 hover:underline" to={`/reports/${r.id}`}>{r.name}</Link><div className="max-w-[260px] truncate text-xs text-slate-500">{r.audience_label}</div></td>
                    <td><Badge value={r.status} /></td>
                    <td className="text-right tabular-nums">{fmt.n(r.recipients)}</td>
                    <td className="text-right tabular-nums">{fmt.n(r.stats?.delivered)}</td>
                    <td className="text-right tabular-nums">{fmt.n(r.stats?.unique_opens)}</td>
                    <td className="text-right tabular-nums">{fmt.n(r.stats?.unique_clicks)}</td>
                    <td className="whitespace-nowrap text-slate-500">{fmt.dt(r.sent_at || r.scheduled_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
