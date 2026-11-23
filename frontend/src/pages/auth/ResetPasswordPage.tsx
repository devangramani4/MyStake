import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Field } from '../../components/ui/Field';
import { authApi } from '../../services/api/authApi';
import { errorMessage } from '../../utils/errors';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return setError("Passwords don't match");
    try {
      await authApi.resetPassword(token, pw);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Choose a new password</h1>
        {done ? (
          <><div className="alert alert-success">Password updated. All other sessions have been signed out.</div><Link to="/login" className="btn btn-primary btn-block">Log in</Link></>
        ) : (
          <>
            {!token && <div className="alert alert-danger">This reset link is missing its token.</div>}
            {error && <div className="alert alert-danger">{error}</div>}
            <Field label="New password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} hint="10+ characters, upper & lower case, and a number" />
            <Field label="Confirm password" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            <button className="btn btn-primary btn-lg btn-block" disabled={!token || !pw}>Update password</button>
          </>
        )}
      </form>
    </div>
  );
}
