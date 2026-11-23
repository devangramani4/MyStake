import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { PoolConnection } from 'mysql2/promise';
import { execute, queryOne, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import type { Role } from '../models/types.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { randomToken, sha256 } from '../utils/crypto.js';

export type Audience = 'user' | 'admin';

export interface AccessClaims {
  sub: string; // numeric id as string
  role: Role;
  sid: number; // session id
  aud: Audience;
}

const secretFor = (aud: Audience) => (aud === 'admin' ? env.JWT_ADMIN_ACCESS_SECRET : env.JWT_ACCESS_SECRET);

export function signAccess(id: number, role: Role, sid: number, aud: Audience): string {
  return jwt.sign({ role, sid }, secretFor(aud), {
    subject: String(id),
    audience: aud,
    issuer: env.APP_NAME,
    expiresIn: aud === 'admin' ? Math.min(env.JWT_ACCESS_TTL_SEC, 600) : env.JWT_ACCESS_TTL_SEC,
    algorithm: 'HS256',
  });
}

export function verifyAccess(token: string, aud: Audience): AccessClaims {
  try {
    const p = jwt.verify(token, secretFor(aud), { audience: aud, issuer: env.APP_NAME, algorithms: ['HS256'] }) as jwt.JwtPayload;
    return { sub: p.sub!, role: p.role, sid: p.sid, aud };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw new AppError('TOKEN_EXPIRED', 'Session expired');
    throw new AppError('UNAUTHORIZED', 'Invalid token');
  }
}

/**
 * Opaque refresh tokens stored as SHA-256 hashes, rotated on every use.
 * Presenting an already-rotated token signals theft → the whole token family is revoked.
 */
const TABLES = {
  user: { table: 'user_sessions', owner: 'user_id', ttlMs: () => env.REFRESH_TOKEN_TTL_DAYS * 86_400_000 },
  admin: { table: 'admin_sessions', owner: 'admin_id', ttlMs: () => env.ADMIN_REFRESH_TOKEN_TTL_HOURS * 3_600_000 },
} as const;

interface SessionRow {
  id: number;
  owner_id: number;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

export interface ClientInfo { ip?: string; userAgent?: string }

export async function createSession(aud: Audience, ownerId: number, client: ClientInfo, conn?: PoolConnection, familyId: string = randomUUID()) {
  const t = TABLES[aud];
  const token = randomToken();
  const res = await execute(
    `INSERT INTO ${t.table} (${t.owner}, family_id, refresh_token_hash, user_agent, ip_address, expires_at) VALUES (?,?,?,?,?,?)`,
    [ownerId, familyId, sha256(token), client.userAgent?.slice(0, 255) ?? null, client.ip ?? null, new Date(Date.now() + t.ttlMs())],
    conn,
  );
  return { token, sessionId: res.insertId, expiresAt: new Date(Date.now() + t.ttlMs()) };
}

export async function rotateSession(aud: Audience, presented: string, client: ClientInfo) {
  const t = TABLES[aud];
  const result = await withTransaction(async (conn) => {
    const s = await queryOne<SessionRow>(
      `SELECT id, ${t.owner} AS owner_id, family_id, expires_at, revoked_at, revoked_reason FROM ${t.table} WHERE refresh_token_hash = ? FOR UPDATE`,
      [sha256(presented)],
      conn,
    );
    if (!s) return { error: 'INVALID' as const };
    if (s.revoked_at) return { error: s.revoked_reason === 'ROTATED' ? ('REUSED' as const) : ('REVOKED' as const), session: s };
    if (s.expires_at < new Date()) return { error: 'EXPIRED' as const };
    const next = await createSession(aud, s.owner_id, client, conn, s.family_id);
    await execute(`UPDATE ${t.table} SET revoked_at = NOW(3), revoked_reason = 'ROTATED', replaced_by_id = ?, last_used_at = NOW(3) WHERE id = ?`, [next.sessionId, s.id], conn);
    return { error: null, ownerId: s.owner_id, ...next };
  });
  if (result.error === 'REUSED') {
    // Committed outside the lookup transaction so the revocation is not rolled back with the error.
    await execute(`UPDATE ${t.table} SET revoked_at = NOW(3), revoked_reason = 'REUSE_DETECTED' WHERE family_id = ? AND revoked_at IS NULL`, [result.session.family_id]);
    logger.warn({ security: { aud, ownerId: result.session.owner_id, familyId: result.session.family_id } }, 'refresh token reuse detected; family revoked');
  }
  if (result.error !== null) throw new AppError('UNAUTHORIZED', result.error === 'EXPIRED' ? 'Session expired' : 'Session no longer valid');
  return { ownerId: result.ownerId, token: result.token, sessionId: result.sessionId, expiresAt: result.expiresAt };
}

export async function revokeByToken(aud: Audience, presented: string, reason = 'LOGOUT') {
  const t = TABLES[aud];
  const s = await queryOne<{ family_id: string }>(`SELECT family_id FROM ${t.table} WHERE refresh_token_hash = ?`, [sha256(presented)]);
  if (s) await execute(`UPDATE ${t.table} SET revoked_at = NOW(3), revoked_reason = ? WHERE family_id = ? AND revoked_at IS NULL`, [reason, s.family_id]);
}

/** Is the session behind an access token still live? (Checked on sensitive operations.) */
export async function isSessionActive(aud: Audience, sessionId: number): Promise<boolean> {
  const t = TABLES[aud];
  // The access token carries the session id at issue time; after rotation the family lives on.
  const s = await queryOne<{ family_id: string }>(`SELECT family_id FROM ${t.table} WHERE id = ?`, [sessionId]);
  if (!s) return false;
  const live = await queryOne(`SELECT id FROM ${t.table} WHERE family_id = ? AND revoked_at IS NULL AND expires_at > NOW(3) LIMIT 1`, [s.family_id]);
  return !!live;
}
