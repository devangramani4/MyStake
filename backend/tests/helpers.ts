import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { execute, pool, query } from '../src/config/db.js';
import { setBetfairForTests } from '../src/integrations/betfair/index.js';
import { MockExchange } from '../src/integrations/betfair/mock/mockExchange.js';
import { NullScoreProvider } from '../src/integrations/scores/types.js';
import { hashPassword } from '../src/services/authService.js';
import { syncCatalogue } from '../src/services/marketService.js';
import { odds } from '../src/services/oddsService.js';
import { migrate } from '../scripts/migrate.js';

export const app = createApp();
export const api = () => request(app);

/** Fresh schema + reference data + a deterministic (non-ticking) mock exchange. */
export async function resetWorld() {
  const tables = await query<{ t: string }>('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()');
  await execute('SET FOREIGN_KEY_CHECKS = 0');
  for (const { t } of tables) await execute(`DROP TABLE IF EXISTS \`${t}\``);
  await execute('SET FOREIGN_KEY_CHECKS = 1');
  await migrate(process.env.DATABASE_NAME, () => undefined);
  const seed = readFileSync(join(import.meta.dirname, '../../database/seeds/001_reference_data.sql'), 'utf8').replace(/--.*$/gm, '');
  for (const stmt of seed.split(/;\s*$/m).map((x) => x.trim()).filter(Boolean)) await pool.query(stmt);
  const ex = new MockExchange({ autoSimulate: false });
  ex.listeners.push((s) => odds.ingest(s));
  setBetfairForTests({ client: ex.client(), stream: ex.stream(), scores: new NullScoreProvider(), mock: ex });
  odds.reset();
  await syncCatalogue();
  return ex;
}

export async function createUser(opts: { balance?: number; kyc?: 'VERIFIED' | 'NOT_STARTED'; verified?: boolean; password?: string } = {}) {
  const username = `u${randomUUID().slice(0, 8)}`;
  const password = opts.password ?? 'Password123';
  const [res] = await pool.query(
    `INSERT INTO users (uuid, email, username, password_hash, date_of_birth, currency, email_verified_at, kyc_status, terms_version, terms_accepted_at)
     VALUES (?,?,?,?, '1990-01-01', 'INR', ?, ?, '1.0', NOW(3))`,
    [randomUUID(), `${username}@test.dev`, username, await hashPassword(password), opts.verified === false ? null : new Date(), opts.kyc ?? 'VERIFIED'],
  );
  const id = (res as { insertId: number }).insertId;
  await execute('INSERT INTO user_wallets (user_id, currency, balance) VALUES (?, ?, ?)', [id, 'INR', (opts.balance ?? 0).toFixed(2)]);
  await execute('INSERT INTO user_limits (user_id) VALUES (?)', [id]);
  const login = await api().post('/api/auth/login').send({ identifier: username, password });
  return { id, username, password, token: login.body.accessToken as string, cookies: login.headers['set-cookie'] as unknown as string[], csrf: login.body.csrfToken as string };
}

export async function createAdmin(role: 'SUPER_ADMIN' | 'ADMIN' | 'RISK_MANAGER' | 'SUPPORT') {
  const email = `${role.toLowerCase()}-${randomUUID().slice(0, 6)}@test.dev`;
  await execute('INSERT INTO admin_users (email, name, password_hash, role) VALUES (?,?,?,?)', [email, role, await hashPassword('AdminPass123'), role]);
  const res = await api().post('/api/admin/auth/login').send({ email, password: 'AdminPass123' });
  return res.body.accessToken as string;
}

export async function wallet(userId: number) {
  const [w] = await query<{ balance: string; exposure: string }>('SELECT balance, exposure FROM user_wallets WHERE user_id = ?', [userId]);
  return { balance: Number(w.balance), exposure: Number(w.exposure) };
}

/** First open 2-runner MATCH_ODDS market from the mock exchange. */
export function pickMarket(ex: MockExchange, opts: { runners?: number } = {}) {
  const m = [...ex.markets.values()].find((x) => x.status === 'OPEN' && x.marketType === 'MATCH_ODDS' && (!opts.runners || x.runners.length === opts.runners))!;
  const book = ex.books.get(m.marketId)!;
  const r = book.runners[0];
  return { market: m, marketId: m.marketId, selectionId: r.selectionId, bestBack: r.back[0].price, bestLay: r.lay[0].price, backSize: r.back[0].size };
}

export const idem = () => randomUUID();
export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
