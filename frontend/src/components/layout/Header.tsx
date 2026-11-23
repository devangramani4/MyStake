import { Bell, LogIn, Menu, Radio, Trophy, User as UserIcon } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setNavOpen } from '../../store/slices/uiSlice';
import { money } from '../../utils/format';
import { Logo } from './Logo';

export function Header() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);
  const wallet = useAppSelector((s) => s.wallet.wallet);
  const unread = useAppSelector((s) => s.ui.unread);
  return (
    <header className="header">
      <button className="icon-btn mobile-only" onClick={() => dispatch(setNavOpen(true))} aria-label="Open menu"><Menu size={20} /></button>
      <Logo />
      <nav className="header-nav" aria-label="Primary">
        <NavLink to="/sports"><Trophy size={16} /> Sports</NavLink>
        <NavLink to="/live"><Radio size={16} /> Live</NavLink>
        <NavLink to="/promotions">Promotions</NavLink>
      </nav>
      <div className="header-right">
        {user ? (
          <>
            <div className="balance-pill" aria-label="Wallet">
              <div className="amt num">
                <small>Balance</small>
                {wallet ? money(wallet.balance, wallet.currency) : '—'}
              </div>
              <Link to="/account/wallet/deposit" className="btn btn-primary btn-sm">Deposit</Link>
            </div>
            <Link to="/account/notifications" className="icon-btn" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}>
              <Bell size={19} />
              {unread > 0 && <span className="unread-dot">{unread > 9 ? '9+' : unread}</span>}
            </Link>
            <Link to="/account" className="icon-btn" aria-label="My account"><UserIcon size={19} /></Link>
          </>
        ) : (
          <>
            <Link to="/login" className="btn btn-ghost"><LogIn size={16} /> Log in</Link>
            <Link to="/register" className="btn btn-primary">Join</Link>
          </>
        )}
      </div>
    </header>
  );
}
