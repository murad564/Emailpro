import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, FileSpreadsheet, Globe2, Filter, Send, PenSquare, LayoutTemplate, BarChart3, Plug, Settings as Cog, LogOut, Menu, X, Mail,
} from 'lucide-react';
import { get, post, setUnauthorizedHandler } from './api.js';
import { ConfirmProvider, Loading, ToastProvider } from './ui.jsx';

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Contacts from './pages/Contacts.jsx';
import ImportExport from './pages/ImportExport.jsx';
import Locations from './pages/Locations.jsx';
import Segments from './pages/Segments.jsx';
import Campaigns from './pages/Campaigns.jsx';
import CampaignEdit from './pages/CampaignEdit.jsx';
import EditorPage from './pages/EditorPage.jsx';
import Templates from './pages/Templates.jsx';
import Reports, { ReportDetail } from './pages/Reports.jsx';
import BrevoPage from './pages/Brevo.jsx';
import SettingsPage from './pages/Settings.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

const LookupCtx = createContext(null);
export const useLookups = () => useContext(LookupCtx);

function LookupProvider({ children }) {
  const [data, setData] = useState({ countries: [], cities: [], categories: [], tags: [], languages: [] });
  const reload = useCallback(async () => {
    try {
      setData(await get('/contacts/lookups'));
    } catch {
      /* shown elsewhere */
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return <LookupCtx.Provider value={{ ...data, reload }}>{children}</LookupCtx.Provider>;
}

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/import-export', label: 'Import / Export', icon: FileSpreadsheet },
  { to: '/locations', label: 'Countries & Cities', icon: Globe2 },
  { to: '/segments', label: 'Audience Segments', icon: Filter },
  { to: '/campaigns', label: 'Email Campaigns', icon: Send },
  { to: '/editor', label: 'Email Editor', icon: PenSquare },
  { to: '/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/reports', label: 'Campaign Reports', icon: BarChart3 },
  { to: '/brevo', label: 'Brevo Integration', icon: Plug },
  { to: '/settings', label: 'Settings', icon: Cog },
];

function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth();
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy-900 text-navy-100 transition-transform lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="rounded-lg bg-white/10 p-1.5">
            <Mail size={20} className="text-sky-300" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">Aristokrat Mail</div>
            <div className="text-[11px] text-navy-300">Email marketing · Brevo</div>
          </div>
          <button className="ml-auto text-navy-300 lg:hidden" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  isActive ? 'bg-white/12 bg-sky-400/15 font-medium text-white' : 'text-navy-200 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <n.icon size={18} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2 rounded-lg px-2 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-400/20 text-sm font-semibold text-sky-200">
              {(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-white">{user?.name || user?.email}</div>
              <div className="truncate text-[11px] text-navy-300">{user?.role === 'admin' ? 'Administrator' : 'Team member'}</div>
            </div>
            <button title="Sign out" className="rounded p-1.5 text-navy-300 hover:bg-white/10 hover:text-white" onClick={logout}>
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function Shell() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  return (
    <LookupProvider>
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <button className="btn-ghost btn-sm" onClick={() => setOpen(true)}>
            <Menu size={20} />
          </button>
          <span className="font-semibold text-navy-900">Aristokrat Mail</span>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/import-export" element={<ImportExport />} />
            <Route path="/locations" element={<Locations />} />
            <Route path="/segments" element={<Segments />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/campaigns/:id" element={<CampaignEdit />} />
            <Route path="/editor" element={<EditorPage />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/reports/:id" element={<ReportDetail />} />
            <Route path="/brevo" element={<BrevoPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </LookupProvider>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    get('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);
  const logout = async () => {
    await post('/auth/logout').catch(() => {});
    setUser(null);
  };
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AuthCtx.Provider value={{ user, setUser, logout }}>
          <BrowserRouter>
            {user === undefined ? <Loading /> : user ? <Shell /> : <Login onLogin={setUser} />}
          </BrowserRouter>
        </AuthCtx.Provider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
