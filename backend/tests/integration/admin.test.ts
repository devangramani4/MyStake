import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/config/db.js';
import { api, bearer, createAdmin, createUser, idem, resetWorld, wallet } from '../helpers.js';

beforeAll(async () => {
  await resetWorld();
});

describe('admin permissions & audit', () => {
  it('rejects user tokens and anonymous access', async () => {
    const u = await createUser();
    expect((await api().get('/api/admin/dashboard')).status).toBe(401);
    expect((await api().get('/api/admin/dashboard').set(bearer(u.token))).status).toBe(401);
  });

  it('enforces the role matrix', async () => {
    const support = await createAdmin('SUPPORT');
    const risk = await createAdmin('RISK_MANAGER');
    const u = await createUser();
    expect((await api().get('/api/admin/dashboard').set(bearer(support))).status).toBe(200);
    expect((await api().get('/api/admin/users').set(bearer(support))).status).toBe(200);
    expect((await api().post(`/api/admin/users/${u.id}/adjustments`).set(bearer(support)).set('Idempotency-Key', idem()).send({ amount: 10, reason: 'goodwill' })).status).toBe(403);
    expect((await api().post(`/api/admin/users/${u.id}/status`).set(bearer(support)).send({ status: 'SUSPENDED', reason: 'test' })).status).toBe(403);
    expect((await api().get('/api/admin/admins').set(bearer(risk))).status).toBe(403);
    expect((await api().post(`/api/admin/users/${u.id}/restrictions`).set(bearer(risk)).send({ max_stake: 50, reason: 'risk review' })).status).toBe(200);
  });

  it('applies manual adjustments through the ledger with an audit trail', async () => {
    const admin = await createAdmin('ADMIN');
    const u = await createUser({ balance: 0 });
    const key = idem();
    for (let i = 0; i < 2; i++) {
      const r = await api().post(`/api/admin/users/${u.id}/adjustments`).set(bearer(admin)).set('Idempotency-Key', key).send({ amount: 25.5, reason: 'Goodwill credit' });
      expect(r.status).toBe(200);
    }
    expect((await wallet(u.id)).balance).toBe(25.5);
    const audit = await query<{ action: string; reason: string }>(`SELECT action, reason FROM audit_logs WHERE target_type = 'user' AND target_id = ? AND action = 'WALLET_ADJUSTMENT'`, [String(u.id)]);
    expect(audit).toEqual([{ action: 'WALLET_ADJUSTMENT', reason: 'Goodwill credit' }]);
    expect((await api().post(`/api/admin/users/${u.id}/adjustments`).set(bearer(admin)).set('Idempotency-Key', idem()).send({ amount: -100, reason: 'too much' })).body.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('suspending a user revokes sessions and blocks login', async () => {
    const admin = await createAdmin('ADMIN');
    const u = await createUser();
    await api().post(`/api/admin/users/${u.id}/status`).set(bearer(admin)).send({ status: 'SUSPENDED', reason: 'investigation' });
    expect((await api().post('/api/auth/login').send({ identifier: u.username, password: u.password })).body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('admin-suspended markets reject bets', async () => {
    const admin = await createAdmin('ADMIN');
    const u = await createUser({ balance: 100 });
    const [m] = await query<{ id: number; betfair_id: string }>(`SELECT id, betfair_id FROM markets WHERE market_type = 'MATCH_ODDS' AND status = 'OPEN' LIMIT 1`);
    const [r] = await query<{ selection_id: number }>('SELECT selection_id FROM market_runners WHERE market_id = ? LIMIT 1', [m.id]);
    await api().post(`/api/admin/markets/${m.id}/flags`).set(bearer(admin)).send({ field: 'admin_suspended', value: true, reason: 'integrity concern' });
    const res = await api().post('/api/bets').set(bearer(u.token)).set('Idempotency-Key', idem()).send({ items: [{ marketId: m.betfair_id, selectionId: Number(r.selection_id), side: 'BACK', price: 2, stake: 10 }] });
    expect(res.body.error.code).toBe('MARKET_SUSPENDED');
  });

  it('dashboard aggregates platform metrics', async () => {
    const admin = await createAdmin('SUPER_ADMIN');
    const res = await api().get('/api/admin/dashboard').set(bearer(admin));
    expect(res.body.users.total).toBeGreaterThan(0);
    expect(res.body.apiStatus.mode).toBe('mock');
  });
});
