import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errMsg, type Page } from '../api';
import { useAuth } from '../auth';
import { Badge, dt, Empty, Loading, money, Pager, Toast, useLoad } from '../ui';

interface Alert { id: number; userId: number; username: string; rule: string; severity: string; details: unknown; status: string; createdAt: string }
interface Exposure { marketId: string; marketName: string; eventName: string; bets: number; liability: string; stakes: string; backs: number; lays: number; houseWorstCase: string }
type Settings = Record<string, Record<string, number | boolean>>;

function SettingsEditor() {
  const { can } = useAuth();
  const { data, reload } = useLoad(() => api.get<Settings>('/admin/settings').then((r) => r.data), []);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const s = draft ?? data;
  if (!s) return <Loading />;
  const editable = can('settings:manage');
  const save = (key: string) => api.put(`/admin/settings/${key}`, s[key]).then(() => { setMsg({ kind: 'success', text: `${key} saved` }); setDraft(null); void reload(); }).catch((e) => setMsg({ kind: 'error', text: errMsg(e) }));
  return (
    <div className="grid-2">
      <Toast msg={msg} onDone={() => setMsg(null)} />
      {Object.entries(s).map(([key, values]) => (
        <section key={key} className="card card-pad stack" style={{ gap: 10 }}>
          <div className="row between"><b>{key}</b>{editable && <button className="btn btn-sm btn-primary" onClick={() => save(key)}>Save</button>}</div>
          {Object.entries(values).map(([k, v]) => (
            <label key={k} className="row between" style={{ gap: 12 }}>
              <span className="muted" style={{ fontSize: 13 }}>{k}</span>
              {typeof v === 'boolean'
                ? <input type="checkbox" disabled={!editable} checked={v} onChange={(e) => setDraft({ ...s, [key]: { ...values, [k]: e.target.checked } })} />
                : <input className="input num" style={{ width: 140, height: 34 }} disabled={!editable} value={String(v)} onChange={(e) => setDraft({ ...s, [key]: { ...values, [k]: Number(e.target.value) } })} />}
            </label>
          ))}
        </section>
      ))}
    </div>
  );
}

export default function Risk() {
  const { can } = useAuth();
  const [status, setStatus] = useState('OPEN');
  const [page, setPage] = useState(1);
  const alerts = useLoad(() => api.get<Page<Alert>>('/admin/risk/alerts', { params: { status: status || undefined, page } }).then((r) => r.data), [status, page]);
  const exposure = useLoad(() => api.get<{ items: Exposure[] }>('/admin/risk/exposure').then((r) => r.data.items), []);
  const review = (id: number, s: string) => api.post(`/admin/risk/alerts/${id}`, { status: s }).then(alerts.reload);
  return (
    <div className="admin-page">
      <h1 className="page-title">Risk management</h1>
      <section className="card">
        <div className="card-header"><span className="card-title">Suspicious activity alerts</span>
          <select className="select" style={{ width: 'auto', height: 34 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option><option>OPEN</option><option>REVIEWED</option><option>DISMISSED</option></select>
        </div>
        {!alerts.data ? <Loading /> : !alerts.data.items.length ? <Empty text="No alerts" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>User</th><th>Rule</th><th>Severity</th><th>Details</th><th>Status</th><th>Raised</th><th /></tr></thead>
            <tbody>{alerts.data.items.map((a) => (
              <tr key={a.id}>
                <td><Link to={`/users/${a.userId}`} style={{ textDecoration: 'underline' }}>{a.username}</Link></td><td>{a.rule}</td><td><Badge v={a.severity} /></td>
                <td className="faint" style={{ fontSize: 12 }}>{typeof a.details === 'string' ? a.details : JSON.stringify(a.details)}</td><td><Badge v={a.status} /></td><td className="muted">{dt(a.createdAt)}</td>
                <td>{can('risk:manage') && a.status === 'OPEN' && <div className="row"><button className="btn btn-sm btn-secondary" onClick={() => review(a.id, 'REVIEWED')}>Reviewed</button><button className="btn btn-sm btn-ghost" onClick={() => review(a.id, 'DISMISSED')}>Dismiss</button></div>}</td>
              </tr>
            ))}</tbody>
          </table><Pager {...alerts.data} onChange={setPage} /></div>
        )}
      </section>
      <section className="card">
        <div className="card-header"><span className="card-title">Open market exposure (house worst case = most the platform can lose on the market)</span></div>
        {!exposure.data ? <Loading /> : !exposure.data.length ? <Empty text="No open exposure" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Market</th><th className="r">Bets</th><th className="r">Back / lay</th><th className="r">Stakes</th><th className="r">Customer liability</th><th className="r">House worst-case loss</th></tr></thead>
            <tbody>{exposure.data.map((x) => <tr key={x.marketId}><td><b>{x.eventName}</b><div className="faint" style={{ fontSize: 12 }}>{x.marketName} · {x.marketId}</div></td><td className="r num">{x.bets}</td><td className="r num">{x.backs} / {x.lays}</td><td className="r num">{money(x.stakes)}</td><td className="r num">{money(x.liability)}</td><td className="r num neg">{money(x.houseWorstCase)}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
      <h2 className="section-title">Platform limits &amp; settings</h2>
      <SettingsEditor />
    </div>
  );
}
