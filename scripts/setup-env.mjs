// Creates backend/.env for local development with freshly generated secrets.
// Usage: npm run setup   (optional: DB_USER, DB_PASSWORD, DB_NAME env vars)
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const target = new URL('../backend/.env', import.meta.url);
if (existsSync(target)) {
  console.log('backend/.env already exists — leaving it unchanged.');
  process.exit(0);
}
const hex = () => randomBytes(32).toString('hex');
const env = `NODE_ENV=development
PORT=4000
DATABASE_HOST=127.0.0.1
DATABASE_PORT=3306
DATABASE_USER=${process.env.DB_USER ?? 'root'}
DATABASE_PASSWORD=${process.env.DB_PASSWORD ?? ''}
DATABASE_NAME=${process.env.DB_NAME ?? 'betx'}
JWT_ACCESS_SECRET=${hex()}
JWT_ADMIN_ACCESS_SECRET=${hex()}
ENCRYPTION_KEY=${hex()}
BETFAIR_MODE=mock
BET_EXECUTION_MODE=house
PAYMENT_PROVIDER=mock
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=AdminPass123
SEED_DEV_DATA=true
LOG_LEVEL=info
`;
writeFileSync(target, env);
console.log('Created backend/.env (mock Betfair data, demo user + admin will be seeded).');
