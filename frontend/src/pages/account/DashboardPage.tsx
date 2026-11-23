import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BetHistoryTable } from '../../components/account/BetHistoryTable';
import { WalletCard } from '../../components/account/WalletCard';
import { EmptyState, LoadingSkeleton } from '../../components/ui/States';
import { betsApi, userApi } from '../../services/api/accountApi';
import { authApi } from '../../services/api/authApi';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { userUpdated } from '../../store/slices/authSlice';
import { toast } from '../../store/slices/uiSlice';
import { fetchWallet } from '../../store/slices/walletSlice';
import type { BetItem } from '../../types';
import { errorMessage } from '../../utils/errors';

const PnlChart = lazy(() => import('../../components/account/PnlChart'));

export default function DashboardPage() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user)!;
  const wallet = useAppSelector((s) => s.wallet.wallet);
  const version = useAppSelector((s) => s.ui.betsVersion);
  const [open, setOpen] = useState<BetItem[] | null>(null);
  const [settled, setSettled] = useState<BetItem[] | null>(null);

  useEffect(() => {
    dispatch(fetchWallet());
    betsApi.list({ view: 'open', range: 'all', pageSize: 5 }).then((p) => setOpen(p.items)).catch(() => setOpen([]));
    betsApi.list({ view: 'settled', range: '30d', pageSize: 100 }).then((p) => setSettled(p.items)).catch(() => setSettled([]));
  }, [dispatch, version]);

  return (
    <>
      <div>
        <h1 className="page-title">Hi, {user.firstName ?? user.username}</h1>
        <p className="page-sub">Your exchange account at a glance.</p>
      </div>
      {!user.emailVerified && (
        <div className="alert alert-warning row between wrap">
          <span>Verify your email to start betting.</span>
          <button className="btn btn-sm btn-secondary" onClick={() => authApi.resendVerification().then(() => dispatch(toast({ kind: 'success', title: 'Verification email sent' }))).catch((e) => dispatch(toast({ kind: 'error', title: errorMessage(e) })))}>Resend email</button>
        </div>
      )}
      {!user.termsAccepted && (
        <div className="alert alert-info row between wrap">
          <span>Our terms have been updated. Please review and accept them to continue betting.</span>
          <button className="btn btn-sm btn-secondary" onClick={() => userApi.acceptTerms().then((u) => dispatch(userUpdated(u)))}>Accept terms</button>
        </div>
      )}
      {wallet ? <WalletCard wallet={wallet} /> : <LoadingSkeleton rows={1} height={160} />}
      <section className="card">
        <div className="card-header"><span className="card-title">Profit &amp; loss — last 30 days</span></div>
        <div className="card-pad">
          {settled === null ? <LoadingSkeleton rows={1} height={200} /> : settled.length === 0 ? <EmptyState title="No settled bets yet" /> : (
            <Suspense fallback={<LoadingSkeleton rows={1} height={200} />}><PnlChart bets={settled} /></Suspense>
          )}
        </div>
      </section>
      <section className="card">
        <div className="card-header"><span className="card-title">Open bets</span><Link to="/account/bets" className="btn btn-ghost btn-sm">View all</Link></div>
        {open === null ? <LoadingSkeleton rows={3} /> : open.length ? <BetHistoryTable items={open} mode="open" /> : <EmptyState title="No open bets" action={<Link to="/live" className="btn btn-primary">Find a market</Link>} />}
      </section>
    </>
  );
}
