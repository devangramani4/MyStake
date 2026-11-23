import { QRCodeSVG } from 'qrcode.react';
import { Monitor, Smartphone } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Field } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { LoadingSkeleton } from '../../components/ui/States';
import { useAsync } from '../../hooks/useAsync';
import { userApi } from '../../services/api/accountApi';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { userUpdated } from '../../store/slices/authSlice';
import { toast } from '../../store/slices/uiSlice';
import { errorMessage } from '../../utils/errors';
import { timeAgo } from '../../utils/format';

function PasswordForm() {
  const dispatch = useAppDispatch();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await userApi.changePassword(current, next);
      setCurrent('');
      setNext('');
      dispatch(toast({ kind: 'success', title: 'Password changed', message: 'Other devices have been signed out.' }));
    } catch (err) {
      dispatch(toast({ kind: 'error', title: 'Could not change password', message: errorMessage(err) }));
    }
  };
  return (
    <form className="card card-pad stack" onSubmit={submit}>
      <h2 className="card-title">Change password</h2>
      <Field label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <Field label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} hint="10+ characters, upper & lower case, and a number" />
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={!current || !next}>Update password</button>
    </form>
  );
}

function TwoFactor() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user)!;
  const [setup, setSetup] = useState<{ otpauthUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [disabling, setDisabling] = useState(false);
  const enable = async () => {
    try {
      await userApi.enable2fa(code);
      dispatch(userUpdated({ ...user, twoFactorEnabled: true }));
      setSetup(null);
      setCode('');
      dispatch(toast({ kind: 'success', title: 'Two-factor authentication enabled' }));
    } catch (err) {
      dispatch(toast({ kind: 'error', title: errorMessage(err) }));
    }
  };
  const disable = async () => {
    try {
      await userApi.disable2fa(password, code);
      dispatch(userUpdated({ ...user, twoFactorEnabled: false }));
      setDisabling(false);
      setCode('');
      setPassword('');
      dispatch(toast({ kind: 'success', title: 'Two-factor authentication disabled' }));
    } catch (err) {
      dispatch(toast({ kind: 'error', title: errorMessage(err) }));
    }
  };
  return (
    <section className="card card-pad stack">
      <div className="row between">
        <h2 className="card-title">Two-factor authentication</h2>
        {user.twoFactorEnabled ? <span className="badge badge-success">On</span> : <span className="badge">Off</span>}
      </div>
      <p className="muted">Protect your account with a code from an authenticator app when you log in.</p>
      {user.twoFactorEnabled ? (
        <button className="btn btn-danger" style={{ alignSelf: 'flex-start' }} onClick={() => setDisabling(true)}>Turn off</button>
      ) : setup ? (
        <div className="stack">
          <div className="row wrap" style={{ gap: 20, alignItems: 'flex-start' }}>
            <div style={{ background: 'white', padding: 10, borderRadius: 8 }}><QRCodeSVG value={setup.otpauthUrl} size={148} /></div>
            <div className="stack grow" style={{ gap: 8 }}>
              <span className="muted" style={{ fontSize: 13 }}>Scan with your authenticator app, or enter this key:</span>
              <code className="num" style={{ wordBreak: 'break-all', background: 'var(--surface-2)', padding: 8, borderRadius: 6 }}>{setup.secret}</code>
              <Field label="6-digit code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <button className="btn btn-primary" onClick={enable} disabled={code.length !== 6}>Verify &amp; enable</button>
            </div>
          </div>
        </div>
      ) : (
        <button className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => userApi.setup2fa().then(setSetup).catch((e) => dispatch(toast({ kind: 'error', title: errorMessage(e) })))}>Set up</button>
      )}
      <Modal open={disabling} title="Turn off two-factor" onClose={() => setDisabling(false)} footer={<button className="btn btn-danger" onClick={disable} disabled={!password || code.length !== 6}>Turn off</button>}>
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Field label="Authentication code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      </Modal>
    </section>
  );
}

function Sessions() {
  const dispatch = useAppDispatch();
  const { data, loading, reload } = useAsync(() => userApi.sessions(), []);
  return (
    <section className="card">
      <div className="card-header"><span className="card-title">Devices &amp; sessions</span></div>
      {loading ? <LoadingSkeleton rows={2} /> : data?.map((s) => (
        <div key={s.id} className="mcard" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {/mobile|android|iphone/i.test(s.userAgent ?? '') ? <Smartphone size={20} /> : <Monitor size={20} />}
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="ellipsis" style={{ fontWeight: 600 }}>{s.userAgent?.split(')')[0].split('(')[1] ?? 'Unknown device'} {s.current && <span className="badge badge-success">This device</span>}</div>
            <div className="faint" style={{ fontSize: 12 }}>{s.ip ?? 'unknown IP'} · active {timeAgo(s.lastActiveAt)}</div>
          </div>
          {!s.current && <button className="btn btn-sm btn-secondary" onClick={() => userApi.revokeSession(s.id).then(() => { dispatch(toast({ kind: 'success', title: 'Device signed out' })); void reload(); })}>Sign out</button>}
        </div>
      ))}
    </section>
  );
}

export default function SecurityPage() {
  return (
    <>
      <h1 className="page-title">Security</h1>
      <PasswordForm />
      <TwoFactor />
      <Sessions />
    </>
  );
}
