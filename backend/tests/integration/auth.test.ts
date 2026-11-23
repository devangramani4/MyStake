import { generate } from 'otplib';
import { beforeAll, describe, expect, it } from 'vitest';
import { queryOne } from '../../src/config/db.js';
import { devMailbox } from '../../src/services/emailService.js';
import { api, bearer, createUser, resetWorld } from '../helpers.js';

const cookieVal = (cookies: string[], name: string) => cookies.find((c) => c.startsWith(`${name}=`))!.split(';')[0];

beforeAll(async () => {
  await resetWorld();
});

describe('registration & login', () => {
  const body = { email: 'new@test.dev', username: 'newuser', password: 'Str0ngPassword', dateOfBirth: '1995-05-05', acceptTerms: true };

  it('registers, hashes the password with argon2id and creates a zero wallet', async () => {
    const res = await api().post('/api/auth/register').send(body);
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.emailVerified).toBe(false);
    const row = await queryOne<{ password_hash: string }>('SELECT password_hash FROM users WHERE username = ?', ['newuser']);
    expect(row!.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(row!.password_hash).not.toContain('Str0ngPassword');
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.find((c) => c.startsWith('rt='))).toMatch(/HttpOnly/i);
    expect(cookies.find((c) => c.startsWith('rt='))).toMatch(/SameSite=Strict/i);
  });

  it('rejects duplicates, under-age users and weak passwords', async () => {
    expect((await api().post('/api/auth/register').send(body)).status).toBe(409);
    expect((await api().post('/api/auth/register').send({ ...body, email: 'kid@test.dev', username: 'kid', dateOfBirth: new Date().toISOString().slice(0, 10) })).body.error.code).toBe('VALIDATION_ERROR');
    expect((await api().post('/api/auth/register').send({ ...body, email: 'w@test.dev', username: 'weak', password: 'short' })).status).toBe(400);
  });

  it('verifies email via the emailed token (single use)', async () => {
    const mail = devMailbox.find((m) => m.to === 'new@test.dev')!;
    const token = new URL(mail.text.split(' ').pop()!).searchParams.get('token')!;
    expect((await api().post('/api/auth/verify-email').send({ token })).status).toBe(200);
    expect((await api().post('/api/auth/verify-email').send({ token })).status).toBe(400);
  });

  it('locks the account after repeated failures', async () => {
    const u = await createUser();
    for (let i = 0; i < 5; i++) await api().post('/api/auth/login').send({ identifier: u.username, password: 'wrong-password' });
    const res = await api().post('/api/auth/login').send({ identifier: u.username, password: u.password });
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('refresh-token rotation', () => {
  it('requires CSRF, rotates the token, and revokes the family on reuse', async () => {
    const u = await createUser();
    const rt = cookieVal(u.cookies, 'rt');
    const csrf = cookieVal(u.cookies, 'csrf');

    expect((await api().post('/api/auth/refresh').set('Cookie', [rt, csrf])).body.error.code).toBe('CSRF_FAILED');

    const first = await api().post('/api/auth/refresh').set('Cookie', [rt, csrf]).set('X-CSRF-Token', u.csrf);
    expect(first.status).toBe(200);
    const rt2 = cookieVal(first.headers['set-cookie'] as unknown as string[], 'rt');
    const csrf2 = cookieVal(first.headers['set-cookie'] as unknown as string[], 'csrf');
    expect(rt2).not.toBe(rt);

    // Replaying the old token = theft signal → whole family revoked.
    const replay = await api().post('/api/auth/refresh').set('Cookie', [rt, csrf]).set('X-CSRF-Token', u.csrf);
    expect(replay.status).toBe(401);
    const afterReuse = await api().post('/api/auth/refresh').set('Cookie', [rt2, csrf2]).set('X-CSRF-Token', first.body.csrfToken);
    expect(afterReuse.status).toBe(401);
  });

  it('logout revokes the session', async () => {
    const u = await createUser();
    const rt = cookieVal(u.cookies, 'rt');
    const csrf = cookieVal(u.cookies, 'csrf');
    expect((await api().post('/api/auth/logout').set('Cookie', [rt, csrf]).set('X-CSRF-Token', u.csrf)).status).toBe(204);
    expect((await api().post('/api/auth/refresh').set('Cookie', [rt, csrf]).set('X-CSRF-Token', u.csrf)).status).toBe(401);
    // Money endpoints reject access tokens from revoked sessions.
    expect((await api().post('/api/wallet/deposits').set(bearer(u.token)).set('Idempotency-Key', 'x'.repeat(20)).send({ amount: 10 })).status).toBe(401);
  });
});

describe('password reset & 2FA', () => {
  it('resets the password and signs out all sessions', async () => {
    const u = await createUser();
    await api().post('/api/auth/forgot-password').send({ email: `${u.username}@test.dev` });
    const mail = devMailbox.find((m) => m.to === `${u.username}@test.dev` && m.subject.includes('Reset'))!;
    const token = new URL(mail.text.split(' ').pop()!).searchParams.get('token')!;
    expect((await api().post('/api/auth/reset-password').send({ token, password: 'BrandNewPass1' })).status).toBe(200);
    expect((await api().post('/api/auth/login').send({ identifier: u.username, password: u.password })).status).toBe(401);
    expect((await api().post('/api/auth/login').send({ identifier: u.username, password: 'BrandNewPass1' })).status).toBe(200);
  });

  it('does not reveal whether an email exists', async () => {
    const res = await api().post('/api/auth/forgot-password').send({ email: 'nobody@test.dev' });
    expect(res.status).toBe(200);
  });

  it('enforces TOTP once enabled', async () => {
    const u = await createUser();
    const setup = await api().post('/api/me/2fa/setup').set(bearer(u.token));
    const code = await generate({ secret: setup.body.secret });
    expect((await api().post('/api/me/2fa/enable').set(bearer(u.token)).send({ code })).status).toBe(200);
    expect((await api().post('/api/auth/login').send({ identifier: u.username, password: u.password })).body.error.code).toBe('TWO_FACTOR_REQUIRED');
    expect((await api().post('/api/auth/login').send({ identifier: u.username, password: u.password, totpCode: '000000' })).body.error.code).toBe('INVALID_2FA_CODE');
    const ok = await api().post('/api/auth/login').send({ identifier: u.username, password: u.password, totpCode: await generate({ secret: setup.body.secret }) });
    expect(ok.status).toBe(200);
  });
});
