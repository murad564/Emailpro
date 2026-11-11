import { useCallback, useEffect, useState } from 'react';
import { Save, UserPlus, Pencil, Trash2 } from 'lucide-react';
import { get, post, put, del, fmt } from '../api.js';
import { useAuth } from '../App.jsx';
import { Badge, Field, Loading, Modal, PageHeader, Spinner, Tabs, useConfirm, useToast } from '../ui.jsx';

export default function SettingsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState(user?.role === 'admin' ? 'company' : 'password');
  const tabs = [
    ...(user?.role === 'admin' ? [{ value: 'company', label: 'Company & compliance' }, { value: 'sender', label: 'Default sender' }, { value: 'users', label: 'Users' }] : []),
    { value: 'password', label: 'My password' },
  ];
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'company' && <CompanySettings />}
      {tab === 'sender' && <SenderSettings />}
      {tab === 'users' && <UsersAdmin />}
      {tab === 'password' && <PasswordForm />}
    </>
  );
}

function CompanySettings() {
  const [g, setG] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    get('/settings').then((s) => setG(s.general)).catch(toast.error);
  }, [toast]);
  if (!g) return <Loading />;
  const set = (k) => (e) => setG((x) => ({ ...x, [k]: e.target.value }));
  const setFb = (k) => (e) => setG((x) => ({ ...x, default_fallbacks: { ...x.default_fallbacks, [k]: e.target.value } }));
  const save = async () => {
    setBusy(true);
    try {
      await put('/settings', { general: g });
      toast.success('Settings saved.');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="card space-y-3 p-5">
        <div className="font-semibold text-navy-900">Company identification</div>
        <p className="text-sm text-slate-500">Shown in the footer of every marketing email. A physical postal address is required by anti-spam laws (CAN-SPAM, GDPR/ePrivacy) and campaigns cannot be sent without it.</p>
        <Field label="Company name"><input className="input" value={g.company_name} onChange={set('company_name')} /></Field>
        <Field label="Postal address *"><textarea className="input min-h-[80px]" value={g.company_address} onChange={set('company_address')} placeholder={'Street, building\nBaku AZ1000, Azerbaijan'} /></Field>
        <Field label="Website"><input className="input" value={g.website} onChange={set('website')} /></Field>
      </div>
      <div className="card space-y-3 p-5">
        <div className="font-semibold text-navy-900">Personalisation fallbacks</div>
        <p className="text-sm text-slate-500">Used when a contact has no value for a variable. Example: "Hello {'{{first_name}}'}," becomes "Hello {g.default_fallbacks.first_name}," if the first name is missing.</p>
        {Object.keys(g.default_fallbacks).map((k) => (
          <Field key={k} label={`{{${k}}}`}><input className="input" value={g.default_fallbacks[k]} onChange={setFb(k)} placeholder="(empty)" /></Field>
        ))}
      </div>
      <div className="xl:col-span-2"><button className="btn-primary" disabled={busy} onClick={save}>{busy ? <Spinner size={14} /> : <Save size={16} />} Save settings</button></div>
    </div>
  );
}

function SenderSettings() {
  const [s, setS] = useState(null);
  const [senders, setSenders] = useState([]);
  const toast = useToast();
  useEffect(() => {
    get('/settings').then((x) => setS(x.sender)).catch(toast.error);
    get('/brevo/senders').then((r) => setSenders(r.senders)).catch(() => {});
  }, [toast]);
  if (!s) return <Loading />;
  const save = async () => {
    try {
      await put('/settings', { sender: s });
      toast.success('Default sender saved.');
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="card max-w-xl space-y-3 p-5">
      <p className="text-sm text-slate-500">Pre-filled in new campaigns. You can change it per campaign.</p>
      <Field label="Sender name"><input className="input" value={s.sender_name} onChange={(e) => setS({ ...s, sender_name: e.target.value })} /></Field>
      <Field label="Sender email" hint={senders.length ? 'Must be a verified sender in Brevo' : 'Connect Brevo to choose from verified senders'}>
        <input className="input" list="snd" type="email" value={s.sender_email} onChange={(e) => setS({ ...s, sender_email: e.target.value })} />
        <datalist id="snd">{senders.map((x) => <option key={x.id} value={x.email}>{x.name}</option>)}</datalist>
      </Field>
      <Field label="Reply-to email"><input className="input" type="email" value={s.reply_to} onChange={(e) => setS({ ...s, reply_to: e.target.value })} /></Field>
      <button className="btn-primary" onClick={save}><Save size={16} /> Save</button>
    </div>
  );
}

function UsersAdmin() {
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const load = useCallback(() => get('/users').then((r) => setRows(r.rows)).catch(toast.error), [toast]);
  useEffect(() => {
    load();
  }, [load]);
  if (!rows) return <Loading />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button className="btn-primary" onClick={() => setEdit({ role: 'user', active: true })}><UserPlus size={16} /> Add user</button></div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="font-medium">{u.name || '—'}{u.id === user.id && <span className="ml-1 text-xs text-slate-400">(you)</span>}</td>
                <td>{u.email}</td>
                <td><Badge value={u.role} /></td>
                <td>{u.active ? <span className="text-emerald-700">Active</span> : <span className="text-slate-400">Disabled</span>}</td>
                <td className="text-slate-500">{fmt.dt(u.last_login_at)}</td>
                <td className="whitespace-nowrap text-right">
                  <button className="btn-ghost btn-sm" onClick={() => setEdit(u)}><Pencil size={15} /></button>
                  {u.id !== user.id && <button className="btn-ghost btn-sm text-red-600" onClick={async () => {
                    if (!(await confirm({ title: 'Delete user', message: `Delete ${u.email}? Their campaigns and contacts stay.`, danger: true, confirmText: 'Delete' }))) return;
                    try { await del(`/users/${u.id}`); toast.success('User deleted.'); load(); } catch (e) { toast.error(e); }
                  }}><Trash2 size={15} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <UserModal u={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function UserModal({ u, onClose, onSaved }) {
  const [f, setF] = useState({ name: u.name || '', email: u.email || '', role: u.role, active: u.active, password: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async () => {
    setBusy(true);
    try {
      if (u.id) await put(`/users/${u.id}`, { ...f, password: f.password || undefined });
      else await post('/users', f);
      toast.success('User saved.');
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={u.id ? 'Edit user' : 'Add user'} size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>{busy && <Spinner size={14} />} Save</button></>}>
      <div className="space-y-3">
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email"><input className="input" type="email" disabled={!!u.id} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Role">
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="user">Team member — contacts, templates, campaigns</option>
            <option value="admin">Administrator — also users, Brevo key, settings</option>
          </select>
        </Field>
        <Field label={u.id ? 'New password (leave empty to keep)' : 'Password'} hint="At least 8 characters"><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        {u.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Account active</label>}
      </div>
    </Modal>
  );
}

function PasswordForm() {
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const toast = useToast();
  const save = async () => {
    if (f.next !== f.again) return toast.error('New passwords do not match.');
    try {
      await post('/settings/password', f);
      toast.success('Password changed.');
      setF({ current: '', next: '', again: '' });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="card max-w-md space-y-3 p-5">
      <Field label="Current password"><input className="input" type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
      <Field label="New password"><input className="input" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
      <Field label="Repeat new password"><input className="input" type="password" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} /></Field>
      <button className="btn-primary" disabled={!f.current || !f.next} onClick={save}>Change password</button>
    </div>
  );
}
