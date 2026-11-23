import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { execute, isDuplicateKey, query, queryOne, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import type { UserRow } from '../models/types.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { audit } from './auditService.js';
import { assertAccountActive, assertMinimumAge, checkCountry } from './complianceService.js';
import { sendMail } from './emailService.js';
import { createSession, revokeByToken, rotateSession, signAccess, type ClientInfo } from './tokenService.js';
import { newTotpSecret, verifyTotp } from './totpService.js';
import { createWallet } from './walletService.js';

const ARGON = { type: argon2.argon2id as 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (pw: string) => argon2.hash(pw, ARGON);
export const verifyPassword = (hash: string, pw: string) => argon2.verify(hash, pw).catch(() => false);

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  currency: string;
  status: string;
  emailVerified: boolean;
  kycStatus: string;
  twoFactorEnabled: boolean;
  termsAccepted: boolean;
  createdAt: Date;
}

export const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.uuid,
  email: u.email,
  username: u.username,
  firstName: u.first_name,
  lastName: u.last_name,
  currency: u.currency,
  status: u.status,
  emailVerified: !!u.email_verified_at,
  kycStatus: u.kyc_status,
  twoFactorEnabled: !!u.totp_enabled,
  termsAccepted: u.terms_version === env.TERMS_VERSION,
  createdAt: u.created_at,
});

export const getUserById = (id: number) => queryOne<UserRow>('SELECT * FROM users WHERE id = ?', [id]);

export interface RegisterInput {
  email: string;
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth: string;
  countryCode?: string;
  acceptTerms: boolean;
}

export async function register(input: RegisterInput, client: ClientInfo & { country?: string }) {
  checkCountry(input.countryCode ?? client.country);
  const dob = new Date(`${input.dateOfBirth}T00:00:00Z`);
  assertMinimumAge(dob);
  if (!input.acceptTerms) throw new AppError('TERMS_NOT_ACCEPTED', 'You must accept the terms and conditions.');

  const passwordHash = await hashPassword(input.password);
  try {
    const userId = await withTransaction(async (conn) => {
      const res = await execute(
        `INSERT INTO users (uuid, email, username, password_hash, first_name, last_name, date_of_birth, country_code, currency, age_verified, terms_version, terms_accepted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(3))`,
        [randomUUID(), input.email.toLowerCase(), input.username, passwordHash, input.firstName ?? null, input.lastName ?? null, dob,
          (input.countryCode ?? client.country ?? null)?.toUpperCase() ?? null, env.DEFAULT_CURRENCY, 0, env.TERMS_VERSION],
        conn,
      );
      await createWallet(res.insertId, env.DEFAULT_CURRENCY, conn);
      await execute('INSERT INTO user_limits (user_id) VALUES (?)', [res.insertId], conn);
      await audit({ actorType: 'USER', actorId: res.insertId, action: 'USER_REGISTERED', targetType: 'user', targetId: res.insertId, ip: client.ip }, conn);
      return res.insertId;
    });
    await sendVerificationEmail(userId);
    return issueTokens((await getUserById(userId))!, client);
  } catch (err) {
    if (isDuplicateKey(err)) throw new AppError('CONFLICT', 'An account with that email or username already exists.');
    throw err;
  }
}

async function issueTokens(user: UserRow, client: ClientInfo) {
  const session = await createSession('user', user.id, client);
  return { user: toPublicUser(user), accessToken: signAccess(user.id, 'USER', session.sessionId, 'user'), refreshToken: session.token, refreshExpiresAt: session.expiresAt };
}

export async function login(identifier: string, password: string, totpCode: string | undefined, client: ClientInfo & { country?: string }) {
  checkCountry(client.country);
  const user = await queryOne<UserRow>('SELECT * FROM users WHERE email = ? OR username = ?', [identifier.toLowerCase(), identifier]);
  // Constant-ish work when the user doesn't exist to reduce enumeration via timing.
  if (!user) {
    await hashPassword(password);
    throw new AppError('INVALID_CREDENTIALS', 'Invalid email/username or password.');
  }
  if (user.locked_until && user.locked_until > new Date()) throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.');
  if (!(await verifyPassword(user.password_hash, password))) {
    const failed = user.failed_logins + 1;
    await execute('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', [failed >= MAX_FAILED ? 0 : failed, failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null, user.id]);
    logger.warn({ auth: { userId: user.id, ip: client.ip } }, 'login failed');
    throw new AppError('INVALID_CREDENTIALS', 'Invalid email/username or password.');
  }
  assertAccountActive(user);
  if (user.totp_enabled) {
    if (!totpCode) throw new AppError('TWO_FACTOR_REQUIRED', 'Enter your authentication code.');
    if (!(await verifyTotp(user.totp_secret_enc!, totpCode))) throw new AppError('INVALID_2FA_CODE', 'Invalid authentication code.');
  }
  await execute('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW(3) WHERE id = ?', [user.id]);
  logger.info({ auth: { userId: user.id, ip: client.ip } }, 'login success');
  return issueTokens(user, client);
}

export async function refresh(presented: string, client: ClientInfo) {
  const r = await rotateSession('user', presented, client);
  const user = await getUserById(r.ownerId);
  if (!user) throw new AppError('UNAUTHORIZED', 'Invalid session');
  assertAccountActive(user);
  return { user: toPublicUser(user), accessToken: signAccess(user.id, 'USER', r.sessionId, 'user'), refreshToken: r.token, refreshExpiresAt: r.expiresAt };
}

export const logout = (presented: string) => revokeByToken('user', presented);

// ───────── Email verification & password reset ─────────
async function createAuthToken(userId: number, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET', ttlMs: number) {
  const token = randomToken(32);
  await execute('UPDATE auth_tokens SET used_at = NOW(3) WHERE user_id = ? AND purpose = ? AND used_at IS NULL', [userId, purpose]);
  await execute('INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES (?,?,?,?)', [userId, purpose, sha256(token), new Date(Date.now() + ttlMs)]);
  return token;
}

async function consumeAuthToken(token: string, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET') {
  return withTransaction(async (conn) => {
    const row = await queryOne<{ id: number; user_id: number; expires_at: Date; used_at: Date | null }>(
      'SELECT id, user_id, expires_at, used_at FROM auth_tokens WHERE token_hash = ? AND purpose = ? FOR UPDATE',
      [sha256(token), purpose],
      conn,
    );
    if (!row || row.used_at || row.expires_at < new Date()) throw new AppError('BAD_REQUEST', 'This link is invalid or has expired.');
    await execute('UPDATE auth_tokens SET used_at = NOW(3) WHERE id = ?', [row.id], conn);
    return row.user_id;
  });
}

export async function sendVerificationEmail(userId: number) {
  const user = await getUserById(userId);
  if (!user || user.email_verified_at) return;
  const token = await createAuthToken(userId, 'EMAIL_VERIFY', 48 * 3600_000);
  await sendMail({
    to: user.email,
    subject: `Verify your ${env.APP_NAME} account`,
    text: `Verify your email: ${env.PUBLIC_WEB_URL}/verify-email?token=${token}`,
  });
}

export async function verifyEmail(token: string) {
  const userId = await consumeAuthToken(token, 'EMAIL_VERIFY');
  await execute('UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW(3)) WHERE id = ?', [userId]);
  await audit({ actorType: 'USER', actorId: userId, action: 'EMAIL_VERIFIED', targetType: 'user', targetId: userId });
}

/** Always succeeds from the caller's perspective to avoid account enumeration. */
export async function forgotPassword(email: string) {
  const user = await queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
  if (!user) return;
  const token = await createAuthToken(user.id, 'PASSWORD_RESET', 3600_000);
  await sendMail({ to: user.email, subject: `Reset your ${env.APP_NAME} password`, text: `Reset your password (valid 1 hour): ${env.PUBLIC_WEB_URL}/reset-password?token=${token}` });
}

export async function resetPassword(token: string, newPassword: string) {
  const userId = await consumeAuthToken(token, 'PASSWORD_RESET');
  await execute('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', [await hashPassword(newPassword), userId]);
  await execute(`UPDATE user_sessions SET revoked_at = NOW(3), revoked_reason = 'PASSWORD_RESET' WHERE user_id = ? AND revoked_at IS NULL`, [userId]);
  await audit({ actorType: 'USER', actorId: userId, action: 'PASSWORD_RESET', targetType: 'user', targetId: userId });
}

export async function changePassword(userId: number, currentSessionId: number, current: string, next: string) {
  const user = await getUserById(userId);
  if (!user || !(await verifyPassword(user.password_hash, current))) throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect.');
  await execute('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(next), userId]);
  // Sign out every other device.
  const cur = await queryOne<{ family_id: string }>('SELECT family_id FROM user_sessions WHERE id = ?', [currentSessionId]);
  await execute(`UPDATE user_sessions SET revoked_at = NOW(3), revoked_reason = 'PASSWORD_CHANGED' WHERE user_id = ? AND revoked_at IS NULL AND family_id <> ?`, [userId, cur?.family_id ?? '']);
  await audit({ actorType: 'USER', actorId: userId, action: 'PASSWORD_CHANGED', targetType: 'user', targetId: userId });
}

export async function acceptTerms(userId: number) {
  await execute('UPDATE users SET terms_version = ?, terms_accepted_at = NOW(3) WHERE id = ?', [env.TERMS_VERSION, userId]);
  await audit({ actorType: 'USER', actorId: userId, action: 'TERMS_ACCEPTED', targetType: 'user', targetId: userId, after: { version: env.TERMS_VERSION } });
}

// ───────── Sessions / devices ─────────
export async function listSessions(userId: number, currentSessionId: number) {
  const cur = await queryOne<{ family_id: string }>('SELECT family_id FROM user_sessions WHERE id = ?', [currentSessionId]);
  const rows = await query<{ family_id: string; user_agent: string | null; ip_address: string | null; created_at: Date; last_used_at: Date; first_seen: Date }>(
    `SELECT s.family_id, s.user_agent, s.ip_address, s.created_at, s.last_used_at,
            (SELECT MIN(created_at) FROM user_sessions f WHERE f.family_id = s.family_id) AS first_seen
       FROM user_sessions s WHERE s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > NOW(3) ORDER BY s.last_used_at DESC`,
    [userId],
  );
  return rows.map((r) => ({ id: r.family_id, userAgent: r.user_agent, ip: r.ip_address, signedInAt: r.first_seen, lastActiveAt: r.created_at, current: r.family_id === cur?.family_id }));
}

export async function revokeSession(userId: number, familyId: string) {
  await execute(`UPDATE user_sessions SET revoked_at = NOW(3), revoked_reason = 'USER_REVOKED' WHERE user_id = ? AND family_id = ? AND revoked_at IS NULL`, [userId, familyId]);
}

// ───────── 2FA ─────────
export async function begin2fa(userId: number) {
  const user = (await getUserById(userId))!;
  if (user.totp_enabled) throw new AppError('CONFLICT', 'Two-factor authentication is already enabled.');
  const s = newTotpSecret(user.email);
  await execute('UPDATE users SET totp_secret_enc = ? WHERE id = ?', [s.encrypted, userId]);
  return { otpauthUrl: s.otpauthUrl, secret: s.secret };
}

export async function enable2fa(userId: number, code: string) {
  const user = (await getUserById(userId))!;
  if (!user.totp_secret_enc || !(await verifyTotp(user.totp_secret_enc, code))) throw new AppError('INVALID_2FA_CODE', 'Invalid authentication code.');
  await execute('UPDATE users SET totp_enabled = 1 WHERE id = ?', [userId]);
  await audit({ actorType: 'USER', actorId: userId, action: '2FA_ENABLED', targetType: 'user', targetId: userId });
}

export async function disable2fa(userId: number, password: string, code: string) {
  const user = (await getUserById(userId))!;
  if (!(await verifyPassword(user.password_hash, password))) throw new AppError('INVALID_CREDENTIALS', 'Password is incorrect.');
  if (!user.totp_secret_enc || !(await verifyTotp(user.totp_secret_enc, code))) throw new AppError('INVALID_2FA_CODE', 'Invalid authentication code.');
  await execute('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL WHERE id = ?', [userId]);
  await audit({ actorType: 'USER', actorId: userId, action: '2FA_DISABLED', targetType: 'user', targetId: userId });
}
