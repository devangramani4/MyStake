import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { List, type RowComponentProps } from 'react-window';
import { useParams } from 'react-router-dom';
import { EventCard } from '../../components/sports/EventCard';
import { Pagination } from '../../components/ui/Pagination';
import { SportIcon } from '../../components/ui/SportIcon';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/ui/States';
import { useDebounce } from '../../hooks/useDebounce';
import { useEvents } from '../../hooks/useEvents';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useSports } from '../../hooks/useSports';
import { sportsService } from '../../services/betfair/sportsService';
import type { Competition, EventSummary } from '../../types';

const PAGE_SIZE = 50;

function Row({ index, style, events }: RowComponentProps<{ events: EventSummary[] }>) {
  return <div style={style}><EventCard event={events[index]} /></div>;
}

export default function SportPage() {
  const { sport = '' } = useParams();
  const { sports } = useSports();
  const info = sports.find((s) => s.slug === sport);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competition, setCompetition] = useState<string | undefined>();
  const [status, setStatus] = useState<'IN_PLAY' | 'UPCOMING' | undefined>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounce(search.trim(), 350);
  const isPhone = useMediaQuery('(max-width: 720px)');

  useEffect(() => {
    setCompetition(undefined);
    setPage(1);
    sportsService.competitions(sport).then(setCompetitions).catch(() => setCompetitions([]));
  }, [sport]);
  useEffect(() => setPage(1), [competition, status, q]);

  const { items, total, loading, error, reload } = useEvents({ sport, competition, status, q: q || undefined, page, pageSize: PAGE_SIZE }, { refreshMs: 60_000 });

  return (
    <div className="page">
      <div className="row" style={{ gap: 14 }}>
        <span className="card" style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', color: 'var(--brand)' }}><SportIcon slug={sport} size={24} /></span>
        <div>
          <h1 className="page-title">{info?.name ?? sport}</h1>
          <p className="page-sub">{info ? `${info.eventCount} events · ${info.liveCount} in-play` : 'Exchange markets'}</p>
        </div>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <div className="row wrap" style={{ gap: 12 }}>
          <div className="chips" role="tablist" aria-label="Event status">
            {([[undefined, 'All'], ['IN_PLAY', 'In-play'], ['UPCOMING', 'Upcoming']] as const).map(([v, l]) => (
              <button key={l} role="tab" aria-selected={status === v} className={`chip ${status === v ? 'active' : ''}`} onClick={() => setStatus(v)}>{l}</button>
            ))}
          </div>
          <div className="row grow" style={{ maxWidth: 320, position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingLeft: 36, height: 36 }} placeholder="Search events" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search events" />
          </div>
        </div>
        {competitions.length > 0 && (
          <div className="chips" aria-label="Competitions">
            <button className={`chip ${!competition ? 'active' : ''}`} onClick={() => setCompetition(undefined)}>All competitions</button>
            {competitions.map((c) => (
              <button key={c.id} className={`chip ${competition === c.id ? 'active' : ''}`} onClick={() => setCompetition(c.id)}>{c.name} <span className="faint">{c.eventCount}</span></button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        {loading && !items.length ? (
          <LoadingSkeleton rows={6} height={64} />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !items.length ? (
          <EmptyState title="No events found" message="Try another competition or filter." />
        ) : (
          // Virtualised: only visible rows are mounted (and subscribed to price updates).
          <List rowComponent={Row} rowProps={{ events: items }} rowCount={items.length} rowHeight={isPhone ? 150 : 96} scrollElement="window" overscanCount={6} />
        )}
        <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} onChange={setPage} />
      </div>
    </div>
  );
}
