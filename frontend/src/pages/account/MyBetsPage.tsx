import { useEffect, useState } from 'react';
import { BetHistoryTable } from '../../components/account/BetHistoryTable';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/ui/States';
import { useSports } from '../../hooks/useSports';
import { betsApi } from '../../services/api/accountApi';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { toast } from '../../store/slices/uiSlice';
import { fetchWallet } from '../../store/slices/walletSlice';
import type { BetItem, Page } from '../../types';
import { errorMessage } from '../../utils/errors';

type View = 'open' | 'settled' | 'all';

export default function MyBetsPage() {
  const dispatch = useAppDispatch();
  const { sports } = useSports();
  const version = useAppSelector((s) => s.ui.betsVersion);
  const [view, setView] = useState<View>('open');
  const [range, setRange] = useState('7d');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sport, setSport] = useState('');
  const [side, setSide] = useState('');
  const [result, setResult] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<BetItem> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setPage(1), [view, range, from, to, sport, side, result]);
  useEffect(() => {
    if (range === 'custom' && (!from || !to)) return;
    setError(null);
    betsApi
      .list({
        view, range: view === 'open' ? 'all' : range, page, pageSize: 20, sport: sport || undefined, side: side || undefined, result: view !== 'open' && result ? result : undefined,
        from: range === 'custom' ? new Date(from).toISOString() : undefined, to: range === 'custom' ? new Date(`${to}T23:59:59`).toISOString() : undefined,
      })
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [view, range, from, to, sport, side, result, page, version]);

  const cancel = (b: BetItem) =>
    betsApi.cancel(b.id).then(() => {
      dispatch(toast({ kind: 'success', title: 'Unmatched stake cancelled' }));
      dispatch(fetchWallet());
      setData((d) => (d ? { ...d, items: d.items.filter((x) => x.id !== b.id) } : d));
    }).catch((e) => dispatch(toast({ kind: 'error', title: 'Could not cancel', message: errorMessage(e) })));

  return (
    <>
      <h1 className="page-title">My bets</h1>
      <div className="tabs" role="tablist">
        {(['open', 'settled', 'all'] as const).map((v) => <button key={v} role="tab" aria-selected={view === v} className={`tab ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>{v === 'open' ? 'Open bets' : v === 'settled' ? 'Settled bets' : 'Bet history'}</button>)}
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        {view !== 'open' && (
          <select className="select" style={{ width: 'auto', height: 36 }} value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
            <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="custom">Custom dates</option><option value="all">All time</option>
          </select>
        )}
        {view !== 'open' && range === 'custom' && (
          <>
            <input type="date" className="input" style={{ width: 'auto', height: 36 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <input type="date" className="input" style={{ width: 'auto', height: 36 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </>
        )}
        <select className="select" style={{ width: 'auto', height: 36 }} value={sport} onChange={(e) => setSport(e.target.value)} aria-label="Sport">
          <option value="">All sports</option>{sports.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
        </select>
        <select className="select" style={{ width: 'auto', height: 36 }} value={side} onChange={(e) => setSide(e.target.value)} aria-label="Back or lay">
          <option value="">Back &amp; lay</option><option value="BACK">Back</option><option value="LAY">Lay</option>
        </select>
        {view !== 'open' && (
          <select className="select" style={{ width: 'auto', height: 36 }} value={result} onChange={(e) => setResult(e.target.value)} aria-label="Result">
            <option value="">All results</option><option value="WIN">Won</option><option value="LOSS">Lost</option><option value="VOID">Void</option><option value="PARTIAL">Partial</option>
          </select>
        )}
      </div>
      <section className="card">
        {error ? <ErrorState message={error} /> : !data ? <LoadingSkeleton rows={5} /> : data.items.length === 0 ? <EmptyState title={view === 'open' ? 'No open bets' : 'No bets in this period'} /> : (
          <>
            <BetHistoryTable items={data.items} mode={view === 'open' ? 'open' : 'settled'} onCancel={cancel} />
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} />
          </>
        )}
      </section>
    </>
  );
}
