import { Loader2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Field } from '../../components/ui/Field';
import { walletApi } from '../../services/api/accountApi';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchWallet } from '../../store/slices/walletSlice';
import { toAppError } from '../../utils/errors';
import { money } from '../../utils/format';
import { newIdempotencyKey } from '../../utils/id';

export default function WithdrawPage() {
  const dispatch = useAppDispatch();
  const wallet = useAppSelector((s) => s.wallet.wallet);
  const user = useAppSelector((s) => s.auth.user);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);
  const key = useRef(newIdempotencyKey());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const w = await walletApi.withdraw({ amount: Number(amount), method, destination: destination || undefined }, key.current);
      key.current = newIdempotencyKey();
      setMsg({ kind: 'success', text: `Withdrawal of ${money(w.amount)} requested. It will be reviewed shortly.` });
      setAmount('');
      dispatch(fetchWallet());
    } catch (err) {
      setMsg({ kind: 'danger', text: toAppError(err).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="page-title">Withdraw</h1>
      <form className="card card-pad stack" onSubmit={submit} style={{ maxWidth: 520 }}>
        {user && user.kycStatus !== 'VERIFIED' && <div className="alert alert-warning">Identity verification is required before withdrawing. Contact support to complete KYC.</div>}
        {msg && <div className={`alert alert-${msg.kind}`}>{msg.text}</div>}
        <div className="kv"><span>Available to withdraw</span><b className="num">{money(wallet?.balance)}</b></div>
        <Field label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        <div className="field">
          <label htmlFor="method">Method</label>
          <select id="method" className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="BANK_TRANSFER">Bank transfer</option><option value="UPI">UPI</option><option value="E_WALLET">E-wallet</option>
          </select>
        </div>
        <Field label="Account / UPI ID" value={destination} onChange={(e) => setDestination(e.target.value)} hint="Only the last 4 characters are stored with your request." autoComplete="off" />
        <p className="faint" style={{ fontSize: 12 }}>Funds are reserved immediately and returned if the withdrawal is cancelled or rejected. Funds in open bets (exposure) can't be withdrawn.</p>
        <button className="btn btn-primary btn-lg" disabled={busy || !(Number(amount) > 0) || Number(amount) > Number(wallet?.balance ?? 0)}>{busy ? <Loader2 className="spin" size={18} /> : 'Request withdrawal'}</button>
      </form>
    </>
  );
}
