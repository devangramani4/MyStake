import { useEffect, useState } from 'react';
import { useAppSelector } from '../../store/hooks';

/** Warns when live prices may be stale (socket down or exchange feed disconnected). */
export function ConnectionBanner() {
  const socket = useAppSelector((s) => s.ui.socket);
  const feed = useAppSelector((s) => s.ui.feedConnected);
  const [show, setShow] = useState(false);
  const bad = socket !== 'open' || !feed;
  useEffect(() => {
    if (!bad) return setShow(false);
    const id = setTimeout(() => setShow(true), 2500); // ignore brief reconnects
    return () => clearTimeout(id);
  }, [bad]);
  if (!show) return null;
  return <div className="conn-banner" role="status">{socket !== 'open' ? 'Reconnecting to live prices… odds may be out of date.' : 'Live exchange feed interrupted — prices may be delayed.'}</div>;
}
