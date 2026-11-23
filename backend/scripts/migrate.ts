/** Applies database/migrations/*.sql in order, recording each in schema_migrations. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../src/config/env.js';

// Works from source (backend/scripts) and compiled output (backend/dist/scripts); DATABASE_DIR overrides.
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(process.env.DATABASE_DIR ?? [join(here, '../../database'), join(here, '../../../database')].find((d) => existsSync(d)) ?? '', 'migrations');

export async function migrate(database = env.DATABASE_NAME, log = console.log) {
  const conn = await mysql.createConnection({ host: env.DATABASE_HOST, port: env.DATABASE_PORT, user: env.DATABASE_USER, password: env.DATABASE_PASSWORD, database, multipleStatements: true });
  try {
    await conn.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))');
    const [rows] = await conn.query('SELECT version FROM schema_migrations');
    const applied = new Set((rows as Array<{ version: string }>).map((r) => r.version));
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (applied.has(file)) continue;
      log(`applying ${file}`);
      await conn.query(readFileSync(join(dir, file), 'utf8'));
      await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
    }
    log('migrations up to date');
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
