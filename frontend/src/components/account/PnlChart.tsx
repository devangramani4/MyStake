import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BetItem } from '../../types';
import { money } from '../../utils/format';

/** Cumulative net P&L (after commission) by settlement day. */
export default function PnlChart({ bets }: { bets: BetItem[] }) {
  const byDay = new Map<string, number>();
  for (const b of bets) {
    if (!b.settledAt || b.profitLoss === null) continue;
    const d = b.settledAt.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + Number(b.profitLoss) - Number(b.commission));
  }
  let run = 0;
  const data = [...byDay.entries()].sort().map(([day, v]) => ({ day: day.slice(5), pnl: Math.round((run += v) * 100) / 100 }));
  const positive = run >= 0;
  const color = positive ? 'var(--success)' : 'var(--danger)';
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="pnl" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="day" stroke="var(--text-3)" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke="var(--text-3)" fontSize={11} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => money(v)} />
          <Tooltip contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8 }} formatter={(v) => [money(Number(v)), 'Cumulative P/L']} />
          <Area type="monotone" dataKey="pnl" stroke={color} strokeWidth={2} fill="url(#pnl)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
