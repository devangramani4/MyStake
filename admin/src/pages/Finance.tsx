import { useState } from 'react';
import { api, type Page } from '../api';
import { useAuth } from '../auth';
import { TxTable, type TxRow } from '../tables';
import { Badge, dt, Empty, Loading, money, Pager, ReasonModal, useLoad } from '../ui';

interface Payment { id: string; userId: number; username: string; kycStatus: string; amount: string; currency: string; status: string; provider?: string; method?: string; destination_masked?: string; created_at: string }
type Review = null | { kind: 'deposits' | 'withdrawals'; row: Payment; decision: string };

function Payments({ kind }: { kind: 'deposits' | 'withdrawals' }) {
  const { can } = useAuth();
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [review, setReview] = useState<Review>(null);
  const { data, reload } = useLoad(() => api.get<Page<Payment>>(`/admin/${kind}`, { params: { status: status || undefined, page } }).then((r) => r.data), [kind, status, page]);
  const statuses = kind === 'deposits' ? ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'] : ['PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'CANCELLED'];
  return (
    <>
      <div className="filters"><select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Any status</option>{statuses.map((s) => <option key={s}>{s}</option>)}</select></div>
      <section className="card">
        {!data ? <Loading /> : !data.items.length ? <Empty /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Reference</th><th>User</th><th className="r">Amount</th><th>{kind === 'deposits' ? 'Provider' : 'Method'}</th><th>KYC</th><th>Status</th><th>Created</th><th /></tr></thead>
            <tbody>{data.items.map((p) => (
              <tr key={p.id}>
                <td className="faint">{p.id.slice(0, 8).toUpperCase()}</td><td>{p.username}</td><td className="r num">{money(p.amount)}</td>
                <td>{kind === 'deposits' ? p.provider : `${p.method} ${p.destination_masked ?? ''}`}</td><td><Badge v={p.kycStatus} /></td><td><Badge v={p.status} /></td><td className="muted">{dt(p.created_at)}</td>
                <td>{can('finance:manage') && p.status === 'PENDING' && (
                  <div className="row">
                    <button className="btn btn-sm btn-primary" onClick={() => setReview({ kind, row: p, decision: kind === 'deposits' ? 'CONFIRM' : 'APPROVE' })}>{kind === 'deposits' ? 'Confirm' : 'Approve'}</button>
                    <button className="btn btn-sm btn-danger" onClick={() => setReview({ kind, row: p, decision: kind === 'deposits' ? 'FAIL' : 'REJECT' })}>{kind === 'deposits' ? 'Fail' : 'Reject'}</button>
                  </div>
                )}</td>
              </tr>
            ))}</tbody>
          </table><Pager {...data} onChange={setPage} /></div>
        )}
      </section>
      {review && (
        <ReasonModal title={`${review.decision} ${review.kind === 'deposits' ? 'deposit' : 'withdrawal'} of ${money(review.row.amount)}`} confirm={review.decision} danger={['FAIL', 'REJECT'].includes(review.decision)} onClose={() => setReview(null)}
          onSubmit={(reason) => api.post(`/admin/${review.kind}/${review.row.id}/review`, review.kind === 'deposits' ? { decision: review.decision, reason } : { decision: review.decision, note: reason }).then(reload)}>
          {review.decision === 'CONFIRM' && <div className="alert alert-info">Only confirm after funds are verified as received.</div>}
          {review.decision === 'REJECT' && <div className="alert alert-info">The amount is returned to the user's available balance.</div>}
        </ReasonModal>
      )}
    </>
  );
}

function Ledger() {
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useLoad(() => api.get<Page<TxRow>>('/admin/transactions', { params: { type: type || undefined, search: search || undefined, page } }).then((r) => r.data), [type, search, page]);
  return (
    <>
      <div className="filters">
        <select className="select" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}><option value="">All types</option>{['DEPOSIT', 'WITHDRAWAL', 'BET', 'WIN', 'LOSS', 'REFUND', 'COMMISSION', 'ADJUSTMENT'].map((t) => <option key={t}>{t}</option>)}</select>
        <input className="input" placeholder="User email / username" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>
      <section className="card">{!data ? <Loading /> : data.items.length ? <><TxTable items={data.items} showUser /><Pager {...data} onChange={setPage} /></> : <Empty />}</section>
    </>
  );
}

export default function Finance() {
  const [tab, setTab] = useState<'withdrawals' | 'deposits' | 'ledger'>('withdrawals');
  return (
    <div className="admin-page">
      <h1 className="page-title">Finance</h1>
      <div className="tabs">{(['withdrawals', 'deposits', 'ledger'] as const).map((t) => <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t === 'ledger' ? 'Transaction ledger' : t[0].toUpperCase() + t.slice(1)}</button>)}</div>
      {tab === 'ledger' ? <Ledger /> : <Payments key={tab} kind={tab} />}
    </div>
  );
}
