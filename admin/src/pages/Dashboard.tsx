import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { Badge, Loading, money, useLoad } from '../ui';

interface Dash {
  users: { total: number; active30d: number; new24h: number };
  bets: { total: number; open: number; settled: number; failed: number; pending: number };
  totals: { stakes: string; customerProfitLoss: string; revenue: string };
  deposits: { total: string; count: number; pending: number };
  withdrawals: { total: string; count: number; pending: number };
  openRiskAlerts: number;
  apiStatus: { mode: string; sessionValid: boolean; streamConnected: boolean; lastError: string | null; errorsLastHour: number };
  daily: Array<{ day: string; stakes: number; bets: number; revenue: number; customerPnl: number }>;
  bySport: Array<{ sport: string; stakes: number; bets: number }>;
}

const Tile = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) => (
  <div className="card stat"><span className="stat-label">{label}</span><span className="stat-value num">{value}</span>{sub && <span className="faint" style={{ fontSize: 12 }}>{sub}</span>}</div>
);
const tip = { contentStyle: { background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8 } };

export default function Dashboard() {
  const { data } = useLoad(() => api.get<Dash>('/admin/dashboard').then((r) => r.data), []);
  if (!data) return <Loading />;
  const d = data;
  return (
    <div className="admin-page">
      <h1 className="page-title">Dashboard</h1>
      <div className="stats">
        <Tile label="Total users" value={d.users.total.toLocaleString()} sub={`${d.users.new24h} new today`} />
        <Tile label="Active users (30d)" value={d.users.active30d.toLocaleString()} />
        <Tile label="Bets" value={d.bets.total.toLocaleString()} sub={`${d.bets.pending} pending · ${d.bets.failed} failed`} />
        <Tile label="Open bets" value={d.bets.open.toLocaleString()} />
        <Tile label="Settled bets" value={d.bets.settled.toLocaleString()} />
        <Tile label="Total stakes" value={money(d.totals.stakes)} />
        <Tile label="Customer P/L" value={<span className={Number(d.totals.customerProfitLoss) >= 0 ? 'pos' : 'neg'}>{money(d.totals.customerProfitLoss)}</span>} sub="Settled, before commission" />
        <Tile label="Revenue (commission)" value={money(d.totals.revenue)} />
        <Tile label="Deposits" value={money(d.deposits.total)} sub={`${d.deposits.count} · ${d.deposits.pending} pending`} />
        <Tile label="Withdrawals" value={money(d.withdrawals.total)} sub={`${d.withdrawals.count} · ${d.withdrawals.pending} pending`} />
        <Tile label="Open risk alerts" value={<span className={d.openRiskAlerts ? 'neg' : ''}>{d.openRiskAlerts}</span>} />
        <Tile label="Exchange API" value={<span className="row"><Badge v={d.apiStatus.sessionValid ? 'ACTIVE' : 'FAILED'} /><Badge v={d.apiStatus.mode.toUpperCase()} /></span>} sub={`Stream ${d.apiStatus.streamConnected ? 'connected' : 'down'} · ${d.apiStatus.errorsLastHour} errors/h`} />
      </div>
      <div className="grid-2">
        <section className="card card-pad">
          <div className="card-title" style={{ marginBottom: 12 }}>Stakes &amp; revenue — 14 days</div>
          <div className="chart-box">
            <ResponsiveContainer>
              <LineChart data={d.daily}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" stroke="var(--text-3)" fontSize={11} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis yAxisId="l" stroke="var(--text-3)" fontSize={11} width={70} />
                <YAxis yAxisId="r" orientation="right" stroke="var(--text-3)" fontSize={11} width={50} />
                <Tooltip {...tip} />
                <Legend />
                <Line yAxisId="l" dataKey="stakes" name="Stakes" stroke="var(--back)" strokeWidth={2} dot={false} />
                <Line yAxisId="r" dataKey="revenue" name="Commission" stroke="var(--brand)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card card-pad">
          <div className="card-title" style={{ marginBottom: 12 }}>Stakes by sport — 30 days</div>
          <div className="chart-box">
            <ResponsiveContainer>
              <BarChart data={d.bySport} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid stroke="var(--border)" horizontal={false} />
                <XAxis type="number" stroke="var(--text-3)" fontSize={11} />
                <YAxis type="category" dataKey="sport" stroke="var(--text-3)" fontSize={11} width={90} />
                <Tooltip {...tip} />
                <Bar dataKey="stakes" name="Stakes" fill="var(--back)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}
