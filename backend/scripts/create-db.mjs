// Creates the database named in backend/.env if it doesn't exist.
import 'dotenv/config';
import mysql from 'mysql2/promise';

const name = process.env.DATABASE_NAME ?? 'betx';
const conn = await mysql.createConnection({
  host: process.env.DATABASE_HOST ?? '127.0.0.1',
  port: Number(process.env.DATABASE_PORT ?? 3306),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
});
await conn.query(`CREATE DATABASE IF NOT EXISTS \`${name.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await conn.end();
console.log(`Database "${name}" is ready.`);
