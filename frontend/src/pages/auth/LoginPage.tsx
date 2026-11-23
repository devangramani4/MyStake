import { Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Field } from '../../components/ui/Field';
import { useAppDispatch } from '../../store/hooks';
import { login } from '../../store/slices/authSlice';
import { toast } from '../../store/slices/uiSlice';
import type { AppErrorInfo } from '../../utils/errors';

export default function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await dispatch(login({ identifier, password, totpCode: needs2fa ? totp : undefined })).unwrap();
      dispatch(toast({ kind: 'success', title: 'Welcome back' }));
      navigate(from, { replace: true });
    } catch (err) {
      const e2 = err as AppErrorInfo;
      if (e2.code === 'TWO_FACTOR_REQUIRED') {
        setNeeds2fa(true);
        setError(null);
      } else setError(e2.message ?? 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit} noValidate>
        <div>
          <h1>Log in</h1>
          <p className="muted">Welcome back. Bet responsibly.</p>
        </div>
        {error && <div className="alert alert-danger" role="alert">{error}</div>}
        <Field label="Email or username" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
        <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {needs2fa && <Field label="Authentication code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} autoFocus />}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !identifier || !password}>{busy ? <Loader2 className="spin" size={18} /> : 'Log in'}</button>
        <div className="row between" style={{ fontSize: 13 }}>
          <Link to="/forgot-password" className="muted">Forgot password?</Link>
          <span className="muted">New here? <Link to="/register" style={{ color: 'var(--brand)' }}>Create account</Link></span>
        </div>
      </form>
    </div>
  );
}
