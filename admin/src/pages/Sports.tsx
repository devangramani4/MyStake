import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { api, type Page } from '../api';
import { useAuth } from '../auth';
import { Badge, dt, Empty, Loading, Modal, money, Pager, ReasonModal, Toast, useLoad } from '../ui';

interface SportRow { id: number; betfairId: string; name: string; slug: string; isEnabled: number; marketCount: number }
interface EventRow { id: number; betfairId: string; name: string; openDate: string; status: string; isEnabled: number; isFeatured: number; sport: string; competition: string | null; markets: number; bets: number }
interface MarketRow { id: number; betfairId: string; name: string; marketType: string; status: string; inPlay: number; adminSuspended: number; isEnabled: number; settledAt: string | null; totalMatched: string; bets: number; openLiability: string; runners: Array<{ selectionId: number; name: string; status: string }> }

function EventMarkets({ event, onClose }: { event: EventRow; onClose: () => void }) {
  const { can } = useAuth();
  const { data, reload } = useLoad(() => api.get<{ items: MarketRow[] }>(`/admin/events/${event.id}/markets`).then((r) => r.data.items), [event.id]);
  const [settle, setSettle] = useState<MarketRow | null>(null);
  const [winner, setWinner] = useState<string>('');
  const flag = (m: MarketRow, field: string, value: boolean) => api.post(`/admin/markets/${m.id}/flags`, { field, value, reason: 'admin console' }).then(reload);
  return (
    <Modal title={event.name} onClose={onClose}>
      {!data ? <Loading /> : data.map((m) => (
        <div key={m.id} className="card" style={{ padding: 12 }}>
          <div className="row between wrap">
            <b>{m.name}</b>
            <span className="row"><Badge v={m.adminSuspended ? 'SUSPENDED' : m.status} />{m.inPlay ? <Badge v="IN_PLAY" /> : null}{m.settledAt && <span className="badge">settled</span>}</span>
          </div>
          <div className="faint" style={{ fontSize: 12, margin: '4px 0 8px' }}>{m.betfairId} · {m.bets} bets · open liability {money(m.openLiability)} · matched {money(m.totalMatched)}</div>
          <div className="faint" style={{ fontSize: 12 }}>{m.runners.map((r) => `${r.name}${r.status !== 'ACTIVE' ? ` (${r.status})` : ''}`).join(' · ')}</div>
          {can('sports:manage') && (
            <div className="row wrap" style={{ marginTop: 8 }}>
              <button className="btn btn-sm btn-secondary" onClick={() => flag(m, 'admin_suspended', !m.adminSuspended)}>{m.adminSuspended ? 'Unsuspend' : 'Suspend betting'}</button>
              <button className="btn btn-sm btn-secondary" onClick={() => flag(m, 'is_enabled', !m.isEnabled)}>{m.isEnabled ? 'Hide market' : 'Show market'}</button>
              {can('bets:manage') && !m.settledAt && <button className="btn btn-sm btn-danger" onClick={() => { setWinner(''); setSettle(m); }}>Manual settle / void</button>}
            </div>
          )}
        </div>
      ))}
      {settle && (
        <ReasonModal title={`Settle ${settle.name}`} confirm={winner === 'VOID' ? 'Void market' : 'Settle market'} danger onClose={() => setSettle(null)}
          onSubmit={(reason) => api.post(`/admin/markets/${settle.id}/settle`, { winners: winner === 'VOID' ? 'VOID' : [Number(winner)], reason }).then(reload)}>
          <div className="alert alert-warning">Manual settlement pays out immediately and cannot be undone. Use only when the exchange result is unavailable or disputed.</div>
          <select className="select" value={winner} onChange={(e) => setWinner(e.target.value)}>
            <option value="">Select winner…</option>
            {settle.runners.map((r) => <option key={r.selectionId} value={r.selectionId}>{r.name}</option>)}
            <option value="VOID">VOID — refund all bets</option>
          </select>
        </ReasonModal>
      )}
    </Modal>
  );
}

export default function Sports() {
  const { can } = useAuth();
  const sports = useLoad(() => api.get<{ items: SportRow[] }>('/admin/sports').then((r) => r.data.items), []);
  const [sport, setSport] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<EventRow | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const events = useLoad(() => api.get<Page<EventRow>>('/admin/events', { params: { sport: sport || undefined, status: status || undefined, search: search || undefined, page } }).then((r) => r.data), [sport, status, search, page]);
  const toggle = (path: string, field: string, value: boolean) => api.post(path, { field, value }).then(() => { void sports.reload(); void events.reload(); });

  return (
    <div className="admin-page">
      <Toast msg={toast} onDone={() => setToast(null)} />
      <div className="row between"><h1 className="page-title">Sports &amp; markets</h1>
        {can('sports:manage') && <button className="btn btn-secondary" onClick={() => api.post('/admin/catalogue/sync').then(() => setToast({ kind: 'success', text: 'Catalogue synced from exchange' }))}><RefreshCw size={14} /> Sync catalogue</button>}
      </div>
      <section className="card">
        <div className="card-header"><span className="card-title">Sports</span></div>
        {!sports.data ? <Loading /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Sport</th><th>Exchange ID</th><th className="r">Markets</th><th>Enabled</th></tr></thead>
            <tbody>{sports.data.map((s) => (
              <tr key={s.id}><td>{s.name}</td><td className="faint">{s.betfairId}</td><td className="r num">{s.marketCount}</td>
                <td>{can('sports:manage') ? <button className={`btn btn-sm ${s.isEnabled ? 'btn-secondary' : 'btn-danger'}`} onClick={() => toggle(`/admin/sports/${s.id}/flags`, 'is_enabled', !s.isEnabled)}>{s.isEnabled ? 'Enabled' : 'Disabled'}</button> : <Badge v={s.isEnabled ? 'ACTIVE' : 'CLOSED'} />}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <div className="filters">
        <select className="select" value={sport} onChange={(e) => { setSport(e.target.value); setPage(1); }}><option value="">All sports</option>{sports.data?.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select>
        <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Any status</option>{['UPCOMING', 'IN_PLAY', 'CLOSED'].map((s) => <option key={s}>{s}</option>)}</select>
        <input className="input" placeholder="Search events" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>
      <section className="card">
        {!events.data ? <Loading /> : !events.data.items.length ? <Empty /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Event</th><th>Sport</th><th>Start</th><th>Status</th><th className="r">Markets</th><th className="r">Bets</th><th>Featured</th><th>Visible</th><th /></tr></thead>
            <tbody>{events.data.items.map((e) => (
              <tr key={e.id}>
                <td><b>{e.name}</b><div className="faint" style={{ fontSize: 12 }}>{e.competition} · {e.betfairId}</div></td><td>{e.sport}</td><td className="muted">{dt(e.openDate)}</td><td><Badge v={e.status} /></td>
                <td className="r num">{e.markets}</td><td className="r num">{e.bets}</td>
                <td>{can('sports:manage') ? <input type="checkbox" aria-label="Featured" checked={!!e.isFeatured} onChange={() => toggle(`/admin/events/${e.id}/flags`, 'is_featured', !e.isFeatured)} /> : e.isFeatured ? 'Yes' : ''}</td>
                <td>{can('sports:manage') ? <input type="checkbox" aria-label="Visible" checked={!!e.isEnabled} onChange={() => toggle(`/admin/events/${e.id}/flags`, 'is_enabled', !e.isEnabled)} /> : e.isEnabled ? 'Yes' : 'No'}</td>
                <td><button className="btn btn-sm btn-secondary" onClick={() => setOpen(e)}>Markets</button></td>
              </tr>
            ))}</tbody>
          </table><Pager {...events.data} onChange={setPage} /></div>
        )}
      </section>
      {open && <EventMarkets event={open} onClose={() => { setOpen(null); void events.reload(); }} />}
    </div>
  );
}
