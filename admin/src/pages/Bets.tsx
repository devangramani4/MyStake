import { useState } from 'react';
import { api, type Page } from '../api';
import { BetsTable, type BetRow } from '../tables';
import { Empty, Loading, Pager, useLoad } from '../ui';

export default function Bets() {
  const [view, setView] = useState('open');
  const [status, setStatus] = useState('');
  const [side, setSide] = useState('');
  const [range, setRange] = useState('all');
  const [page, setPage] = useState(1);
  const { data } = useLoad(() => api.get<Page<BetRow>>('/admin/bets', { params: { view, status: status || undefined, side: side || undefined, range, page } }).then((r) => r.data), [view, status, side, range, page]);
  return (
    <div className="admin-page">
      <h1 className="page-title">Bets</h1>
      <div className="filters">
        <select className="select" value={view} onChange={(e) => { setView(e.target.value); setPage(1); }}><option value="open">Open</option><option value="settled">Settled</option><option value="all">All</option></select>
        <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Any status</option>{['PENDING', 'UNMATCHED', 'PARTIALLY_MATCHED', 'MATCHED', 'FAILED', 'SETTLED', 'VOIDED', 'CANCELLED', 'LAPSED'].map((s) => <option key={s}>{s}</option>)}</select>
        <select className="select" value={side} onChange={(e) => setSide(e.target.value)}><option value="">Back &amp; lay</option><option>BACK</option><option>LAY</option></select>
        <select className="select" value={range} onChange={(e) => setRange(e.target.value)}><option value="today">Today</option><option value="7d">7 days</option><option value="30d">30 days</option><option value="all">All time</option></select>
      </div>
      <p className="faint" style={{ fontSize: 12 }}>Tip: choose “All” + status FAILED or PENDING to investigate failed or unconfirmed exchange orders.</p>
      <section className="card">{!data ? <Loading /> : data.items.length ? <><BetsTable items={data.items} /><Pager {...data} onChange={setPage} /></> : <Empty text="No bets" />}</section>
    </div>
  );
}
