import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { dismissToast, type Toast as ToastT } from '../../store/slices/uiSlice';

const ICONS = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };

function ToastItem({ t }: { t: ToastT }) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    const id = setTimeout(() => dispatch(dismissToast(t.id)), t.kind === 'error' ? 7000 : 4500);
    return () => clearTimeout(id);
  }, [dispatch, t.id, t.kind]);
  const Icon = ICONS[t.kind];
  return (
    <div className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
      <Icon size={18} style={{ flexShrink: 0, marginTop: 1 }} />
      <div className="grow">
        <div className="toast-title">{t.title}</div>
        {t.message && <div className="toast-msg">{t.message}</div>}
      </div>
      <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => dispatch(dismissToast(t.id))} aria-label="Dismiss"><X size={14} /></button>
    </div>
  );
}

export function Toaster() {
  const toasts = useAppSelector((s) => s.ui.toasts);
  return <div className="toasts" aria-live="polite">{toasts.map((t) => <ToastItem key={t.id} t={t} />)}</div>;
}
