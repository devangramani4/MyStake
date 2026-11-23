import { Activity, AlertTriangle, Banknote, FileClock, LayoutDashboard, LogOut, ShieldCheck, Trophy, UserCog, Users, Wallet } from 'lucide-react';
import { lazy, Suspense, useState, type FormEvent } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { errMsg } from './api';
import { useAuth, type Permission } from './auth';
import { Loading } from './ui';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const UsersPage = lazy(() => import('./pages/Users'));
const UserDetail = lazy(() => import('./pages/UserDetail'));
const Bets = lazy(() => import('./pages/Bets'));
const Sports = lazy(() => import('./pages/Sports'));
const Finance = lazy(() => import('./pages/Finance'));
const Risk = lazy(() => import('./pages/Risk'));
const Admins = lazy(() => import('./pages/Admins'));
const Audit = lazy(() => import('./pages/Audit'));
const ApiStatus = lazy(() => import('./pages/ApiStatus'));

function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [need2fa, setNeed2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password, need2fa ? totp : undefined);
    } catch (err) {
      const code = (err as { response?: { data?: { error?: { code?: string } } } }).response?.data?.error?.code;
      if (code === 'TWO_FACTOR_REQUIRED') setNeed2fa(true);
      else setError(errMsg(err));
    }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form className="card card-pad stack" style={{ width: '100%', maxWidth: 400 }} onSubmit={submit}>
        <div><h1 style={{ fontSize: 24 }}>Admin console</h1><p className="muted">Authorised staff only. All actions are audited.</p></div>
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="field"><label htmlFor="e">Email</label><input id="e" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="p">Password</label><input id="p" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {need2fa && <div className="field"><label htmlFor="t">Authentication code</label><input id="t" className="input" inputMode="numeric" value={totp} onChange={(e) => setTotp(e.target.value)} autoFocus /></div>}
        <button className="btn btn-primary btn-lg">Sign in</button>
      </form>
    </div>
  );
}

const NAV: Array<[string, string, React.ComponentType<{ size?: number }>, Permission]> = [
  ['/', 'Dashboard', LayoutDashboard, 'dashboard:view'],
  ['/users', 'Users', Users, 'users:view'],
  ['/bets', 'Bets', Trophy, 'bets:view'],
  ['/sports', 'Sports & markets', Activity, 'dashboard:view'],
  ['/finance', 'Finance', Wallet, 'finance:view'],
  ['/risk', 'Risk', AlertTriangle, 'users:view'],
  ['/admins', 'Admin users', UserCog, 'admins:manage'],
  ['/audit', 'Audit log', FileClock, 'audit:view'],
  ['/api-status', 'API status', ShieldCheck, 'dashboard:view'],
];

export default function App() {
  const { admin, ready, logout, can } = useAuth();
  if (!ready) return <Loading />;
  if (!admin) return <Login />;
  return (
    <BrowserRouter>
      <div className="admin-shell">
        <nav className="admin-side" aria-label="Admin">
          <div className="row" style={{ padding: '6px 8px 14px', fontWeight: 900, fontSize: 18 }}><Banknote size={20} color="var(--brand)" /> BetX <span className="badge badge-brand">Admin</span></div>
          {NAV.filter(([, , , p]) => can(p)).map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className="side-link"><Icon size={17} />{label}</NavLink>
          ))}
        </nav>
        <div className="admin-main">
          <header className="admin-top">
            <span className="muted" style={{ fontSize: 13 }}>Signed in as <b style={{ color: 'var(--text)' }}>{admin.name}</b> · <span className="badge">{admin.role.replace('_', ' ')}</span></span>
            <button className="btn btn-ghost btn-sm" onClick={logout}><LogOut size={14} /> Sign out</button>
          </header>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/users/:id" element={<UserDetail />} />
              <Route path="/bets" element={<Bets />} />
              <Route path="/sports" element={<Sports />} />
              <Route path="/finance" element={<Finance />} />
              <Route path="/risk" element={<Risk />} />
              {can('admins:manage') && <Route path="/admins" element={<Admins />} />}
              {can('audit:view') && <Route path="/audit" element={<Audit />} />}
              <Route path="/api-status" element={<ApiStatus />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </BrowserRouter>
  );
}
