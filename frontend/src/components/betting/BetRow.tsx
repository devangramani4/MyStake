import { AlertTriangle, Minus, Plus, X } from 'lucide-react';
import { memo } from 'react';
import { config } from '../../config';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { removeSelection, setPrice, setStake, type Selection } from '../../store/slices/betslipSlice';
import { isValidPrice, liability, profit, tick } from '../../utils/exchange';
import { money, odds as fmtOdds } from '../../utils/format';
import { SideBadge } from '../ui/StatusBadge';

const QUICK = [100, 500, 1000, 5000];

export interface RowIssue { kind: 'suspended' | 'closed' | 'runner' | 'odds' | 'liquidity' | 'stake' | 'price'; message: string; currentPrice?: number }

/** Inspect a selection against the live book (used by the row and the slip). */
export function useRowIssue(sel: Selection): RowIssue | null {
  const status = useAppSelector((s) => s.markets.books[sel.marketId]?.status);
  const runnerStatus = useAppSelector((s) => s.markets.books[sel.marketId]?.runners[sel.selectionId]?.status);
  const best = useAppSelector((s) => s.markets.books[sel.marketId]?.runners[sel.selectionId]?.[sel.side === 'BACK' ? 'back' : 'lay'][0]);
  const policy = useAppSelector((s) => s.betslip.unmatchedPolicy);
  const stake = Number(sel.stake);
  if (status === 'SUSPENDED') return { kind: 'suspended', message: 'Market suspended' };
  if (status === 'CLOSED') return { kind: 'closed', message: 'Market closed' };
  if (runnerStatus && runnerStatus !== 'ACTIVE') return { kind: 'runner', message: 'Selection no longer available' };
  if (!isValidPrice(sel.price)) return { kind: 'price', message: 'Invalid odds for the exchange ladder' };
  if (sel.stake !== '' && stake < config.minStake) return { kind: 'stake', message: `Minimum stake ${money(config.minStake)}` };
  if (best && policy === 'REJECT') {
    const worse = sel.side === 'BACK' ? best.price < sel.price : best.price > sel.price;
    if (worse) return { kind: 'odds', message: `Odds changed to ${fmtOdds(best.price)}`, currentPrice: best.price };
    if (stake > best.size && best.price === sel.price) return { kind: 'liquidity', message: `Only ${money(best.size)} available at ${fmtOdds(best.price)}` };
  }
  return null;
}

export const BetRow = memo(function BetRow({ sel }: { sel: Selection }) {
  const dispatch = useAppDispatch();
  const issue = useRowIssue(sel);
  const stake = Number(sel.stake) || 0;
  const risk = liability(sel.side, stake, sel.price);
  const win = profit(sel.side, stake, sel.price);
  const blocking = issue && issue.kind !== 'liquidity';
  return (
    <div className={`bet-row ${sel.side === 'LAY' ? 'lay' : ''} ${issue ? 'warn' : ''}`}>
      <div className="bet-row-top">
        <div style={{ minWidth: 0 }}>
          <div className="row"><SideBadge side={sel.side} /><span className="sel ellipsis">{sel.selectionName}</span></div>
          <div className="mkt ellipsis">{sel.marketName} · {sel.eventName}</div>
        </div>
        <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => dispatch(removeSelection(sel.key))} aria-label={`Remove ${sel.selectionName}`}><X size={14} /></button>
      </div>
      <div className="bet-inputs">
        <div>
          <div className="faint" style={{ fontSize: 11, marginBottom: 4 }}>Odds</div>
          <div className="stepper">
            <button type="button" onClick={() => dispatch(setPrice({ key: sel.key, price: tick(sel.price, -1) }))} aria-label="Decrease odds"><Minus size={12} /></button>
            <input
              className="num"
              inputMode="decimal"
              aria-label="Odds"
              value={sel.price}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) dispatch(setPrice({ key: sel.key, price: v }));
              }}
            />
            <button type="button" onClick={() => dispatch(setPrice({ key: sel.key, price: tick(sel.price, 1) }))} aria-label="Increase odds"><Plus size={12} /></button>
          </div>
        </div>
        <div>
          <div className="faint" style={{ fontSize: 11, marginBottom: 4 }}>{sel.side === 'LAY' ? "Backer's stake" : 'Stake'}</div>
          <input className="stake-input num" inputMode="decimal" placeholder={`Min ${config.minStake}`} aria-label="Stake" value={sel.stake} onChange={(e) => dispatch(setStake({ key: sel.key, stake: e.target.value }))} />
        </div>
      </div>
      <div className="quick-stakes">
        {QUICK.map((q) => <button key={q} type="button" onClick={() => dispatch(setStake({ key: sel.key, stake: String(q) }))}>{q >= 1000 ? `${q / 1000}k` : q}</button>)}
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <div className="kv"><span>{sel.side === 'LAY' ? 'Liability' : 'Risk'}</span><b className="num">{money(risk)}</b></div>
        <div className="kv"><span>Profit if {sel.side === 'LAY' ? 'it loses' : 'it wins'}</span><b className="num pos">{money(win)}</b></div>
        <div className="kv"><span>Potential return</span><b className="num">{money(risk + win)}</b></div>
      </div>
      {issue && (
        <div className={`alert ${blocking ? 'alert-warning' : 'alert-info'}`} style={{ padding: '8px 10px' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span className="grow">{issue.message}</span>
          {issue.kind === 'odds' && issue.currentPrice && (
            <button className="btn btn-sm btn-secondary" onClick={() => dispatch(setPrice({ key: sel.key, price: issue.currentPrice! }))}>Accept</button>
          )}
        </div>
      )}
    </div>
  );
});
