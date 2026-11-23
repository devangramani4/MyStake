import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TransactionTable } from '../../components/account/TransactionTable';
import { WalletCard } from '../../components/account/WalletCard';
import { EmptyState, LoadingSkeleton } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { walletApi, type Withdrawal } from '../../services/api/accountApi';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { toast } from '../../store/slices/uiSlice';
import { fetchWallet } from '../../store/slices/walletSlice';
import type { Transaction } from '../../types';
import { dateTime, money } from '../../utils/format';
import { errorMessage } from '../../utils/errors';

export default function WalletPage() {
  const dispatch = useAppDispatch();
  const wallet = useAppSelector((s) => s.wallet.wallet);
  const [tx, setTx] = useState<Transaction[] | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const load = () => {
    dispatch(fetchWallet());
    walletApi.transactions({ pageSize: 10, range: 'all' }).then((p) => setTx(p.items)).catch(() => setTx([]));
    walletApi.withdrawals().then((p) => setWithdrawals(p.items.filter((w) => w.status === 'PENDING'))).catch(() => undefined);
  };
  useEffect(load, [dispatch, wallet?.balance]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <h1 className="page-title">Wallet</h1>
      {wallet ? <WalletCard wallet={wallet} /> : <LoadingSkeleton rows={1} height={160} />}
      {withdrawals.length > 0 && (
        <section className="card">
          <div className="card-header"><span className="card-title">Pending withdrawals</span></div>
          {withdrawals.map((w) => (
            <div key={w.id} className="mcard" style={{ display: 'flex' }}>
              <div className="row between"><b className="num">{money(w.amount)}</b><StatusBadge status={w.status} /></div>
              <div className="row between"><span className="faint">{w.method.replace('_', ' ')} {w.destination} · {dateTime(w.createdAt)}</span>
                <button className="btn btn-sm btn-secondary" onClick={() => walletApi.cancelWithdrawal(w.id).then(() => { dispatch(toast({ kind: 'success', title: 'Withdrawal cancelled' })); load(); }).catch((e) => dispatch(toast({ kind: 'error', title: errorMessage(e) })))}>Cancel</button>
              </div>
            </div>
          ))}
        </section>
      )}
      <section className="card">
        <div className="card-header"><span className="card-title">Recent transactions</span><Link className="btn btn-ghost btn-sm" to="/account/transactions">Full ledger</Link></div>
        {tx === null ? <LoadingSkeleton rows={4} /> : tx.length ? <TransactionTable items={tx} /> : <EmptyState title="No transactions yet" action={<Link to="/account/wallet/deposit" className="btn btn-primary">Make a deposit</Link>} />}
      </section>
    </>
  );
}
