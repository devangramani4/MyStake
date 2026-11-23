import { Badge, dt, money } from './ui';

export interface BetRow {
  id: string; side: string; price: string; stake: string; liability: string; sizeMatched: string; avgPriceMatched: string | null; status: string;
  result: string | null; profitLoss: string | null; commission: string; failureCode: string | null; placedAt: string; settledAt: string | null;
  marketName: string; eventName: string; sportName: string; selectionName: string;
}

export function BetsTable({ items }: { items: BetRow[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Bet</th><th>Event / market</th><th>Selection</th><th>Side</th><th className="r">Odds</th><th className="r">Stake</th><th className="r">Matched</th><th className="r">Liability</th><th>Status</th><th className="r">P/L</th><th>Placed</th></tr></thead>
        <tbody>
          {items.map((b) => (
            <tr key={b.id}>
              <td className="faint num" title={b.id}>{b.id.slice(0, 8).toUpperCase()}</td>
              <td><div>{b.eventName}</div><div className="faint" style={{ fontSize: 12 }}>{b.sportName} · {b.marketName}</div></td>
              <td>{b.selectionName}</td>
              <td><Badge v={b.side} /></td>
              <td className="r num">{b.avgPriceMatched ?? b.price}</td>
              <td className="r num">{money(b.stake)}</td>
              <td className="r num">{money(b.sizeMatched)}</td>
              <td className="r num">{money(b.liability)}</td>
              <td><Badge v={b.result ?? b.status} />{b.failureCode && <div className="faint" style={{ fontSize: 11 }}>{b.failureCode}</div>}</td>
              <td className={`r num ${Number(b.profitLoss) > 0 ? 'pos' : Number(b.profitLoss) < 0 ? 'neg' : ''}`}>{b.profitLoss === null ? '—' : money(b.profitLoss)}</td>
              <td className="muted">{dt(b.placedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface TxRow { id: string; type: string; amount: string; exposureChange: string; balanceAfter: string; description: string | null; adminId: number | null; createdAt: string; username?: string; userId?: number }

export function TxTable({ items, showUser }: { items: TxRow[]; showUser?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Date</th>{showUser && <th>User</th>}<th>Type</th><th>Description</th><th className="r">Amount</th><th className="r">Exposure Δ</th><th className="r">Balance after</th><th>By admin</th></tr></thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td className="muted">{dt(t.createdAt)}</td>
              {showUser && <td>{t.username}</td>}
              <td><Badge v={t.type} /></td>
              <td className="muted">{t.description}</td>
              <td className={`r num ${Number(t.amount) > 0 ? 'pos' : Number(t.amount) < 0 ? 'neg' : ''}`}>{money(t.amount)}</td>
              <td className="r num muted">{Number(t.exposureChange) ? money(t.exposureChange) : '—'}</td>
              <td className="r num">{money(t.balanceAfter)}</td>
              <td className="faint">{t.adminId ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
