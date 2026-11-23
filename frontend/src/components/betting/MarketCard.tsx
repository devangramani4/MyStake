import { memo } from 'react';
import { useAppSelector } from '../../store/hooks';
import type { MarketSummary } from '../../types';
import { compact, odds as fmtOdds } from '../../utils/format';
import { LiveIndicator } from '../ui/LiveIndicator';
import { BackButton, LayButton } from './OddsButton';

interface Props { market: MarketSummary; eventId: string; eventName: string }

const RunnerRow = memo(function RunnerRow({ marketId, selectionId, name, eventId, eventName, marketName }: { marketId: string; selectionId: number; name: string; eventId: string; eventName: string; marketName: string }) {
  const status = useAppSelector((s) => s.markets.books[marketId]?.runners[selectionId]?.status);
  const ltp = useAppSelector((s) => s.markets.books[marketId]?.runners[selectionId]?.ltp);
  const ctx = { eventId, eventName, marketName, selectionName: name };
  const removed = status && status !== 'ACTIVE';
  return (
    <div className={`ladder-row ${removed ? 'removed' : ''}`}>
      <div className="runner">
        <div className="ellipsis">{name}</div>
        <div className="ltp num">{removed ? status.replace('_', ' ') : ltp ? `Last ${fmtOdds(ltp)}` : ' '}</div>
      </div>
      {/* Back ladder shown best-price nearest the centre, like an exchange */}
      <BackButton marketId={marketId} selectionId={selectionId} level={2} ctx={ctx} />
      <BackButton marketId={marketId} selectionId={selectionId} level={1} ctx={ctx} />
      <BackButton marketId={marketId} selectionId={selectionId} level={0} ctx={ctx} />
      <LayButton marketId={marketId} selectionId={selectionId} level={0} ctx={ctx} />
      <LayButton marketId={marketId} selectionId={selectionId} level={1} ctx={ctx} />
      <LayButton marketId={marketId} selectionId={selectionId} level={2} ctx={ctx} />
    </div>
  );
});

/** Full exchange view of one market: 3-deep back/lay ladder per runner. */
export function MarketCard({ market, eventId, eventName }: Props) {
  const status = useAppSelector((s) => s.markets.books[market.marketId]?.status ?? market.status);
  const inPlay = useAppSelector((s) => s.markets.books[market.marketId]?.inPlay ?? market.inPlay);
  const matched = useAppSelector((s) => s.markets.books[market.marketId]?.totalMatched);
  const blocked = status === 'SUSPENDED' || status === 'CLOSED';
  return (
    <section className="card market" aria-label={market.name}>
      <div className="market-head">
        <div className="row">
          <span className="market-name">{market.name}</span>
          {inPlay && <LiveIndicator label="IN-PLAY" />}
        </div>
        <span className="faint num" style={{ fontSize: 12 }}>Matched {compact(matched ?? market.totalMatched)}</span>
      </div>
      <div className="ladder-head" aria-hidden>
        <span />
        <span className="back-label">BACK</span>
        <span className="lay-label">LAY</span>
      </div>
      <div className="ladder-body">
        {blocked && <div className="suspended-overlay" role="status">{status === 'CLOSED' ? 'CLOSED' : 'SUSPENDED'}</div>}
        {market.runners.map((r) => (
          <RunnerRow key={r.selectionId} marketId={market.marketId} selectionId={r.selectionId} name={r.name} eventId={eventId} eventName={eventName} marketName={market.name} />
        ))}
      </div>
    </section>
  );
}
