import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export type Db = Pool | PoolConnection;

export const pool: Pool = mysql.createPool({
  host: env.DATABASE_HOST,
  port: env.DATABASE_PORT,
  user: env.DATABASE_USER,
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME,
  connectionLimit: env.DATABASE_POOL_SIZE,
  waitForConnections: true,
  // DECIMAL values come back as strings and are converted to integer minor
  // units via utils/money.ts — never via parseFloat arithmetic.
  decimalNumbers: false,
  supportBigNumbers: true,
  bigNumberStrings: false,
  dateStrings: false,
  timezone: 'Z',
  namedPlaceholders: false,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
});

pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

/** Parameterised SELECT. Always use placeholders — never string-concatenate input. */
export async function query<T = RowDataPacket>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const [rows] = await db.query<RowDataPacket[]>(sql, params);
  return rows as T[];
}

export async function queryOne<T = RowDataPacket>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: unknown[] = [], db: Db = pool): Promise<ResultSetHeader> {
  const [res] = await db.query<ResultSetHeader>(sql, params);
  return res;
}

/**
 * Run `fn` inside a transaction. Retries on deadlock / lock-wait timeout,
 * which InnoDB can raise under concurrent wallet updates.
 */
export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => undefined);
      const code = (err as { code?: string }).code;
      if ((code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT') && attempt < retries) {
        logger.warn({ code, attempt }, 'transaction retry');
        await new Promise((r) => setTimeout(r, 25 * attempt));
        continue;
      }
      throw err;
    } finally {
      conn.release();
    }
  }
}

export function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: string }).code === 'ER_DUP_ENTRY';
}
