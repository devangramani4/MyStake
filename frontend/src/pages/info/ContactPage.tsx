import { LifeBuoy, Mail, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function ContactPage() {
  return (
    <div className="page">
      <div>
        <h1 className="page-title">Contact &amp; Support</h1>
        <p className="page-sub">We're here to help with your account, bets and payments.</p>
      </div>
      <div className="promo-grid">
        <div className="card promo"><Mail /><h3>Email support</h3><p className="muted">support@example.com — replace with your support address. Include your username, never your password.</p></div>
        <div className="card promo"><LifeBuoy /><h3>Bet queries</h3><p className="muted">Quote the 8-character Bet ID from <Link to="/account/bets" style={{ textDecoration: 'underline' }}>My bets</Link> so we can find it quickly.</p></div>
        <div className="card promo"><ShieldCheck /><h3>Need a break?</h3><p className="muted">Use cooling-off or self-exclusion any time from <Link to="/responsible-gambling" style={{ textDecoration: 'underline' }}>Responsible Gambling</Link>.</p></div>
      </div>
    </div>
  );
}
