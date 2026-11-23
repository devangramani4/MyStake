import { useEffect, useState } from 'react';
import { TransactionTable } from '../../components/account/TransactionTable';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/ui/States';
import { walletApi } from '../../services/api/accountApi';
import type { Page, Transaction } from '../../types';
import { errorMessage } from '../../utils/errors';

const TYPES = ['DEPOSIT', 'WITHDRAWAL', 'BET', 'WIN', 'LOSS', 'REFUND', 'COMMISSION', 'ADJUSTMENT'];

export default function TransactionsPage() {
  const [type, setType] = useState('');
  const [range, setRange] = useState('30d');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Transaction> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setPage(1), [type, range]);
  useEffect(() => {
    walletApi.transactions({ type: type || undefined, range, page, pageSize: 25 }).then(setData).catch((e) => setError(errorMessage(e)));
  }, [type, range, page]);
  return (
    <>
      <div>
        <h1 className="page-title">Transactions</h1>
        <p className="page-sub">Every change to your balance is recorded in an append-only ledger.</p>
      </div>
      <div className="row wrap">
        <select className="select" style={{ width: 'auto', height: 36 }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{t[0] + t.slice(1).toLowerCase()}</option>)}
        </select>
        <select className="select" style={{ width: 'auto', height: 36 }} value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
          <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">All time</option>
        </select>
      </div>
      <section className="card">
        {error ? <ErrorState message={error} /> : !data ? <LoadingSkeleton rows={6} /> : !data.items.length ? <EmptyState title="No transactions" /> : (
          <><TransactionTable items={data.items} /><Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} /></>
        )}
      </section>
    </>
  );
}
