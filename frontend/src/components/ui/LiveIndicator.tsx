export function LiveIndicator({ label = 'LIVE' }: { label?: string }) {
  return <span className="live"><span className="live-dot" aria-hidden />{label}</span>;
}
