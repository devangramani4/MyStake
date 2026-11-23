import { ChevronRight, Tv } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MarketCard } from '../../components/betting/MarketCard';
import { ScoreCard } from '../../components/sports/ScoreCard';
import { LiveIndicator } from '../../components/ui/LiveIndicator';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/ui/States';
import { useAsync } from '../../hooks/useAsync';
import { useEventScores, useMarketSubscription } from '../../hooks/useMarketSubscription';
import { eventsService } from '../../services/betfair/eventsService';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { scoresReceived } from '../../store/slices/scoresSlice';
import { dateTime } from '../../utils/format';

export default function EventPage() {
  const { eventId = '' } = useParams();
  const dispatch = useAppDispatch();
  const { data: ev, error, loading, reload } = useAsync(() => eventsService.get(eventId), [eventId]);
  const score = useAppSelector((s) => s.scores.byEvent[eventId]);
  const inPlay = useAppSelector((s) => (ev ? ev.markets.some((m) => s.markets.books[m.marketId]?.inPlay) : false)) || ev?.status === 'IN_PLAY';

  useEffect(() => {
    if (ev?.score) dispatch(scoresReceived([ev.score]));
  }, [ev, dispatch]);
  useMarketSubscription(ev?.markets.map((m) => m.marketId) ?? [], ev?.books);
  useEventScores(ev ? [ev.eventId] : []);

  if (loading) return <div className="page"><LoadingSkeleton rows={6} height={80} /></div>;
  if (error || !ev) return <div className="page"><ErrorState message={error ?? 'Event not found'} onRetry={reload} /></div>;

  return (
    <div className="page">
      <section className="card event-hero">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to="/sports">Sports</Link><ChevronRight size={12} />
          <Link to={`/sports/${ev.sport.slug}`}>{ev.sport.name}</Link>
          {ev.competition && <><ChevronRight size={12} /><span>{ev.competition.name}</span></>}
        </nav>
        <h1>{ev.name}</h1>
        <div className="row wrap muted" style={{ fontSize: 13 }}>
          {inPlay ? <LiveIndicator label="IN-PLAY" /> : <span>Starts {dateTime(ev.openDate)}</span>}
          {ev.venue && <span>· {ev.venue}</span>}
          {ev.hasStream && <span className="badge badge-brand"><Tv size={11} /> Live stream</span>}
          <span>· {ev.markets.length} markets</span>
        </div>
      </section>
      {score && <ScoreCard score={score} />}
      {ev.markets.length === 0 ? (
        <EmptyState title="No open markets" message="Markets for this event have closed." />
      ) : (
        <div className="stack">{ev.markets.map((m) => <MarketCard key={m.marketId} market={m} eventId={ev.eventId} eventName={ev.name} />)}</div>
      )}
    </div>
  );
}
