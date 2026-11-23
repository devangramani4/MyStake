import { Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Field } from '../../components/ui/Field';
import { useAppDispatch } from '../../store/hooks';
import { register } from '../../store/slices/authSlice';
import { toast } from '../../store/slices/uiSlice';
import type { AppErrorInfo } from '../../utils/errors';

type Errors = Record<string, string>;

export default function RegisterPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [f, setF] = useState({ email: '', username: '', password: '', firstName: '', lastName: '', dateOfBirth: '', countryCode: '' });
  const [accept, setAccept] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const validate = (): Errors => {
    const e: Errors = {};
    if (!/^\S+@\S+\.\S+$/.test(f.email)) e.email = 'Enter a valid email';
    if (!/^[A-Za-z0-9_]{3,32}$/.test(f.username)) e.username = '3–32 letters, numbers or underscores';
    if (f.password.length < 10 || !/[a-z]/.test(f.password) || !/[A-Z]/.test(f.password) || !/\d/.test(f.password)) e.password = 'At least 10 characters with upper, lower case and a number';
    if (!f.dateOfBirth) e.dateOfBirth = 'Required';
    if (!accept) e.acceptTerms = 'You must accept the terms';
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setFormError(null);
    try {
      await dispatch(register({ ...f, countryCode: f.countryCode || undefined, firstName: f.firstName || undefined, lastName: f.lastName || undefined, acceptTerms: true })).unwrap();
      dispatch(toast({ kind: 'success', title: 'Account created', message: 'Check your email to verify your account before betting.' }));
      navigate('/account');
    } catch (err) {
      const e2 = err as AppErrorInfo;
      const fields = (e2.details?.fields as Array<{ path: string; message: string }> | undefined) ?? [];
      if (fields.length) setErrors(Object.fromEntries(fields.map((x) => [x.path, x.message])));
      setFormError(e2.message ?? 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="card auth-card wide" onSubmit={submit} noValidate>
        <div>
          <h1>Create your account</h1>
          <p className="muted">You must be of legal gambling age in your jurisdiction.</p>
        </div>
        {formError && <div className="alert alert-danger" role="alert">{formError}</div>}
        <div className="form-grid">
          <Field label="First name" autoComplete="given-name" value={f.firstName} onChange={set('firstName')} />
          <Field label="Last name" autoComplete="family-name" value={f.lastName} onChange={set('lastName')} />
        </div>
        <Field label="Email" type="email" autoComplete="email" value={f.email} onChange={set('email')} error={errors.email} />
        <Field label="Username" autoComplete="username" value={f.username} onChange={set('username')} error={errors.username} />
        <Field label="Password" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} error={errors.password} hint="10+ characters, upper & lower case, and a number" />
        <div className="form-grid">
          <Field label="Date of birth" type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} error={errors.dateOfBirth} max={new Date().toISOString().slice(0, 10)} />
          <Field label="Country (ISO code)" maxLength={2} placeholder="IN" value={f.countryCode} onChange={(e) => setF({ ...f, countryCode: e.target.value.toUpperCase() })} />
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          <span>I confirm I am of legal age and accept the <Link to="/terms" style={{ textDecoration: 'underline' }}>Terms</Link> and <Link to="/privacy" style={{ textDecoration: 'underline' }}>Privacy Policy</Link>.</span>
        </label>
        {errors.acceptTerms && <span className="field-error">{errors.acceptTerms}</span>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? <Loader2 className="spin" size={18} /> : 'Create account'}</button>
        <p className="muted" style={{ fontSize: 13, textAlign: 'center' }}>Already have an account? <Link to="/login" style={{ color: 'var(--brand)' }}>Log in</Link></p>
      </form>
    </div>
  );
}
