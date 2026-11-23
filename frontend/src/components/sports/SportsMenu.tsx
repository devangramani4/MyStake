import { Flame, Gift, Home, Radio } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useSports } from '../../hooks/useSports';
import { SportIcon } from '../ui/SportIcon';

export function SportsMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { sports } = useSports();
  const live = sports.reduce((a, s) => a + s.liveCount, 0);
  return (
    <nav aria-label="Sports" className="stack" style={{ gap: 2 }} onClick={onNavigate}>
      <NavLink to="/" end className="side-link"><Home size={18} /> Home</NavLink>
      <NavLink to="/live" className="side-link"><Radio size={18} /> Live betting {live > 0 && <span className="live-count">{live}</span>}</NavLink>
      <NavLink to="/sports" end className="side-link"><Flame size={18} /> All sports</NavLink>
      <NavLink to="/promotions" className="side-link"><Gift size={18} /> Promotions</NavLink>
      <div className="side-label">Sports</div>
      {sports.map((s) => (
        <NavLink key={s.slug} to={`/sports/${s.slug}`} className="side-link">
          <SportIcon slug={s.slug} /> <span className="ellipsis">{s.name}</span>
          {s.liveCount > 0 ? <span className="live-count">{s.liveCount} live</span> : <span className="count">{s.eventCount}</span>}
        </NavLink>
      ))}
    </nav>
  );
}
