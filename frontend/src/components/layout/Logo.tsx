import { Link } from 'react-router-dom';
import { config } from '../../config';

/** Placeholder brand mark — replace with your own licensed brand assets. */
export function Logo() {
  return (
    <Link to="/" className="logo" aria-label={`${config.brand} home`}>
      <span className="logo-mark">
        <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden><path d="M6 6h11a6 6 0 0 1 0 12H6z" fill="var(--brand)" /><path d="M6 16h13a5 5 0 0 1 0 10H6z" fill="var(--back)" /></svg>
      </span>
      <span className="word">{config.brand.slice(0, -1)}<b>{config.brand.slice(-1)}</b></span>
    </Link>
  );
}
