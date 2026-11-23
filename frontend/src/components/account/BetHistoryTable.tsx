import type { BetItem } from '../../types';
import { dateTime, money, odds, signedMoney } from '../../utils/format';
import { SideBadge, StatusBadge } from '../ui/StatusBadge';

interface Props { items: BetItem[]; mode: 'open' | 'settled'; onCancel?: (b: BetItem) => void }

export function BetHistoryTable({ items, mode, onCancel }: Props) {
  const pnl = (b: BetItem) => (b.profitLoss === null ? null : Number(b.profitLoss) - Number(b.commission));
  return (
    <div className="table-wrap responsive">
      <table className="table">
        <thead>
          <tr>
            <th>Bet ID</th><th>Event / market</th><th>Selection</th><th>Type</th><th className="r">Odds</th><th className="r">Stake</th>
            {mode === 'open' ? <><th className="r">Liability</th><th className="r">Potential profit</th><th>Status</th><th>Placed</th><th /></> : <><th>Result</th><th className="r">P/L</th><th>Settled</th></>}
          </tr>
        </thead>
        <tbody>
          {items.map((b) => (
            <tr key={b.id}>
              <td className="faint num" title={b.id}>{b.id.slice(0, 8).toUpperCase()}</td>
              <td><div className="ellipsis" style={{ maxWidth: 240 }}>{b.eventName}</div><div className="faint" style={{ fontSize: 12 }}>{b.sportName} · {b.marketName}</div></td>
              <td>{b.selectionName}</td>
              <td><SideBadge side={b.side} /></td>
              <td className="r num">{odds(b.avgPriceMatched ?? b.price)}{b.avgPriceMatched && b.avgPriceMatched !== b.price && <div className="faint" style={{ fontSize: 11 }}>req {odds(b.price)}</div>}</td>
              <td className="r num">{money(b.stake)}{mode === 'open' && b.status !== 'MATCHED' && <div className="faint" style={{ fontSize: 11 }}>matched {money(b.sizeMatched)}</div>}</td>
              {mode === 'open' ? (
                <>
                  <td className="r num">{money(b.liability)}</td>
                  <td className="r num pos">{money(b.potentialProfit)}</td>
                  <td><StatusBadge status={b.status} /></td>
                  <td className="muted">{dateTime(b.placedAt)}</td>
                  <td>{onCancel && (b.status === 'UNMATCHED' || b.status === 'PARTIALLY_MATCHED') && <button className="btn btn-sm btn-secondary" onClick={() => onCancel(b)}>Cancel</button>}</td>
                </>
              ) : (
                <>
                  <td><StatusBadge status={b.result ?? b.status} /></td>
                  <td className={`r num ${(pnl(b) ?? 0) > 0 ? 'pos' : (pnl(b) ?? 0) < 0 ? 'neg' : ''}`}>{pnl(b) === null ? '—' : signedMoney(pnl(b)!)}{Number(b.commission) > 0 && <div className="faint" style={{ fontSize: 11 }}>comm {money(b.commission)}</div>}</td>
                  <td className="muted">{dateTime(b.settledAt)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mobile-cards">
        {items.map((b) => (
          <div className="mcard" key={b.id}>
            <div className="row between"><span className="row"><SideBadge side={b.side} /><b>{b.selectionName}</b></span><StatusBadge status={mode === 'open' ? b.status : (b.result ?? b.status)} /></div>
            <div className="faint" style={{ fontSize: 12 }}>{b.eventName} · {b.marketName}</div>
            <div className="kv"><span>Odds · stake</span><b className="num">{odds(b.avgPriceMatched ?? b.price)} · {money(b.stake)}</b></div>
            {mode === 'open' ? <div className="kv"><span>Potential profit</span><b className="num pos">{money(b.potentialProfit)}</b></div> : <div className="kv"><span>P/L</span><b className="num">{pnl(b) === null ? '—' : signedMoney(pnl(b)!)}</b></div>}
            <div className="kv faint"><span>{b.id.slice(0, 8).toUpperCase()}</span><span>{dateTime(mode === 'open' ? b.placedAt : b.settledAt)}</span></div>
            {mode === 'open' && onCancel && (b.status === 'UNMATCHED' || b.status === 'PARTIALLY_MATCHED') && <button className="btn btn-sm btn-secondary" onClick={() => onCancel(b)}>Cancel unmatched</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
