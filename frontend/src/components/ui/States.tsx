import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

export function LoadingSkeleton({ rows = 4, height = 56 }: { rows?: number; height?: number }) {
  return (
    <div className="stack" style={{ gap: 8, padding: 12 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height }} />)}
    </div>
  );
}

export function EmptyState({ title, message, icon, action }: { title: string; message?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state">
      {icon ?? <Inbox size={36} />}
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state" role="alert">
      <AlertTriangle size={36} style={{ color: 'var(--warning)' }} />
      <h3>Couldn't load this</h3>
      <p>{message}</p>
      {onRetry && <button className="btn btn-secondary" onClick={onRetry}><RefreshCw size={14} /> Try again</button>}
    </div>
  );
}
