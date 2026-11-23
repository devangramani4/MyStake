import { EventCard } from '../../components/sports/EventCard';
import { SportCard } from '../../components/sports/SportCard';
import { LiveIndicator } from '../../components/ui/LiveIndicator';
import { EmptyState, LoadingSkeleton } from '../../components/ui/States';
import { useEvents } from '../../hooks/useEvents';
import { useSports } from '../../hooks/useSports';

export default function SportsPage() {
  const { sports, loading } = useSports();
  const live = useEvents({ status: 'IN_PLAY', pageSize: 10 }, { refreshMs: 60_000 });
  return (
    <div className="page">
      <div>
        <h1 className="page-title">Sports</h1>
        <p className="page-sub">Every sport on the exchange. Pick one to see competitions and markets.</p>
      </div>
      {loading ? <LoadingSkeleton rows={2} height={90} /> : <div className="sport-cards">{sports.map((s) => <SportCard key={s.slug} sport={s} />)}</div>}
      <section className="stack" style={{ gap: 12 }}>
        <h2 className="section-title"><LiveIndicator label="" /> In-play across all sports</h2>
        <div className="card">{live.loading ? <LoadingSkeleton rows={4} height={64} /> : live.items.length ? live.items.map((e) => <EventCard key={e.eventId} event={e} />) : <EmptyState title="Nothing in-play right now" />}</div>
      </section>
    </div>
  );
}
