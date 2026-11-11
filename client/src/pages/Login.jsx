import { useState } from 'react';
import { Mail } from 'lucide-react';
import { post } from '../api.js';
import { Spinner } from '../ui.jsx';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await post('/auth/login', { email, password });
      onLogin(r.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-navy-900 via-navy-800 to-navy-600 p-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-7">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl bg-navy-800 p-2.5">
            <Mail className="text-sky-300" size={22} />
          </div>
          <div>
            <div className="text-lg font-semibold text-navy-900">Aristokrat Mail</div>
            <div className="text-xs text-slate-500">Sign in to your workspace</div>
          </div>
        </div>
        <label className="label">Email</label>
        <input className="input mb-3" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <label className="label">Password</label>
        <input className="input mb-4" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <button className="btn-primary w-full py-2.5" disabled={busy}>
          {busy && <Spinner size={16} />} Sign in
        </button>
        <p className="mt-4 text-center text-xs text-slate-400">Accounts are created by your administrator.</p>
      </form>
    </div>
  );
}
