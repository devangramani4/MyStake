import { Link } from 'react-router-dom';
import { config } from '../../config';

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-links">
        <Link to="/terms">Terms &amp; Conditions</Link>
        <Link to="/privacy">Privacy Policy</Link>
        <Link to="/responsible-gambling">Responsible Gambling</Link>
        <Link to="/contact">Contact &amp; Support</Link>
        <Link to="/promotions">Promotions</Link>
      </div>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <span className="age-badge" aria-label="18 plus">18+</span>
        <p>
          Gambling can be addictive. Please play responsibly and set limits in your account. {config.brand} is a demonstration platform;
          availability of real-money betting depends on licensing in your jurisdiction. Exchange prices are provided via a third-party exchange API.
        </p>
      </div>
      <p>© {new Date().getFullYear()} {config.brand}. All rights reserved.</p>
    </footer>
  );
}
