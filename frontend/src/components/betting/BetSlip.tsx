import { Loader2, Ticket, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { betsApi } from '../../services/api/accountApi';
import { bettingService } from '../../services/betfair/bettingService';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { selectSlipTotals } from '../../store/selectors';
import { clearSlip, removeKeys, setPolicy, setPrice, setSlipOpen, type Selection } from '../../store/slices/betslipSlice';
import { toast } from '../../store/slices/uiSlice';
import { fetchWallet } from '../../store/slices/walletSlice';
import type { BetItem } from '../../types';
import { toAppError } from '../../utils/errors';
import { isValidPrice, liability, profit } from '../../utils/exchange';
import { money, odds as fmtOdds, statusLabel } from '../../utils/format';
import { newIdempotencyKey } from '../../utils/id';
import { Modal } from '../ui/Modal';
import { SideBadge, StatusBadge } from '../ui/StatusBadge';
import { EmptyState } from '../ui/States';
import { BetRow } from './BetRow';
import { config } from '../../config';

function useSlipBlocked(selections: Selection[]) {
  const books = useAppSelector((s) => s.markets.books);
  const policy = useAppSelector((s) => s.betslip.unmatchedPolicy);
  return useMemo(() => {
    for (const sel of selections) {
      const b = books[sel.marketId];
      if (!sel.stake || Number(sel.stake) < config.minStake) return 'Enter a stake for every selection';
      if (!isValidPrice(sel.price)) return 'Fix invalid odds';
      if (b && b.status !== 'OPEN') return 'A market in your slip is suspended or closed';
      const r = b?.runners[sel.selectionId];
      if (r && r.status !== 'ACTIVE') return 'A selection is no longer available';
      if (r && policy === 'REJECT') {
        const best = (sel.side === 'BACK' ? r.back : r.lay)[0];
        if (!best || (sel.side === 'BACK' ? best.price < sel.price : best.price > sel.price)) return 'Odds have changed — review your slip';
      }
    }
    return null;
  }, [selections, books, policy]);
}

function OpenBets() {
  const version = useAppSelector((s) => s.ui.betsVersion);
  const [items, setItems] = useState<BetItem[] | null>(null);
  const dispatch = useAppDispatch();
  useEffect(() => {
    betsApi.list({ view: 'open', range: 'all', pageSize: 30 }).then((p) => setItems(p.items)).catch(() => setItems([]));
  }, [version]);
  if (!items) return <div className="slip-empty"><Loader2 className="spin" size={20} /></div>;
  if (!items.length) return <EmptyState title="No open bets" message="Matched and unmatched bets appear here." />;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {items.map((b) => (
        <div key={b.id} className={`bet-row ${b.side === 'LAY' ? 'lay' : ''}`}>
          <div className="bet-row-top">
            <div style={{ minWidth: 0 }}>
              <div className="row"><SideBadge side={b.side} /><span className="sel ellipsis">{b.selectionName}</span></div>
              <div className="mkt ellipsis">{b.marketName} · {b.eventName}</div>
            </div>
            <StatusBadge status={b.status} />
          </div>
          <div className="kv"><span>Odds / stake</span><b className="num">{fmtOdds(b.avgPriceMatched ?? b.price)} · {money(b.stake)}</b></div>
          {b.status !== 'MATCHED' && <div className="kv"><span>Matched</span><b className="num">{money(b.sizeMatched)}</b></div>}
          {(b.status === 'UNMATCHED' || b.status === 'PARTIALLY_MATCHED') && (
            <button
              className="btn btn-sm btn-secondary"
              onClick={() =>
                betsApi
                  .cancel(b.id)
                  .then(() => { dispatch(toast({ kind: 'success', title: 'Unmatched stake cancelled' })); dispatch(fetchWallet()); setItems((x) => x?.filter((y) => y.id !== b.id) ?? null); })
                  .catch((e) => dispatch(toast({ kind: 'error', title: 'Could not cancel', message: toAppError(e).message })))
              }
            >
              Cancel unmatched
            </button>
          )}
        </div>
      ))}
      <Link to="/account/bets" className="btn btn-ghost btn-sm">View all bets</Link>
    </div>
  );
}

/** Bet slip with live validation, confirmation step and idempotent submission. */
export function BetSlip() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const selections = useAppSelector((s) => s.betslip.selections);
  const policy = useAppSelector((s) => s.betslip.unmatchedPolicy);
  const authed = useAppSelector((s) => s.auth.status === 'authenticated');
  const wallet = useAppSelector((s) => s.wallet.wallet);
  const totals = useAppSelector(selectSlipTotals);
  const blocked = useSlipBlocked(selections);
  const [tab, setTab] = useState<'slip' | 'open'>('slip');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const idemKey = useRef<string | null>(null);
  const house = useAppSelector((s) => s.ui.executionMode === 'house');
  const insufficient = wallet ? totals.liability > Number(wallet.balance) : false;

  const openConfirm = () => {
    idemKey.current = newIdempotencyKey(); // one key per confirmation; retries reuse it
    setConfirming(true);
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    const sent = [...selections];
    try {
      const r = await bettingService.place(sent.map((s) => ({ marketId: s.marketId, selectionId: s.selectionId, side: s.side, price: s.price, stake: Number(s.stake) })), idemKey.current!, policy);
      const placed = r.bet.items.filter((i) => i.status !== 'FAILED');
      const failed = r.bet.items.filter((i) => i.status === 'FAILED');
      dispatch(removeKeys(sent.filter((_, i) => r.bet.items[i]?.status !== 'FAILED').map((s) => s.key)));
      if (r.bet.status === 'PENDING') dispatch(toast({ kind: 'warning', title: 'Bet submitted', message: 'Waiting for exchange confirmation — check Open bets.' }));
      else dispatch(toast({ kind: failed.length ? 'warning' : 'success', title: `${placed.length} bet${placed.length === 1 ? '' : 's'} placed`, message: placed.map((p) => `${p.selectionName}: ${statusLabel[p.status]}`).join(' · ') }));
      setConfirming(false);
      idemKey.current = null;
      dispatch(fetchWallet());
    } catch (e) {
      const err = toAppError(e);
      if (err.code === 'NETWORK_ERROR' || err.code === 'EXCHANGE_TIMEOUT') {
        // Keep the same idempotency key so a retry can't double-place.
        dispatch(toast({ kind: 'warning', title: 'Connection problem', message: 'Your bet may have been placed. Retrying is safe — it will not be duplicated.' }));
      } else {
        if (err.code === 'ODDS_CHANGED' && err.details?.currentPrice) {
          const sel = selections.find((s) => s.marketId === err.details!.marketId && s.selectionId === err.details!.selectionId);
          if (sel) dispatch(setPrice({ key: sel.key, price: Number(err.details.currentPrice) }));
        }
        dispatch(toast({ kind: 'error', title: 'Bet not placed', message: err.message }));
        setConfirming(false);
        idemKey.current = null;
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="slip">
      <div className="slip-head">
        <div className="tabs" style={{ border: 0 }}>
          <button className={`tab ${tab === 'slip' ? 'active' : ''}`} onClick={() => setTab('slip')}>Bet slip {selections.length > 0 && <span className="badge badge-brand">{selections.length}</span>}</button>
          {authed && <button className={`tab ${tab === 'open' ? 'active' : ''}`} onClick={() => setTab('open')}>Open bets</button>}
        </div>
        {tab === 'slip' && selections.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => dispatch(clearSlip())}><Trash2 size={14} /> Clear</button>}
      </div>
      <div className="slip-body">
        {tab === 'open' ? (
          <OpenBets />
        ) : selections.length === 0 ? (
          <div className="slip-empty"><Ticket size={34} /><b style={{ color: 'var(--text)' }}>Your bet slip is empty</b><span>Click a back (blue) or lay (pink) price to add a selection.</span></div>
        ) : (
          selections.map((s) => <BetRow key={s.key} sel={s} />)
        )}
      </div>
      {tab === 'slip' && selections.length > 0 && (
        <div className="slip-foot">
          <label className="checkbox">
            <input type="checkbox" checked={policy === 'KEEP'} onChange={(e) => dispatch(setPolicy(e.target.checked ? 'KEEP' : 'REJECT'))} />
            <span>{house ? "If these odds aren't available right now, keep my bet waiting and match it when the price comes back (it is cancelled automatically when the event starts)" : "Keep my bet on the exchange if odds or liquidity aren't available (unmatched bets can be cancelled)"}</span>
          </label>
          <div className="kv"><span>Total stake</span><b className="num">{money(totals.stake)}</b></div>
          <div className="kv"><span>Total liability</span><b className="num">{money(totals.liability)}</b></div>
          <div className="kv"><span>Max profit</span><b className="num pos">{money(totals.profit)}</b></div>
          {authed && insufficient && <div className="alert alert-danger">Insufficient balance. <Link to="/account/wallet/deposit" style={{ textDecoration: 'underline' }}>Deposit</Link></div>}
          {authed ? (
            <button className="btn btn-primary btn-lg btn-block" disabled={!!blocked || insufficient} onClick={openConfirm} title={blocked ?? undefined}>
              {blocked ?? `Place bet${selections.length > 1 ? 's' : ''} · ${money(totals.liability)}`}
            </button>
          ) : (
            <Link className="btn btn-primary btn-lg btn-block" to="/login" state={{ from: location.pathname }} onClick={() => dispatch(setSlipOpen(false))}>Log in to place bets</Link>
          )}
        </div>
      )}
      <Modal
        open={confirming}
        title="Confirm your bets"
        onClose={() => !submitting && setConfirming(false)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={submitting}>Back</button>
            <button className="btn btn-primary" onClick={submit} disabled={submitting || !!blocked}>
              {submitting ? <><Loader2 size={16} className="spin" /> Placing…</> : `Confirm · ${money(totals.liability)}`}
            </button>
          </>
        }
      >
        {blocked && <div className="alert alert-warning">{blocked}</div>}
        <div className="stack" style={{ gap: 10 }}>
          {selections.map((s) => {
            const st = Number(s.stake) || 0;
            return (
              <div key={s.key} className="card" style={{ padding: 12 }}>
                <div className="row between"><span className="row"><SideBadge side={s.side} /><b>{s.selectionName}</b></span><b className="num">@ {fmtOdds(s.price)}</b></div>
                <div className="faint" style={{ fontSize: 12, margin: '4px 0 8px' }}>{s.eventName} · {s.marketName} · {s.side === 'BACK' ? 'Back bet' : 'Lay bet'}</div>
                <div className="kv"><span>Stake</span><b className="num">{money(st)}</b></div>
                <div className="kv"><span>Liability</span><b className="num">{money(liability(s.side, st, s.price))}</b></div>
                <div className="kv"><span>Profit</span><b className="num pos">{money(profit(s.side, st, s.price))}</b></div>
              </div>
            );
          })}
        </div>
        <div className="kv"><span>Total liability</span><b className="num">{money(totals.liability)}</b></div>
        {wallet && <div className="kv"><span>Balance after</span><b className="num">{money(Number(wallet.balance) - totals.liability)}</b></div>}
        <p className="faint" style={{ fontSize: 12 }}>
          {policy === 'KEEP' ? `Any part not matched immediately stays ${house ? 'open' : 'on the exchange'} and lapses when the market turns in-play.` : `If the odds${house ? '' : ' or liquidity'} aren't available, the bet won't be placed.`} Commission applies to net market winnings.
        </p>
      </Modal>
    </div>
  );
}
