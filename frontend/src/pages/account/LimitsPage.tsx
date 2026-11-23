import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Field } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { LoadingSkeleton } from '../../components/ui/States';
import { userApi, type Limits } from '../../services/api/accountApi';
import { useAppDispatch } from '../../store/hooks';
import { logout } from '../../store/slices/authSlice';
import { toast } from '../../store/slices/uiSlice';
import { errorMessage } from '../../utils/errors';
import { dateTime, money } from '../../utils/format';

const FIELDS: Array<[keyof Limits, string, string]> = [
  ['dailyDepositLimit', 'Daily deposit limit', 'dailyDepositLimit'],
  ['weeklyDepositLimit', 'Weekly deposit limit', 'weeklyDepositLimit'],
  ['monthlyDepositLimit', 'Monthly deposit limit', 'monthlyDepositLimit'],
  ['dailyLossLimit', 'Daily loss limit', 'dailyLossLimit'],
  ['maxStake', 'Maximum stake per bet', 'maxStake'],
  ['maxExposure', 'Maximum total exposure', 'maxExposure'],
];
const PENDING_KEY: Record<string, string> = { dailyDepositLimit: 'daily_deposit_limit', weeklyDepositLimit: 'weekly_deposit_limit', monthlyDepositLimit: 'monthly_deposit_limit', dailyLossLimit: 'daily_loss_limit', maxStake: 'max_stake', maxExposure: 'max_exposure' };

export default function LimitsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [limits, setLimits] = useState<Limits | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [exclude, setExclude] = useState<string | null>(null);
  const [password, setPassword] = useState('');

  const load = () =>
    userApi.limits().then((l) => {
      setLimits(l);
      setForm(Object.fromEntries(FIELDS.map(([k]) => [k, (l[k] as string | null) ?? ''])));
    });
  useEffect(() => void load(), []);

  const save = async () => {
    const body = Object.fromEntries(FIELDS.map(([k]) => [k, form[k] === '' ? null : Number(form[k])]));
    try {
      const r = await userApi.setLimits(body);
      const pending = Object.keys(r.pending).length;
      dispatch(toast({ kind: 'success', title: 'Limits saved', message: pending ? 'Increases and removals take effect after a 24-hour cooling period.' : 'Your new limits apply immediately.' }));
      void load();
    } catch (e) {
      dispatch(toast({ kind: 'error', title: errorMessage(e) }));
    }
  };

  const coolOff = (hours: number) =>
    userApi.coolOff(hours).then(() => { dispatch(toast({ kind: 'success', title: 'Cooling-off started', message: `Betting is paused for ${hours >= 168 ? `${hours / 24} days` : `${hours} hours`}.` })); void load(); }).catch((e) => dispatch(toast({ kind: 'error', title: errorMessage(e) })));

  const selfExclude = async () => {
    try {
      await userApi.selfExclude(exclude!, password);
      dispatch(toast({ kind: 'info', title: 'Self-exclusion active', message: 'You have been signed out.' }));
      await dispatch(logout());
      navigate('/');
    } catch (e) {
      dispatch(toast({ kind: 'error', title: errorMessage(e) }));
    }
  };

  if (!limits) return <LoadingSkeleton rows={6} />;
  return (
    <>
      <div>
        <h1 className="page-title">Responsible gambling</h1>
        <p className="page-sub">Set limits that suit you. Lower limits apply immediately; higher limits after 24 hours.</p>
      </div>
      {limits.coolingOffUntil && new Date(limits.coolingOffUntil) > new Date() && <div className="alert alert-info">Cooling-off active until {dateTime(limits.coolingOffUntil)}.</div>}
      <section className="card card-pad stack">
        <h2 className="card-title">Limits</h2>
        <div className="form-grid">
          {FIELDS.map(([k, label]) => {
            const pending = limits.pendingChanges?.[PENDING_KEY[k]];
            return (
              <Field key={k} label={label} inputMode="decimal" placeholder="No limit" value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value.replace(/[^\d.]/g, '') })}
                hint={pending !== undefined ? `Changing to ${pending === null ? 'no limit' : money(pending)} on ${dateTime(limits.pendingEffectiveAt)}` : undefined} />
            );
          })}
        </div>
        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={save}>Save limits</button>
      </section>
      <section className="card card-pad stack">
        <h2 className="card-title">Take a break</h2>
        <p className="muted">Pause betting for a short period. You can still log in and withdraw.</p>
        <div className="row wrap">{[[24, '24 hours'], [72, '3 days'], [168, '7 days'], [720, '30 days']].map(([h, l]) => <button key={h} className="btn btn-secondary" onClick={() => coolOff(h as number)}>{l}</button>)}</div>
      </section>
      <section className="card card-pad stack">
        <h2 className="card-title">Self-exclusion</h2>
        <p className="muted">Close your account for a fixed period. This cannot be reversed early. You will be signed out immediately.</p>
        <div className="row wrap">{[['180', '6 months'], ['365', '1 year'], ['1825', '5 years'], ['PERMANENT', 'Permanently']].map(([v, l]) => <button key={v} className="btn btn-danger" onClick={() => setExclude(v)}>{l}</button>)}</div>
      </section>
      <Modal open={!!exclude} title="Confirm self-exclusion" onClose={() => setExclude(null)} footer={<><button className="btn btn-secondary" onClick={() => setExclude(null)}>Cancel</button><button className="btn btn-danger" disabled={!password} onClick={selfExclude}>Exclude me</button></>}>
        <div className="alert alert-warning">You won't be able to bet or reopen your account until the period ends.</div>
        <Field label="Confirm with your password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Modal>
    </>
  );
}
