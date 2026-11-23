import { ArrowRight, CalendarDays, Gift, Radio, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EventCard } from '../../components/sports/EventCard';
import { SportCard } from '../../components/sports/SportCard';
import { LiveIndicator } from '../../components/ui/LiveIndicator';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/ui/States';
import { config } from '../../config';
import { useEvents } from '../../hooks/useEvents';
import { useSports } from '../../hooks/useSports';
import { contentApi } from '../../services/api/contentApi';
import { useAppSelector } from '../../store/hooks';
import type { Promotion } from '../../types';
import { compact } from '../../utils/format';

function EventList({ title, icon, query, to, empty }: { title: string; icon: React.ReactNode; query: Parameters<typeof useEvents>[0]; to: string; empty: string }) {
  const { items, loading, error, reload } = useEvents(query, { refreshMs: 60_000 });
  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="row between">
        <h2 className="section-title">{icon}{title}</h2>
        <Link to={to} className="btn btn-ghost btn-sm">View all <ArrowRight size={14} /></Link>
      </div>
      <div className="card">
        {loading ? <LoadingSkeleton rows={4} height={64} /> : error ? <ErrorState message={error} onRetry={reload} /> : items.length ? items.map((e) => <EventCard key={e.eventId} event={e} />) : <EmptyState title={empty} />}
      </div>
    </section>
  );
}

export default function HomePage() {
  const { sports } = useSports();
  const user = useAppSelector((s) => s.auth.user);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof contentApi.stats>> | null>(null);
  const [promos, setPromos] = useState<Promotion[]>([]);
  useEffect(() => {
    contentApi.stats().then(setStats).catch(() => undefined);
    contentApi.promotions().then(setPromos).catch(() => undefined);
  }, []);

  return (
    <div className="page">
      <section className="hero">
        <span className="badge badge-brand" style={{ alignSelf: 'flex-start' }}>Back &amp; lay betting</span>
        <h1>Back it. Lay it. <em>Live odds, every ball.</em></h1>
        <p>Back or lay on cricket, football, tennis and more — with real-time odds and in-play markets.</p>
        <div className="row wrap">
          {user ? <Link to="/live" className="btn btn-primary btn-lg"><Radio size={18} /> Go in-play</Link> : <Link to="/register" className="btn btn-primary btn-lg">Create account</Link>}
          <Link to="/sports" className="btn btn-secondary btn-lg">Browse sports</Link>
        </div>
        <div className="hero-art" aria-hidden>
          <div className="stack" style={{ gap: 8 }}>
            <div className="odds back"><span className="p">1.85</span><span className="s">₹5K</span></div>
            <div className="odds back"><span className="p">2.10</span><span className="s">₹2.5K</span></div>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <div className="odds lay"><span className="p">1.90</span><span className="s">₹3.5K</span></div>
            <div className="odds lay"><span className="p">2.20</span><span className="s">₹4K</span></div>
          </div>
        </div>
      </section>

      {stats && (
        <section className="stats" aria-label="Exchange statistics">
          <div className="card stat"><span className="stat-label">Live events</span><span className="stat-value num row"><LiveIndicator label="" />{stats.liveEvents}</span></div>
          <div className="card stat"><span className="stat-label">Upcoming events</span><span className="stat-value num">{stats.upcomingEvents}</span></div>
          <div className="card stat"><span className="stat-label">Open markets</span><span className="stat-value num">{stats.openMarkets}</span></div>
          <div className="card stat"><span className="stat-label">Matched on open markets</span><span className="stat-value num">{compact(stats.totalMatched)}</span></div>
        </section>
      )}

      <section className="stack" style={{ gap: 12 }}>
        <h2 className="section-title">Featured sports</h2>
        <div className="sport-cards">{sports.slice(0, 12).map((s) => <SportCard key={s.slug} sport={s} />)}</div>
      </section>

      <EventList title="Live now" icon={<LiveIndicator label="" />} query={{ status: 'IN_PLAY', pageSize: 6 }} to="/live" empty="No events in-play right now" />
      <EventList title="Popular cricket" icon={<TrendingUp size={18} />} query={{ sport: 'cricket', pageSize: 5 }} to="/sports/cricket" empty="No cricket markets open" />
      <EventList title="Upcoming" icon={<CalendarDays size={18} />} query={{ status: 'UPCOMING', pageSize: 8 }} to="/sports" empty="No upcoming events" />

      {promos.length > 0 && (
        <section className="stack" style={{ gap: 12 }}>
          <div className="row between">
            <h2 className="section-title"><Gift size={18} /> Promotions</h2>
            <Link to="/promotions" className="btn btn-ghost btn-sm">All promotions <ArrowRight size={14} /></Link>
          </div>
          <div className="promo-grid">
            {promos.slice(0, 3).map((p) => (
              <article key={p.slug} className="card promo">
                {p.badge && <span className="badge badge-brand" style={{ alignSelf: 'flex-start' }}>{p.badge}</span>}
                <h3>{p.title}</h3>
                <p className="muted">{p.summary}</p>
              </article>
            ))}
          </div>
        </section>
      )}
      <p className="faint" style={{ fontSize: 12 }}>{config.brand} — 18+ only. Please gamble responsibly.</p>
    </div>
  );
}
