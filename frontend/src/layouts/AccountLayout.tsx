import { Bell, History, LayoutDashboard, LogOut, Receipt, Shield, ShieldCheck, User, Wallet } from 'lucide-react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LoadingSkeleton } from '../components/ui/States';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { logout } from '../store/slices/authSlice';

/** Guarded area for logged-in users. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAppSelector((s) => s.auth.status);
  const location = useLocation();
  if (status === 'unknown') return <div className="page"><LoadingSkeleton rows={5} /></div>;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function AccountLayout() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  return (
    <RequireAuth>
      <div className="page">
        <div className="account-grid">
          <nav className="card account-nav" aria-label="Account">
            <NavLink end to="/account" className="side-link"><LayoutDashboard size={17} /> Dashboard</NavLink>
            <NavLink to="/account/bets" className="side-link"><History size={17} /> My bets</NavLink>
            <NavLink to="/account/wallet" className="side-link"><Wallet size={17} /> Wallet</NavLink>
            <NavLink to="/account/transactions" className="side-link"><Receipt size={17} /> Transactions</NavLink>
            <NavLink to="/account/profile" className="side-link"><User size={17} /> Profile</NavLink>
            <NavLink to="/account/security" className="side-link"><Shield size={17} /> Security</NavLink>
            <NavLink to="/account/notifications" className="side-link"><Bell size={17} /> Notifications</NavLink>
            <NavLink to="/account/responsible-gambling" className="side-link"><ShieldCheck size={17} /> Responsible gambling</NavLink>
            <button className="side-link" style={{ background: 'none', border: 0, textAlign: 'left' }} onClick={() => dispatch(logout()).then(() => navigate('/'))}><LogOut size={17} /> Log out</button>
          </nav>
          <div className="stack" style={{ minWidth: 0, gap: 20 }}>
            <Outlet />
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
