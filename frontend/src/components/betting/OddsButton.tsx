import { memo, useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { selectionKey, toggleSelection } from '../../store/slices/betslipSlice';
import type { Side } from '../../types';
import { compact, odds as fmtOdds } from '../../utils/format';

export interface SelectionContext { eventId: string; eventName: string; marketName: string; selectionName: string }

interface Props {
  marketId: string;
  selectionId: number;
  side: Side;
  /** Ladder depth: 0 = best price. */
  level?: number;
  ctx: SelectionContext;
  showSize?: boolean;
}

/**
 * One price cell. Subscribes to exactly one (price, size) pair in the store,
 * so a tick elsewhere never re-renders it. Price moves flash briefly.
 */
export const OddsButton = memo(function OddsButton({ marketId, selectionId, side, level = 0, ctx, showSize = true }: Props) {
  const dispatch = useAppDispatch();
  const price = useAppSelector((s) => s.markets.books[marketId]?.runners[selectionId]?.[side === 'BACK' ? 'back' : 'lay'][level]?.price);
  const size = useAppSelector((s) => s.markets.books[marketId]?.runners[selectionId]?.[side === 'BACK' ? 'back' : 'lay'][level]?.size);
  const open = useAppSelector((s) => s.markets.books[marketId]?.status === 'OPEN' && s.markets.books[marketId]?.runners[selectionId]?.status === 'ACTIVE');
  const selected = useAppSelector((s) => level === 0 && s.betslip.selections.some((x) => x.key === selectionKey(marketId, selectionId, side)));
  const ref = useRef<HTMLButtonElement>(null);
  const prev = useRef(price);

  useEffect(() => {
    const el = ref.current;
    if (el && level === 0 && prev.current !== undefined && price !== undefined && price !== prev.current) {
      const cls = price > prev.current ? 'flash-up' : 'flash-down';
      el.classList.remove('flash-up', 'flash-down');
      void el.offsetWidth; // restart animation
      el.classList.add(cls);
    }
    prev.current = price;
  }, [price, level]);

  const disabled = !open || price === undefined;
  const label = price === undefined ? `${side.toLowerCase()} unavailable` : `${side === 'BACK' ? 'Back' : 'Lay'} ${ctx.selectionName} at ${fmtOdds(price)}`;
  return (
    <button
      ref={ref}
      type="button"
      className={`odds ${side === 'BACK' ? 'back' : 'lay'} ${level > 0 ? 'depth' : ''} ${selected ? 'selected' : ''} ${price === undefined ? 'empty' : ''}`}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={label}
      onClick={() => price !== undefined && dispatch(toggleSelection({ marketId, selectionId, side, price, ...ctx }))}
    >
      <span className="p num">{fmtOdds(price)}</span>
      {showSize && <span className="s num">{size !== undefined ? compact(size) : ''}</span>}
    </button>
  );
});

export const BackButton = (p: Omit<Props, 'side'>) => <OddsButton {...p} side="BACK" />;
export const LayButton = (p: Omit<Props, 'side'>) => <OddsButton {...p} side="LAY" />;
