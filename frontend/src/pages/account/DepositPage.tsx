import { Loader2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Field } from '../../components/ui/Field';
import { walletApi, type Deposit } from '../../services/api/accountApi';
import { useAppDispatch } from '../../store/hooks';
import { fetchWallet } from '../../store/slices/walletSlice';
import { errorMessage } from '../../utils/errors';
import { money } from '../../utils/format';
import { newIdempotencyKey } from '../../utils/id';

const PRESETS = [500, 1000, 5000, 10000];

export default function DepositPage() {
  const dispatch = useAppDispatch();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Deposit | null>(null);
  const key = useRef(newIdempotencyKey());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The server validates limits and credits the wallet; the client never sets balances.
      const d = await walletApi.deposit(Number(amount), key.current);
      setResult(d);
      key.current = newIdempotencyKey();
      dispatch(fetchWallet());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="page-title">Deposit</h1>
      <form className="card card-pad stack" onSubmit={submit} style={{ maxWidth: 520 }}>
        {result ? (
          <>
            <div className={`alert ${result.status === 'COMPLETED' ? 'alert-success' : 'alert-info'}`}>
              {result.status === 'COMPLETED' ? `${money(result.amount)} has been added to your wallet.` : `Deposit of ${money(result.amount)} is pending. ${result.instructions ?? ''}`}
            </div>
            <div className="row"><button type="button" className="btn btn-secondary" onClick={() => { setResult(null); setAmount(''); }}>Make another deposit</button><Link to="/sports" className="btn btn-primary">Start betting</Link></div>
          </>
        ) : (
          <>
            {error && <div className="alert alert-danger">{error}</div>}
            <div className="quick-stakes">{PRESETS.map((p) => <button type="button" key={p} onClick={() => setAmount(String(p))}>{money(p)}</button>)}</div>
            <Field label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
            <p className="faint" style={{ fontSize: 12 }}>Deposits count towards your deposit limits. Payments are processed by a regulated payment provider; card details are never stored by us.</p>
            <button className="btn btn-primary btn-lg" disabled={busy || !(Number(amount) > 0)}>{busy ? <Loader2 className="spin" size={18} /> : `Deposit ${amount ? money(amount) : ''}`}</button>
          </>
        )}
      </form>
    </>
  );
}
