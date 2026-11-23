import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Page } from '../api';
import { Badge, dt, Empty, Loading, money, Pager, useLoad } from '../ui';

interface Row { id: number; uuid: string; email: string; username: string; status: string; kycStatus: string; country: string | null; createdAt: string; lastLoginAt: string | null; balance: string; exposure: string; emailVerified: number }

export default function Users() {
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [kyc, setKyc] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useLoad(() => api.get<Page<Row>>('/admin/users', { params: { search: search || undefined, status: status || undefined, kyc: kyc || undefined, page } }).then((r) => r.data), [search, status, kyc, page]);
  return (
    <div className="admin-page">
      <h1 className="page-title">Users</h1>
      <div className="filters">
        <input className="input" placeholder="Search email, username, name, UUID" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ minWidth: 280 }} />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{['ACTIVE', 'SUSPENDED', 'CLOSED', 'SELF_EXCLUDED'].map((s) => <option key={s}>{s}</option>)}</select>
        <select className="select" value={kyc} onChange={(e) => setKyc(e.target.value)}><option value="">Any KYC</option>{['NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED'].map((s) => <option key={s}>{s}</option>)}</select>
      </div>
      <section className="card">
        {!data ? <Loading /> : !data.items.length ? <Empty text="No users match" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>ID</th><th>User</th><th>Status</th><th>KYC</th><th>Country</th><th className="r">Balance</th><th className="r">Exposure</th><th>Joined</th><th>Last login</th></tr></thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id} className="clickable" onClick={() => nav(`/users/${u.id}`)}>
                    <td className="faint">{u.id}</td>
                    <td><b>{u.username}</b><div className="faint" style={{ fontSize: 12 }}>{u.email} {!u.emailVerified && '· unverified'}</div></td>
                    <td><Badge v={u.status} /></td><td><Badge v={u.kycStatus} /></td><td>{u.country ?? '—'}</td>
                    <td className="r num">{money(u.balance)}</td><td className="r num">{money(u.exposure)}</td><td className="muted">{dt(u.createdAt)}</td><td className="muted">{dt(u.lastLoginAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager {...data} onChange={setPage} />
          </div>
        )}
      </section>
    </div>
  );
}
