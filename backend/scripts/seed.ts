/**
 * Seeds reference data and the first SUPER_ADMIN.
 *   ADMIN_EMAIL / ADMIN_PASSWORD  → bootstrap admin (required on first run)
 *   SEED_DEV_DATA=true            → also loads 9xx_dev_*.sql (sample promotions, demo user)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env, isProd } from '../src/config/env.js';

// Works from source (backend/scripts) and compiled output (backend/dist/scripts); DATABASE_DIR overrides.
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(process.env.DATABASE_DIR ?? [join(here, '../../database'), join(here, '../../../database')].find((d) => existsSync(d)) ?? '', 'seeds');

async function main() {
  const dev = process.env.SEED_DEV_DATA === 'true';
  if (dev && isProd) throw new Error('SEED_DEV_DATA is not allowed in production');
  const conn = await mysql.createConnection({ host: env.DATABASE_HOST, port: env.DATABASE_PORT, user: env.DATABASE_USER, password: env.DATABASE_PASSWORD, database: env.DATABASE_NAME, multipleStatements: true });
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (file.startsWith('9') && !dev) continue;
    console.log(`seeding ${file}`);
    await conn.query(readFileSync(join(dir, file), 'utf8'));
  }
  await conn.end();

  const { ensureSuperAdmin } = await import('../src/services/adminService.js');
  const { pool } = await import('../src/config/db.js');
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    await ensureSuperAdmin(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    console.log(`super admin ready: ${process.env.ADMIN_EMAIL}`);
  } else {
    console.log('ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping admin bootstrap');
  }
  if (dev) {
    const { hashPassword } = await import('../src/services/authService.js');
    const { randomUUID } = await import('node:crypto');
    const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', ['demo']);
    if (!(rows as unknown[]).length) {
      const [res] = await pool.query(
        `INSERT INTO users (uuid, email, username, password_hash, first_name, date_of_birth, country_code, currency, email_verified_at, kyc_status, age_verified, terms_version, terms_accepted_at)
         VALUES (?, 'demo@example.com', 'demo', ?, 'Demo', '1990-01-01', 'GB', ?, NOW(3), 'VERIFIED', 1, ?, NOW(3))`,
        [randomUUID(), await hashPassword('DemoPass123'), env.DEFAULT_CURRENCY, env.TERMS_VERSION],
      );
      const id = (res as { insertId: number }).insertId;
      await pool.query('INSERT INTO user_wallets (user_id, currency, balance) VALUES (?,?,?)', [id, env.DEFAULT_CURRENCY, '0.00']);
      await pool.query('INSERT INTO user_limits (user_id) VALUES (?)', [id]);
      console.log('demo user: demo / DemoPass123 (deposit funds via the Wallet page in mock payment mode)');
    }
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
