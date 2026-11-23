import { useState } from 'react';
import { api, errMsg } from '../api';
import { useAuth } from '../auth';
import { Badge, dt, Loading, Modal, useLoad } from '../ui';

interface AdminRow { id: number; email: string; name: string; role: string; isActive: number; twoFactorEnabled: number; lastLoginAt: string | null }
const ROLES = ['SUPER_ADMIN', 'ADMIN', 'RISK_MANAGER', 'SUPPORT'];

export default function Admins() {
  const { admin: me } = useAuth();
  const { data, reload } = useLoad(() => api.get<{ items: AdminRow[] }>('/admin/admins').then((r) => r.data.items), []);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ email: '', name: '', password: '', role: 'SUPPORT' });
  const [error, setError] = useState<string | null>(null);
  const update = (id: number, body: object) => api.patch(`/admin/admins/${id}`, body).then(reload).catch((e) => setError(errMsg(e)));
  const create = () => api.post('/admin/admins', f).then(() => { setCreating(false); setF({ email: '', name: '', password: '', role: 'SUPPORT' }); void reload(); }).catch((e) => setError(errMsg(e)));
  return (
    <div className="admin-page">
      <div className="row between"><h1 className="page-title">Admin users</h1><button className="btn btn-primary" onClick={() => setCreating(true)}>Add admin</button></div>
      {error && <div className="alert alert-danger">{error}</div>}
      <section className="card">
        {!data ? <Loading /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>2FA</th><th>Status</th><th>Last login</th></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td><td>{a.email}</td>
                <td>{a.id === me?.id ? <Badge v={a.role} /> : <select className="select" style={{ height: 32, width: 'auto' }} value={a.role} onChange={(e) => update(a.id, { role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>}</td>
                <td>{a.twoFactorEnabled ? 'On' : 'Off'}</td>
                <td>{a.id === me?.id ? <Badge v="ACTIVE" /> : <button className={`btn btn-sm ${a.isActive ? 'btn-secondary' : 'btn-danger'}`} onClick={() => update(a.id, { isActive: !a.isActive })}>{a.isActive ? 'Active' : 'Disabled'}</button>}</td>
                <td className="muted">{dt(a.lastLoginAt)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <section className="card card-pad">
        <b>Role permissions</b>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.8 }}>
          <li><b>SUPER_ADMIN</b> — everything, including platform settings and admin users.</li>
          <li><b>ADMIN</b> — users, bets, markets, settlement, finance and wallet adjustments.</li>
          <li><b>RISK_MANAGER</b> — view all; suspend users, set limits/restrictions, review alerts.</li>
          <li><b>SUPPORT</b> — read-only access to users, bets and transactions.</li>
        </ul>
      </section>
      {creating && (
        <Modal title="Add admin" onClose={() => setCreating(false)} footer={<button className="btn btn-primary" onClick={create}>Create</button>}>
          {(['name', 'email', 'password'] as const).map((k) => <div key={k} className="field"><label>{k}</label><input className="input" type={k === 'password' ? 'password' : 'text'} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}
          <div className="field"><label>Role</label><select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
        </Modal>
      )}
    </div>
  );
}
