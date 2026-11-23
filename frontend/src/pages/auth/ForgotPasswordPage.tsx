import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Field } from '../../components/ui/Field';
import { authApi } from '../../services/api/authApi';
import { errorMessage } from '../../utils/errors';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Reset password</h1>
        {sent ? (
          <div className="alert alert-success">If an account exists for {email}, we've sent a reset link. It expires in one hour.</div>
        ) : (
          <>
            <p className="muted">Enter your account email and we'll send you a reset link.</p>
            {error && <div className="alert alert-danger">{error}</div>}
            <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <button className="btn btn-primary btn-lg btn-block" disabled={!email}>Send reset link</button>
          </>
        )}
        <Link to="/login" className="muted" style={{ fontSize: 13 }}>Back to log in</Link>
      </form>
    </div>
  );
}
