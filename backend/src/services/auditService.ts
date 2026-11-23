import { execute, type Db, pool } from '../config/db.js';
import { logger } from '../utils/logger.js';

export interface AuditEntry {
  actorType: 'ADMIN' | 'USER' | 'SYSTEM';
  actorId?: number | null;
  action: string;
  targetType?: string;
  targetId?: string | number;
  before?: unknown;
  after?: unknown;
  reason?: string;
  ip?: string;
  requestId?: string;
}

/** Append-only audit trail. Pass the transaction connection so the audit row commits atomically with the change. */
export async function audit(e: AuditEntry, db: Db = pool) {
  await execute(
    `INSERT INTO audit_logs (actor_type, actor_id, action, target_type, target_id, before_state, after_state, reason, ip_address, request_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      e.actorType, e.actorId ?? null, e.action, e.targetType ?? null, e.targetId !== undefined ? String(e.targetId) : null,
      e.before !== undefined ? JSON.stringify(e.before) : null, e.after !== undefined ? JSON.stringify(e.after) : null,
      e.reason ?? null, e.ip ?? null, e.requestId ?? null,
    ],
    db,
  );
  logger.info({ audit: { actorType: e.actorType, actorId: e.actorId, action: e.action, targetType: e.targetType, targetId: e.targetId } }, 'audit');
}
