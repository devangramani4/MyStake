import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props { open: boolean; onClose: () => void; side: 'left' | 'bottom'; children: ReactNode; label: string }

export function Drawer({ open, onClose, side, children, label }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className={`drawer ${side}`} role="dialog" aria-modal="true" aria-label={label}>{children}</aside>
    </>,
    document.body,
  );
}
