import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authApi } from '../../services/api/authApi';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { userUpdated } from '../../store/slices/authSlice';
import { errorMessage } from '../../utils/errors';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [error, setError] = useState('');
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return; // token is single-use; avoid StrictMode double call
    ran.current = true;
    authApi
      .verifyEmail(params.get('token') ?? '')
      .then(() => {
        setState('ok');
        if (user) dispatch(userUpdated({ ...user, emailVerified: true }));
      })
      .catch((e) => {
        setError(errorMessage(e));
        setState('error');
      });
  }, [params, dispatch, user]);
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>Email verification</h1>
        {state === 'working' && <p className="muted">Verifying…</p>}
        {state === 'ok' && <div className="alert alert-success">Your email is verified. You can now place bets.</div>}
        {state === 'error' && <div className="alert alert-danger">{error}</div>}
        <Link to="/" className="btn btn-secondary btn-block">Continue</Link>
      </div>
    </div>
  );
}
