import { useAsync } from '../../hooks/useAsync';
import { contentApi } from '../../services/api/contentApi';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/ui/States';

export default function PromotionsPage() {
  const { data, error, loading, reload } = useAsync(() => contentApi.promotions(), []);
  return (
    <div className="page">
      <div>
        <h1 className="page-title">Promotions</h1>
        <p className="page-sub">Offers are subject to terms and eligibility. Please gamble responsibly.</p>
      </div>
      {loading ? <LoadingSkeleton rows={3} height={120} /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.length ? <EmptyState title="No promotions right now" /> : (
        <div className="promo-grid">
          {data.map((p) => (
            <article key={p.slug} className="card promo">
              {p.badge && <span className="badge badge-brand" style={{ alignSelf: 'flex-start' }}>{p.badge}</span>}
              <h3>{p.title}</h3>
              <p className="muted">{p.body}</p>
              {p.terms && <details className="faint" style={{ fontSize: 12 }}><summary>Terms apply</summary><p style={{ marginTop: 6 }}>{p.terms}</p></details>}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
