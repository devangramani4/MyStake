import { useMemo, useState } from 'react';
import { EventCard } from '../../components/sports/EventCard';
import { LiveIndicator } from '../../components/ui/LiveIndicator';
import { SportIcon } from '../../components/ui/SportIcon';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/ui/States';
import { useEvents } from '../../hooks/useEvents';
import { useSports } from '../../hooks/useSports';

export default function LivePage() {
  const [sport, setSport] = useState<string | undefined>();
  const { sports } = useSports();
  const { items, loading, error, reload } = useEvents({ status: 'IN_PLAY', sport, pageSize: 100 }, { refreshMs: 30_000 });
  const groups = useMemo(() => {
    const m = new Map<string, typeof items>();
    for (const e of items) m.set(e.sport.slug, [...(m.get(e.sport.slug) ?? []), e]);
    return [...m.entries()];
  }, [items]);
  const liveSports = sports.filter((s) => s.liveCount > 0);

  return (
    <div className="page">
      <div>
        <h1 className="page-title row"><LiveIndicator label="" /> Live betting</h1>
        <p className="page-sub">In-play markets with live prices. Markets may suspend briefly around key moments.</p>
      </div>
      <div className="chips">
        <button className={`chip ${!sport ? 'active' : ''}`} onClick={() => setSport(undefined)}>All live</button>
        {liveSports.map((s) => (
          <button key={s.slug} className={`chip ${sport === s.slug ? 'active' : ''}`} onClick={() => setSport(s.slug)}><SportIcon slug={s.slug} size={14} />{s.name}<span className="faint">{s.liveCount}</span></button>
        ))}
      </div>
      {loading ? (
        <div className="card"><LoadingSkeleton rows={6} height={64} /></div>
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !items.length ? (
        <div className="card"><EmptyState title="No live events right now" message="Check upcoming events — in-play markets open as events start." /></div>
      ) : (
        groups.map(([slug, events]) => (
          <section key={slug} className="stack" style={{ gap: 10 }}>
            <h2 className="section-title"><SportIcon slug={slug} />{events[0].sport.name}<span className="badge">{events.length}</span></h2>
            <div className="card">{events.map((e) => <EventCard key={e.eventId} event={e} />)}</div>
          </section>
        ))
      )}
    </div>
  );
}
