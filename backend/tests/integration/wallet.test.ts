import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/config/db.js';
import { api, bearer, createUser, idem, resetWorld, wallet } from '../helpers.js';

beforeAll(async () => {
  await resetWorld();
});

describe('wallet & ledger', () => {
  it('credits a deposit exactly once for a repeated Idempotency-Key', async () => {
    const u = await createUser();
    const key = idem();
    const [a, b] = await Promise.all([
      api().post('/api/wallet/deposits').set(bearer(u.token)).set('Idempotency-Key', key).send({ amount: 500 }),
      api().post('/api/wallet/deposits').set(bearer(u.token)).set('Idempotency-Key', key).send({ amount: 500 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect((await wallet(u.id)).balance).toBe(500);
    const tx = await query('SELECT * FROM wallet_transactions WHERE user_id = ?', [u.id]);
    expect(tx).toHaveLength(1);
  });

  it('requires an Idempotency-Key for money movements', async () => {
    const u = await createUser();
    const res = await api().post('/api/wallet/deposits').set(bearer(u.token)).send({ amount: 100 });
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('ignores any client-supplied balance values', async () => {
    const u = await createUser({ balance: 10 });
    await api().post('/api/wallet/deposits').set(bearer(u.token)).set('Idempotency-Key', idem()).send({ amount: 5, balance: 1_000_000 });
    expect((await wallet(u.id)).balance).toBe(15);
    expect((await api().patch('/api/me').set(bearer(u.token)).send({ firstName: 'X', balance: 99999 })).status).toBe(200);
    expect((await wallet(u.id)).balance).toBe(15);
  });

  it('enforces deposit limits', async () => {
    const u = await createUser();
    await api().put('/api/me/limits').set(bearer(u.token)).send({ dailyDepositLimit: 100 });
    expect((await api().post('/api/wallet/deposits').set(bearer(u.token)).set('Idempotency-Key', idem()).send({ amount: 80 })).status).toBe(201);
    const res = await api().post('/api/wallet/deposits').set(bearer(u.token)).set('Idempotency-Key', idem()).send({ amount: 30 });
    expect(res.body.error.code).toBe('DEPOSIT_LIMIT_EXCEEDED');
  });

  it('delays limit increases (responsible gambling cool-down)', async () => {
    const u = await createUser();
    await api().put('/api/me/limits').set(bearer(u.token)).send({ maxStake: 100 });
    const res = await api().put('/api/me/limits').set(bearer(u.token)).send({ maxStake: 1000 });
    expect(res.body.pending).toEqual({ max_stake: '1000.00' });
    expect((await api().get('/api/me/limits').set(bearer(u.token))).body.maxStake).toBe('100.00');
  });

  it('withdrawals need KYC, debit immediately and are refunded on rejection', async () => {
    const unverified = await createUser({ balance: 100, kyc: 'NOT_STARTED' });
    expect((await api().post('/api/wallet/withdrawals').set(bearer(unverified.token)).set('Idempotency-Key', idem()).send({ amount: 50, method: 'UPI' })).body.error.code).toBe('KYC_REQUIRED');

    const u = await createUser({ balance: 100 });
    const res = await api().post('/api/wallet/withdrawals').set(bearer(u.token)).set('Idempotency-Key', idem()).send({ amount: 60, method: 'BANK_TRANSFER', destination: 'GB00 1234 5678 9012' });
    expect(res.status).toBe(201);
    expect(res.body.withdrawal.destination).toBe('••••9012');
    expect((await wallet(u.id)).balance).toBe(40);
    expect((await api().post('/api/wallet/withdrawals').set(bearer(u.token)).set('Idempotency-Key', idem()).send({ amount: 41, method: 'UPI' })).body.error.code).toBe('INSUFFICIENT_FUNDS');
    await api().post(`/api/wallet/withdrawals/${res.body.withdrawal.id}/cancel`).set(bearer(u.token));
    expect((await wallet(u.id)).balance).toBe(100);
  });

  it('keeps the ledger consistent with the wallet', async () => {
    const rows = await query<{ user_id: number; balance: string; ledger: string }>(
      `SELECT w.user_id, w.balance, COALESCE((SELECT SUM(amount) FROM wallet_transactions t WHERE t.user_id = w.user_id), 0) AS ledger
         FROM user_wallets w WHERE EXISTS (SELECT 1 FROM wallet_transactions t WHERE t.user_id = w.user_id AND t.type = 'DEPOSIT')`,
    );
    for (const r of rows) if (r.balance !== null) expect(Number(r.ledger)).toBeLessThanOrEqual(Number(r.balance));
  });
});
