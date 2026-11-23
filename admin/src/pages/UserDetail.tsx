import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, idem, type Page } from '../api';
import { useAuth } from '../auth';
import { BetsTable, TxTable, type BetRow, type TxRow } from '../tables';
import { Badge, dt, Empty, Loading, money, Pager, ReasonModal, Toast, useLoad } from '../ui';

interface Detail {
  internalId: number; id: string; email: string; username: string; firstName: string | null; lastName: string | null; status: string; emailVerified: boolean; kycStatus: string;
  twoFactorEnabled: boolean; dateOfBirth: string | null; country: string | null; createdAt: string; lastLoginAt: string | null; failedLogins: number;
  wallet: { balance: string; exposure: string; total: string; currency: string };
  stats: { bets: number; stakes: string; profitLoss: string };
  limits: Record<string, string | number | null>;
  alerts: Array<{ id: number; rule: string; severity: string; status: string; createdAt: string }>;
}

type Action = null | { kind: 'status'; status: string } | { kind: 'kyc' } | { kind: 'adjust' } | { kind: 'limits' };
const LIMIT_FIELDS = ['max_stake', 'max_exposure', 'daily_deposit_limit', 'weekly_deposit_limit', 'monthly_deposit_limit', 'daily_loss_limit'];

export default function UserDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: u, reload } = useLoad(() => api.get<Detail>(`/admin/users/${id}`).then((r) => r.data), [id]);
  const [tab, setTab] = useState<'bets' | 'tx' | 'alerts'>('bets');
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<Action>(null);
  const [amount, setAmount] = useState('');
  const [kyc, setKyc] = useState('VERIFIED');
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState({ betting_restricted: false, withdrawals_restricted: false });
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const bets = useLoad(() => (tab === 'bets' ? api.get<Page<BetRow>>(`/admin/users/${id}/bets`, { params: { page } }).then((r) => r.data) : Promise.resolve(null)), [id, tab, page]);
  const tx = useLoad(() => (tab === 'tx' ? api.get<Page<TxRow>>(`/admin/users/${id}/transactions`, { params: { page } }).then((r) => r.data) : Promise.resolve(null)), [id, tab, page]);

  if (!u) return <Loading />;
  const done = (text: string) => { setToast({ kind: 'success', text }); void reload(); };
  const openLimits = () => {
    setLimits(Object.fromEntries(LIMIT_FIELDS.map((f) => [f, u.limits[f] === null ? '' : String(u.limits[f])])));
    setFlags({ betting_restricted: !!u.limits.betting_restricted, withdrawals_restricted: !!u.limits.withdrawals_restricted });
    setAction({ kind: 'limits' });
  };

  return (
    <div className="admin-page">
      <Toast msg={toast} onDone={() => setToast(null)} />
      <Link to="/users" className="muted row"><ArrowLeft size={14} /> Users</Link>
      <div className="row between wrap">
        <div>
          <h1 className="page-title">{u.username} <Badge v={u.status} /></h1>
          <p className="muted">{u.email} · {u.firstName} {u.lastName} · #{u.internalId}</p>
        </div>
        <div className="row wrap">
          {can('users:manage') && u.status === 'ACTIVE' && <button className="btn btn-danger" onClick={() => setAction({ kind: 'status', status: 'SUSPENDED' })}>Suspend</button>}
          {can('users:manage') && u.status !== 'ACTIVE' && <button className="btn btn-secondary" onClick={() => setAction({ kind: 'status', status: 'ACTIVE' })}>Activate</button>}
          {can('users:manage') && <button className="btn btn-secondary" onClick={() => setAction({ kind: 'kyc' })}>Set KYC</button>}
          {can('risk:manage') && <button className="btn btn-secondary" onClick={openLimits}>Limits &amp; restrictions</button>}
          {can('wallet:adjust') && <button className="btn btn-primary" onClick={() => setAction({ kind: 'adjust' })}>Manual adjustment</button>}
        </div>
      </div>
      <div className="stats">
        <div className="card stat"><span className="stat-label">Balance</span><span className="stat-value num">{money(u.wallet.balance)}</span></div>
        <div className="card stat"><span className="stat-label">Exposure</span><span className="stat-value num">{money(u.wallet.exposure)}</span></div>
        <div className="card stat"><span className="stat-label">Bets / stakes</span><span className="stat-value num">{u.stats.bets} · {money(u.stats.stakes)}</span></div>
        <div className="card stat"><span className="stat-label">Net P/L</span><span className={`stat-value num ${Number(u.stats.profitLoss) >= 0 ? 'pos' : 'neg'}`}>{money(u.stats.profitLoss)}</span></div>
      </div>
      <section className="card card-pad kvs">
        <div><small>KYC</small><Badge v={u.kycStatus} /></div>
        <div><small>Email verified</small>{u.emailVerified ? 'Yes' : 'No'}</div>
        <div><small>2FA</small>{u.twoFactorEnabled ? 'Enabled' : 'Off'}</div>
        <div><small>Date of birth</small>{u.dateOfBirth ? String(u.dateOfBirth).slice(0, 10) : '—'}</div>
        <div><small>Country</small>{u.country ?? '—'}</div>
        <div><small>Joined</small>{dt(u.createdAt)}</div>
        <div><small>Last login</small>{dt(u.lastLoginAt)}</div>
        <div><small>Self-excluded until</small>{dt(u.limits.self_excluded_until)}</div>
        <div><small>Max stake / exposure</small>{u.limits.max_stake ? money(u.limits.max_stake) : '—'} / {u.limits.max_exposure ? money(u.limits.max_exposure) : '—'}</div>
        <div><small>Restrictions</small>{u.limits.betting_restricted ? 'Betting ' : ''}{u.limits.withdrawals_restricted ? 'Withdrawals' : ''}{!u.limits.betting_restricted && !u.limits.withdrawals_restricted ? 'None' : ''}</div>
      </section>
      <div className="tabs">
        {(['bets', 'tx', 'alerts'] as const).map((t) => <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => { setTab(t); setPage(1); }}>{t === 'bets' ? 'Bets' : t === 'tx' ? 'Transactions' : `Risk alerts (${u.alerts.length})`}</button>)}
      </div>
      <section className="card">
        {tab === 'bets' && (!bets.data ? <Loading /> : bets.data.items.length ? <><BetsTable items={bets.data.items} /><Pager {...bets.data} onChange={setPage} /></> : <Empty text="No bets" />)}
        {tab === 'tx' && (!tx.data ? <Loading /> : tx.data.items.length ? <><TxTable items={tx.data.items} /><Pager {...tx.data} onChange={setPage} /></> : <Empty text="No transactions" />)}
        {tab === 'alerts' && (u.alerts.length ? (
          <table className="table"><thead><tr><th>Rule</th><th>Severity</th><th>Status</th><th>Raised</th></tr></thead><tbody>{u.alerts.map((a) => <tr key={a.id}><td>{a.rule}</td><td><Badge v={a.severity} /></td><td><Badge v={a.status} /></td><td>{dt(a.createdAt)}</td></tr>)}</tbody></table>
        ) : <Empty text="No alerts" />)}
      </section>

      {action?.kind === 'status' && (
        <ReasonModal title={`${action.status === 'ACTIVE' ? 'Activate' : 'Suspend'} ${u.username}`} confirm="Confirm" danger={action.status !== 'ACTIVE'} onClose={() => setAction(null)}
          onSubmit={(reason) => api.post(`/admin/users/${u.internalId}/status`, { status: action.status, reason }).then(() => done('Status updated'))}>
          {action.status !== 'ACTIVE' && <div className="alert alert-warning">The user will be signed out of every device immediately.</div>}
        </ReasonModal>
      )}
      {action?.kind === 'kyc' && (
        <ReasonModal title="Update KYC status" confirm="Save" onClose={() => setAction(null)} onSubmit={(reason) => api.post(`/admin/users/${u.internalId}/kyc`, { kycStatus: kyc, reason }).then(() => done('KYC updated'))}>
          <select className="select" value={kyc} onChange={(e) => setKyc(e.target.value)}>{['NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED'].map((s) => <option key={s}>{s}</option>)}</select>
        </ReasonModal>
      )}
      {action?.kind === 'adjust' && (
        <ReasonModal title="Manual wallet adjustment" confirm="Apply adjustment" onClose={() => setAction(null)}
          onSubmit={(reason) => api.post(`/admin/users/${u.internalId}/adjustments`, { amount: Number(amount), reason }, { headers: { 'Idempotency-Key': idem() } }).then(() => { setAmount(''); done('Adjustment applied'); })}>
          <div className="alert alert-info">Positive credits the user, negative debits. Recorded in the ledger as ADJUSTMENT and in the audit log.</div>
          <div className="field"><label htmlFor="amt">Amount</label><input id="amt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.-]/g, ''))} /></div>
        </ReasonModal>
      )}
      {action?.kind === 'limits' && (
        <ReasonModal title="Limits & restrictions" confirm="Save" onClose={() => setAction(null)}
          onSubmit={(reason) => api.post(`/admin/users/${u.internalId}/restrictions`, { ...Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, v === '' ? null : Number(v)])), ...flags, reason }).then(() => done('Limits saved'))}>
          <div className="grid-2">
            {LIMIT_FIELDS.map((f) => <div className="field" key={f}><label>{f.replace(/_/g, ' ')}</label><input className="input" inputMode="decimal" placeholder="none" value={limits[f] ?? ''} onChange={(e) => setLimits({ ...limits, [f]: e.target.value.replace(/[^\d.]/g, '') })} /></div>)}
          </div>
          <label className="checkbox"><input type="checkbox" checked={flags.betting_restricted} onChange={(e) => setFlags({ ...flags, betting_restricted: e.target.checked })} /> Restrict betting</label>
          <label className="checkbox"><input type="checkbox" checked={flags.withdrawals_restricted} onChange={(e) => setFlags({ ...flags, withdrawals_restricted: e.target.checked })} /> Restrict withdrawals</label>
        </ReasonModal>
      )}
    </div>
  );
}
