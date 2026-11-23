import { ChevronRight, Tv } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../store/hooks';
import type { EventSummary } from '../../types';
import { kickoff } from '../../utils/format';
import { BackButton, LayButton } from '../betting/OddsButton';
import { LiveIndicator } from '../ui/LiveIndicator';

/** Compact event row: headline market with best back/lay per runner (max 3). */
export const EventCard = memo(function EventCard({ event }: { event: EventSummary }) {
  const m = event.mainMarket;
  const status = useAppSelector((s) => (m ? s.markets.books[m.marketId]?.status ?? m.status : undefined));
  const inPlay = useAppSelector((s) => (m ? s.markets.books[m.marketId]?.inPlay ?? m.inPlay : false)) || event.status === 'IN_PLAY';
  const score = useAppSelector((s) => s.scores.byEvent[event.eventId]);
  const runners = m?.runners.slice(0, 3) ?? [];
  const teams = event.name.split(/\s+v(?:s)?\s+/i);
  return (
    <div className="event-row">
      <Link to={`/event/${event.eventId}`} className="grow" style={{ minWidth: 0 }}>
        <div className="event-meta">
          {inPlay ? <LiveIndicator /> : <span>{kickoff(event.openDate)}</span>}
          {score?.clock && inPlay && <span className="num">{score.clock}</span>}
          <span className="ellipsis">{event.competition?.name ?? event.sport.name}</span>
          {event.hasStream && <Tv size={12} aria-label="Streaming available" />}
        </div>
        <div className="event-name">
          {teams.length === 2 ? (
            <>
              <span className="team"><span className="ellipsis">{teams[0]}</span>{score && <b className="num">{score.home.score}</b>}</span>
              <span className="team"><span className="ellipsis">{teams[1]}</span>{score && <b className="num">{score.away.score}</b>}</span>
            </>
          ) : (
            <span className="ellipsis">{event.name}</span>
          )}
        </div>
        <span className="more-markets" style={{ marginLeft: 0 }}>{event.marketCount > 1 ? `+${event.marketCount - 1} markets` : m?.name}<ChevronRight size={11} style={{ verticalAlign: -1 }} /></span>
      </Link>
      {m && (
        <div className="event-odds">
          {(status === 'SUSPENDED' || status === 'CLOSED') && <div className="suspended-overlay">{status}</div>}
          {runners.map((r) => {
            const ctx = { eventId: event.eventId, eventName: event.name, marketName: m.name, selectionName: r.name };
            return (
              <div key={r.selectionId} className="runner-pair" title={r.name}>
                <BackButton marketId={m.marketId} selectionId={r.selectionId} ctx={ctx} />
                <LayButton marketId={m.marketId} selectionId={r.selectionId} ctx={ctx} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
