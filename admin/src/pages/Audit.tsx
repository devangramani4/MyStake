import { useState } from 'react';
import { api, type Page } from '../api';
import { Badge, dt, Empty, Loading, Pager, useLoad } from '../ui';

interface Row { id: number; actorType: string; actorId: number | null; action: string; targetType: string | null; targetId: string | null; beforeState: unknown; afterState: unknown; reason: string | null; ip: string | null; createdAt: string }
const j = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));

export default function Audit() {
  const [actorType, setActorType] = useState('ADMIN');
  const [action, setAction] = useState('');
  const [targetId, setTargetId] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useLoad(() => api.get<Page<Row>>('/admin/audit-logs', { params: { actorType: actorType || undefined, action: action || undefined, targetId: targetId || undefined, page } }).then((r) => r.data), [actorType, action, targetId, page]);
  return (
    <div className="admin-page">
      <h1 className="page-title">Audit log</h1>
      <div className="filters">
        <select className="select" value={actorType} onChange={(e) => { setActorType(e.target.value); setPage(1); }}><option value="">Any actor</option><option>ADMIN</option><option>USER</option><option>SYSTEM</option></select>
        <input className="input" placeholder="Action e.g. WALLET_ADJUSTMENT" value={action} onChange={(e) => { setAction(e.target.value.toUpperCase()); setPage(1); }} />
        <input className="input" placeholder="Target ID" value={targetId} onChange={(e) => { setTargetId(e.target.value); setPage(1); }} />
      </div>
      <section className="card">
        {!data ? <Loading /> : !data.items.length ? <Empty /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Change</th><th>Reason</th><th>IP</th></tr></thead>
            <tbody>{data.items.map((r) => (
              <tr key={r.id}>
                <td className="muted">{dt(r.createdAt)}</td><td><Badge v={r.actorType} /> {r.actorId}</td><td><b>{r.action}</b></td><td className="muted">{r.targetType} {r.targetId}</td>
                <td className="faint" style={{ fontSize: 12, maxWidth: 320 }}>{r.beforeState ? <div>before: {j(r.beforeState)}</div> : null}{r.afterState ? <div>after: {j(r.afterState)}</div> : null}</td>
                <td>{r.reason}</td><td className="faint">{r.ip}</td>
              </tr>
            ))}</tbody>
          </table><Pager {...data} onChange={setPage} /></div>
        )}
      </section>
    </div>
  );
}
