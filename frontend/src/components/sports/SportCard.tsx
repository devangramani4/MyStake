import { Link } from 'react-router-dom';
import type { Sport } from '../../types';
import { SportIcon } from '../ui/SportIcon';

export function SportCard({ sport }: { sport: Sport }) {
  return (
    <Link to={`/sports/${sport.slug}`} className="card sport-card">
      <span className="icon"><SportIcon slug={sport.slug} size={20} /></span>
      <span className="name">{sport.name}</span>
      <span className="row faint" style={{ fontSize: 12 }}>
        {sport.eventCount} events
        {sport.liveCount > 0 && <span className="live" style={{ marginLeft: 'auto' }}><span className="live-dot" />{sport.liveCount}</span>}
      </span>
    </Link>
  );
}
