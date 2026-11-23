import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { errMsg } from './api';

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (v: unknown) => `₹${inr.format(Number(v ?? 0))}`;
export const dt = (v: unknown) => (v ? new Date(String(v)).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—');

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(() => fn().then(setData).catch((e) => setError(errMsg(e))), deps);
  useEffect(() => void load(), [load]);
  return { data, error, reload: load };
}

const TONE: Record<string, string> = {
  ACTIVE: 'badge-success', VERIFIED: 'badge-success', COMPLETED: 'badge-success', MATCHED: 'badge-success', OPEN: 'badge-success', WIN: 'badge-success', APPROVED: 'badge-success', SUCCESS: 'badge-success',
  SUSPENDED: 'badge-warning', PENDING: 'badge-brand', UNMATCHED: 'badge-warning', PARTIALLY_MATCHED: 'badge-warning', IN_PLAY: 'badge-danger', PROCESSING: 'badge-brand', MEDIUM: 'badge-warning',
  CLOSED: '', SELF_EXCLUDED: 'badge-danger', REJECTED: 'badge-danger', FAILED: 'badge-danger', LOSS: 'badge-danger', HIGH: 'badge-danger', BACK: 'badge-back', LAY: 'badge-lay',
};
export const Badge = ({ v }: { v: unknown }) => <span className={`badge ${TONE[String(v)] ?? ''}`}>{String(v ?? '—').replace(/_/g, ' ')}</span>;

export function Pager({ page, totalPages, total, onChange }: { page: number; totalPages: number; total: number; onChange: (p: number) => void }) {
  return (
    <div className="pagination">
      <span>{total.toLocaleString()} rows</span>
      <div className="row">
        <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous"><ChevronLeft size={14} /></button>
        <span className="num">{page} / {totalPages}</span>
        <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)} aria-label="Next"><ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: 560 }}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Every privileged change asks for a reason — it is stored in the audit log. */
export function ReasonModal({ title, confirm, danger, onClose, onSubmit, children }: { title: string; confirm: string; danger?: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<unknown>; children?: ReactNode }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || reason.trim().length < 3} onClick={go}>{confirm}</button></>}>
      {children}
      <div className="field"><label htmlFor="reason">Reason (audit log)</label><textarea id="reason" className="input" style={{ height: 80, padding: 10 }} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      {error && <div className="alert alert-danger">{error}</div>}
    </Modal>
  );
}

export function Toast({ msg, onDone }: { msg: { kind: 'success' | 'error'; text: string } | null; onDone: () => void }) {
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(onDone, 4000);
    return () => clearTimeout(id);
  }, [msg, onDone]);
  if (!msg) return null;
  return <div className="toasts" style={{ top: 16 }}><div className={`toast ${msg.kind}`}><div className="toast-title">{msg.text}</div></div></div>;
}

export const Loading = () => <div className="stack" style={{ padding: 16, gap: 8 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 40 }} />)}</div>;
export const Empty = ({ text = 'Nothing here' }: { text?: string }) => <div className="state"><h3>{text}</h3></div>;
