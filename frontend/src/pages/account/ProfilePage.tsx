import { useState, type FormEvent } from 'react';
import { Field } from '../../components/ui/Field';
import { userApi } from '../../services/api/accountApi';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { userUpdated } from '../../store/slices/authSlice';
import { toast } from '../../store/slices/uiSlice';
import { errorMessage } from '../../utils/errors';
import { dateTime } from '../../utils/format';
import { StatusBadge } from '../../components/ui/StatusBadge';

export default function ProfilePage() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user)!;
  const [firstName, setFirstName] = useState(user.firstName ?? '');
  const [lastName, setLastName] = useState(user.lastName ?? '');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      dispatch(userUpdated(await userApi.update({ firstName, lastName })));
      dispatch(toast({ kind: 'success', title: 'Profile saved' }));
    } catch (err) {
      dispatch(toast({ kind: 'error', title: errorMessage(err) }));
    }
  };
  return (
    <>
      <h1 className="page-title">Profile</h1>
      <section className="card card-pad stack">
        <div className="stats">
          <div><div className="stat-label">Username</div><b>{user.username}</b></div>
          <div><div className="stat-label">Email</div><b className="row">{user.email} {user.emailVerified ? <span className="badge badge-success">Verified</span> : <span className="badge badge-warning">Unverified</span>}</b></div>
          <div><div className="stat-label">Identity (KYC)</div><StatusBadge status={user.kycStatus === 'VERIFIED' ? 'COMPLETED' : user.kycStatus} /></div>
          <div><div className="stat-label">Member since</div><b>{dateTime(user.createdAt)}</b></div>
        </div>
      </section>
      <form className="card card-pad stack" onSubmit={save} style={{ maxWidth: 560 }}>
        <div className="form-grid">
          <Field label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <Field label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <p className="faint" style={{ fontSize: 12 }}>To change your email or date of birth, contact support — these are verified identity details.</p>
        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>Save changes</button>
      </form>
    </>
  );
}
