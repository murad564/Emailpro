import { useCallback, useEffect, useState } from 'react';
import { Plug, CheckCircle2, XCircle, KeyRound, RefreshCw, Webhook, ShieldCheck, Users, ExternalLink, Trash2 } from 'lucide-react';
import { get, post, del, fmt } from '../api.js';
import { useAuth } from '../App.jsx';
import { Field, Loading, PageHeader, Spinner, useConfirm, useToast } from '../ui.jsx';

export default function BrevoPage() {
  const [st, setSt] = useState(null);
  const [senders, setSenders] = useState(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState('');
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const toast = useToast();
  const confirm = useConfirm();
  const load = useCallback(async (refresh) => {
    const s = await get(`/brevo/status${refresh ? '?refresh=1' : ''}`);
    setSt(s);
    if (s.connected) get('/brevo/senders').then((r) => setSenders(r.senders)).catch(() => setSenders([]));
  }, []);
  useEffect(() => {
    load().catch(toast.error);
  }, [load, toast]);
  useEffect(() => {
    if (st?.contacts_sync?.status !== 'running' && st?.contacts_sync?.status !== 'queued') return;
    const t = setInterval(() => load(), 5000);
    return () => clearInterval(t);
  }, [st, load]);

  const run = async (name, fn) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy('');
    }
  };
  if (!st) return <Loading />;

  return (
    <>
      <PageHeader title="Brevo Integration" subtitle="All emails are sent through your Brevo account using Brevo's official API." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="card p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className={`rounded-lg p-2 ${st.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}><Plug size={20} /></div>
            <div>
              <div className="font-semibold text-navy-900">Connection</div>
              <div className={`flex items-center gap-1 text-sm ${st.connected ? 'text-emerald-700' : st.configured ? 'text-red-600' : 'text-slate-500'}`}>
                {st.connected ? <><CheckCircle2 size={15} /> Connected</> : st.configured ? <><XCircle size={15} /> Key saved but connection failed</> : 'Not connected'}
              </div>
            </div>
            {st.configured && <button className="btn-secondary btn-sm ml-auto" disabled={busy === 'test'} onClick={() => run('test', async () => { const r = await post('/brevo/test'); toast.success(`Connected to ${r.account.company || r.account.email} (${r.ms} ms).`); await load(true); })}>{busy === 'test' ? <Spinner size={13} /> : <RefreshCw size={14} />} Test connection</button>}
          </div>
          {st.error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{st.error}</div>}
          {st.connected && (
            <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="label">Account</dt><dd>{st.account.company || '—'}<div className="text-xs text-slate-500">{st.account.email}</div></dd></div>
              <div><dt className="label">Plan</dt><dd className="capitalize">{st.plan?.plan_type || '—'}</dd></div>
              <div><dt className="label">Email credits remaining</dt><dd className="text-xl font-semibold text-navy-900">{st.plan?.credits != null ? fmt.n(st.plan.credits) : '—'}</dd></div>
              <div><dt className="label">API key</dt><dd className="font-mono text-xs">{st.key_hint}</dd></div>
            </dl>
          )}
          {isAdmin && !st.from_env && (
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy-900"><KeyRound size={16} /> {st.configured ? 'Replace API key' : 'Connect your Brevo account'}</div>
              <ol className="mb-3 list-decimal space-y-0.5 pl-5 text-xs text-slate-500">
                <li>In Brevo open <b>Settings → SMTP & API → API Keys</b>.</li>
                <li>Click <b>Generate a new API key</b> and copy it (starts with <code>xkeysib-</code>).</li>
                <li>Paste it below. It is encrypted on the server and never shown again.</li>
              </ol>
              <div className="flex gap-2">
                <input className="input font-mono" type="password" autoComplete="off" placeholder="xkeysib-…" value={key} onChange={(e) => setKey(e.target.value)} />
                <button className="btn-primary" disabled={!key || busy === 'key'} onClick={() => run('key', async () => {
                  const r = await post('/brevo/key', { api_key: key });
                  setKey('');
                  toast.success(`Connected to ${r.account.company || r.account.email}.`);
                  await load(true);
                })}>{busy === 'key' && <Spinner size={14} />} Save & connect</button>
              </div>
              {st.configured && (
                <button className="btn-ghost btn-sm mt-2 text-red-600" onClick={async () => {
                  if (await confirm({ title: 'Disconnect Brevo?', message: 'Campaigns cannot be sent until a key is added again.', danger: true, confirmText: 'Disconnect' })) run('del', async () => { await del('/brevo/key'); toast.success('Brevo disconnected.'); await load(); });
                }}><Trash2 size={14} /> Disconnect</button>
              )}
            </div>
          )}
          {st.from_env && <p className="text-xs text-slate-500">The API key is set as a server environment variable (BREVO_API_KEY).</p>}
          {!isAdmin && !st.configured && <p className="text-sm text-slate-500">Ask an administrator to connect Brevo.</p>}
        </div>

        <div className="card p-5">
          <div className="mb-3 font-semibold text-navy-900">Verified senders</div>
          <p className="mb-3 text-sm text-slate-500">Brevo only sends from addresses verified in your account. Add senders and authenticate your domain (aristokrat.az) in Brevo under <b>Senders, Domains & Dedicated IPs</b> for the best deliverability.</p>
          {!st.connected ? <p className="text-sm text-slate-400">Connect Brevo to see your senders.</p> : !senders ? <Spinner /> : senders.length === 0 ? <p className="text-sm text-amber-700">No senders found in Brevo.</p> : (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {senders.map((s) => (
                <div key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span><b className="font-medium">{s.name}</b> <span className="text-slate-500">&lt;{s.email}&gt;</span></span>
                  {s.active ? <span className="text-xs text-emerald-700">Active</span> : <span className="text-xs text-amber-700">Inactive</span>}
                </div>
              ))}
            </div>
          )}
          <a className="mt-3 inline-flex items-center gap-1 text-xs text-navy-600 hover:underline" href="https://app.brevo.com/senders/list" target="_blank" rel="noreferrer">Manage senders in Brevo <ExternalLink size={12} /></a>
        </div>

        <div className="card p-5">
          <div className="mb-2 flex items-center gap-2 font-semibold text-navy-900"><Webhook size={18} /> Real-time tracking (webhook)</div>
          <p className="mb-3 text-sm text-slate-500">Brevo notifies this app about deliveries, opens, clicks, bounces, unsubscribes and spam complaints for each recipient. Totals are also refreshed from Brevo every 15 minutes.</p>
          {st.webhook ? (
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><CheckCircle2 size={15} className="mr-1 inline" /> Registered {fmt.dt(st.webhook.at)}<div className="truncate text-xs opacity-80">{st.webhook.url}</div></div>
          ) : <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Not registered yet.</div>}
          {isAdmin && st.connected && (
            <button className="btn-secondary btn-sm mt-3" disabled={busy === 'wh'} onClick={() => run('wh', async () => {
              const r = await post('/brevo/webhook');
              r.ok ? toast.success(r.created ? 'Webhook registered in Brevo.' : 'Webhook already registered.') : toast.error(r.message);
              await load();
            })}>{busy === 'wh' ? <Spinner size={13} /> : <RefreshCw size={14} />} {st.webhook ? 'Re-check webhook' : 'Register webhook'}</button>
          )}
        </div>

        <div className="card p-5">
          <div className="mb-2 flex items-center gap-2 font-semibold text-navy-900"><ShieldCheck size={18} /> Unsubscribes & suppression sync</div>
          <p className="mb-3 text-sm text-slate-500">Unsubscribed and bounced addresses are kept in sync both ways: blocklisted contacts in Brevo are suppressed here, and anyone suppressed here is blocklisted in Brevo. Runs automatically every 6 hours.</p>
          <div className="text-xs text-slate-500">Last sync: {st.blocklist_synced_at ? fmt.dt(st.blocklist_synced_at) : 'never'}</div>
          {st.connected && (
            <button className="btn-secondary btn-sm mt-3" disabled={busy === 'sup'} onClick={() => run('sup', async () => {
              const r = await post('/brevo/sync-suppression');
              toast.success(`Sync complete: ${r.pushed} sent to Brevo, ${r.pulled} new from Brevo.`);
              await load();
            })}>{busy === 'sup' ? <Spinner size={13} /> : <RefreshCw size={14} />} Sync now</button>
          )}
        </div>

        <div className="card p-5 xl:col-span-2">
          <div className="mb-2 flex items-center gap-2 font-semibold text-navy-900"><Users size={18} /> Contact synchronisation</div>
          <p className="mb-3 text-sm text-slate-500">
            Campaign recipients are synced to Brevo automatically at send time (one Brevo list per batch in the folder "Aristokrat Mail"). Optionally, copy every subscribed contact to a single Brevo list, for example to use them in Brevo's own tools.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {isAdmin && st.connected && (
              <button className="btn-secondary btn-sm" disabled={busy === 'sync' || ['queued', 'running'].includes(st.contacts_sync?.status)} onClick={() => run('sync', async () => { await post('/brevo/sync-contacts'); toast.success('Contact sync started.'); await load(); })}>
                {['queued', 'running'].includes(st.contacts_sync?.status) ? <Spinner size={13} /> : <RefreshCw size={14} />} Sync all subscribed contacts to Brevo
              </button>
            )}
            {st.contacts_sync && (
              <span className="text-xs text-slate-500">
                Last: {st.contacts_sync.status}{st.contacts_sync.count != null ? ` · ${fmt.n(st.contacts_sync.count)} contacts` : ''}{st.contacts_sync.error ? ` · ${st.contacts_sync.error}` : ''} · {fmt.dt(st.contacts_sync.at)}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
