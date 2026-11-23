import { api } from '../api';
import { Badge, dt, Loading, useLoad } from '../ui';

interface Health { status: { mode: string; sessionValid: boolean; streamConnected: boolean; lastError: string | null; lastSuccessAt: number | null }; lastHour: Array<{ operation: string; status: string; calls: number; avgMs: number; lastAt: string }> }

export default function ApiStatus() {
  const { data, reload } = useLoad(() => api.get<Health>('/admin/api-health').then((r) => r.data), []);
  if (!data) return <Loading />;
  const s = data.status;
  return (
    <div className="admin-page">
      <div className="row between"><h1 className="page-title">Exchange API status</h1><button className="btn btn-secondary btn-sm" onClick={reload}>Refresh</button></div>
      <div className="stats">
        <div className="card stat"><span className="stat-label">Mode</span><span className="stat-value"><Badge v={s.mode.toUpperCase()} /></span></div>
        <div className="card stat"><span className="stat-label">Session</span><span className="stat-value"><Badge v={s.sessionValid ? 'ACTIVE' : 'FAILED'} /></span></div>
        <div className="card stat"><span className="stat-label">Price stream</span><span className="stat-value"><Badge v={s.streamConnected ? 'ACTIVE' : 'FAILED'} /></span></div>
        <div className="card stat"><span className="stat-label">Last error</span><span className="stat-value" style={{ fontSize: 14 }}>{s.lastError ?? 'None'}</span></div>
        <div className="card stat"><span className="stat-label">Last success</span><span className="stat-value" style={{ fontSize: 14 }}>{s.lastSuccessAt ? dt(new Date(s.lastSuccessAt).toISOString()) : '—'}</span></div>
      </div>
      <section className="card">
        <div className="card-header"><span className="card-title">Calls in the last hour</span></div>
        {!data.lastHour.length ? <div className="state"><p>No calls logged{s.mode === 'mock' ? ' (mock mode does not log calls)' : ''}.</p></div> : (
          <table className="table"><thead><tr><th>Operation</th><th>Status</th><th className="r">Calls</th><th className="r">Avg ms</th><th>Last</th></tr></thead>
            <tbody>{data.lastHour.map((r) => <tr key={r.operation + r.status}><td>{r.operation}</td><td><Badge v={r.status === 'OK' ? 'SUCCESS' : 'FAILED'} /></td><td className="r num">{r.calls}</td><td className="r num">{r.avgMs}</td><td className="muted">{dt(r.lastAt)}</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
