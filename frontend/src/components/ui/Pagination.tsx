import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props { page: number; totalPages: number; total: number; onChange: (p: number) => void }

export function Pagination({ page, totalPages, total, onChange }: Props) {
  if (total === 0) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <span>{total.toLocaleString()} result{total === 1 ? '' : 's'}</span>
      <div className="row">
        <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
        <span className="num">{page} / {totalPages}</span>
        <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
      </div>
    </nav>
  );
}
