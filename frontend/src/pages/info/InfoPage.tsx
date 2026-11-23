import { Link } from 'react-router-dom';
import { config } from '../../config';
import { useAppSelector } from '../../store/hooks';

/**
 * Template legal pages. These are placeholders and MUST be replaced with
 * jurisdiction-specific documents reviewed by qualified counsel before launch.
 */
const DOCS = {
  terms: {
    title: 'Terms & Conditions',
    body: (
      <>
        <div className="alert alert-warning">Template content — replace with terms approved for your licensed jurisdiction.</div>
        <h2>1. Eligibility</h2>
        <p>You must be of legal gambling age in your place of residence and not located in a restricted territory. We may request identity verification (KYC) at any time.</p>
        <h2>2. Back and lay betting</h2>
        <p>Bets are accepted and settled by us at the odds shown, which are based on a third-party exchange price feed. A back bet risks your stake; a lay bet risks your liability (stake × (odds − 1)). A bet waiting for its odds may be cancelled by you and lapses when a market turns in-play.</p>
        <h2>3. Commission</h2>
        <p>Commission is charged on net winnings per market at the rate displayed in your account.</p>
        <h2>4. Settlement</h2>
        <p>Markets are settled according to the official result supplied by the exchange. Void markets and non-runners are refunded.</p>
        <h2>5. Account security</h2>
        <p>Keep your credentials confidential and enable two-factor authentication.</p>
      </>
    ),
  },
  privacy: {
    title: 'Privacy Policy',
    body: (
      <>
        <div className="alert alert-warning">Template content — replace with a policy that meets your applicable data-protection laws.</div>
        <h2>What we collect</h2>
        <ul><li>Account details (name, email, date of birth, country)</li><li>Transaction and betting history</li><li>Device and session information for security</li></ul>
        <h2>Why</h2>
        <p>To operate your account, meet legal obligations (including KYC/AML and responsible-gambling duties), prevent fraud, and keep the service secure.</p>
        <h2>Your rights</h2>
        <p>You can request access, correction or deletion of your data, subject to legal retention requirements. Contact support to exercise these rights.</p>
      </>
    ),
  },
  responsible: {
    title: 'Responsible Gambling',
    body: (
      <>
        <p>Gambling should be entertainment, not a way to make money. If it stops being fun, stop.</p>
        <h2>Tools available in your account</h2>
        <ul>
          <li><b>Deposit limits</b> — daily, weekly and monthly.</li>
          <li><b>Loss, stake and exposure limits.</b></li>
          <li><b>Cooling-off</b> — take a break from 24 hours to 30 days.</li>
          <li><b>Self-exclusion</b> — 6 months, 1 year, 5 years or permanently.</li>
        </ul>
        <p>Lowering a limit takes effect immediately. Raising or removing one takes effect after a 24-hour cooling period.</p>
        <h2>Warning signs</h2>
        <ul><li>Chasing losses or betting more to win back money</li><li>Borrowing money or using money meant for bills</li><li>Feeling anxious or irritable about gambling</li></ul>
        <h2>Get support</h2>
        <p>Independent, confidential help is available from national gambling-support organisations in your country.</p>
      </>
    ),
  },
} as const;

export default function InfoPage({ doc }: { doc: keyof typeof DOCS }) {
  const authed = useAppSelector((s) => s.auth.status === 'authenticated');
  const d = DOCS[doc];
  return (
    <div className="page">
      <h1 className="page-title">{d.title}</h1>
      <div className="prose">{d.body}</div>
      {doc === 'responsible' && (
        <Link to={authed ? '/account/responsible-gambling' : '/login'} className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
          {authed ? 'Set my limits' : 'Log in to set limits'}
        </Link>
      )}
      <p className="faint" style={{ fontSize: 12 }}>{config.brand} · Last updated {new Date().getFullYear()}</p>
    </div>
  );
}
