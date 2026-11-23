import { Home, Radio, Ticket, Trophy, User } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setSlipOpen } from '../../store/slices/betslipSlice';

/** Phone/tablet navigation; the bet slip opens as a bottom sheet. */
export function BottomNav() {
  const dispatch = useAppDispatch();
  const count = useAppSelector((s) => s.betslip.selections.length);
  const authed = useAppSelector((s) => s.auth.status === 'authenticated');
  return (
    <nav className="bottom-nav" aria-label="Mobile">
      <NavLink to="/" end><Home size={20} />Home</NavLink>
      <NavLink to="/sports"><Trophy size={20} />Sports</NavLink>
      <button onClick={() => dispatch(setSlipOpen(true))} aria-label={`Open bet slip (${count})`}><Ticket size={20} />Bet slip{count > 0 && <span className="slip-count">{count}</span>}</button>
      <NavLink to="/live"><Radio size={20} />Live</NavLink>
      <NavLink to={authed ? '/account' : '/login'}><User size={20} />{authed ? 'Account' : 'Log in'}</NavLink>
    </nav>
  );
}
