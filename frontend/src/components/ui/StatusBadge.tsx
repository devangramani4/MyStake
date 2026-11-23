import { statusLabel } from '../../utils/format';

const TONE: Record<string, string> = {
  MATCHED: 'badge-success', SETTLED: '', WIN: 'badge-success', LOSS: 'badge-danger', PARTIAL: 'badge-warning', VOID: '', VOIDED: '',
  UNMATCHED: 'badge-warning', PARTIALLY_MATCHED: 'badge-warning', PENDING: 'badge-brand', FAILED: 'badge-danger', CANCELLED: '', LAPSED: '',
  COMPLETED: 'badge-success', APPROVED: 'badge-success', PROCESSING: 'badge-brand', REJECTED: 'badge-danger',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${TONE[status] ?? ''}`}>{statusLabel[status] ?? status.replace(/_/g, ' ').toLowerCase()}</span>;
}

export function SideBadge({ side }: { side: 'BACK' | 'LAY' }) {
  return <span className={`badge ${side === 'BACK' ? 'badge-back' : 'badge-lay'}`}>{side}</span>;
}
