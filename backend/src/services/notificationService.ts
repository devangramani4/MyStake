import { execute, query, type Db, pool } from '../config/db.js';
import { bus } from '../utils/eventBus.js';
import { offset, toPage, type PageQuery } from '../utils/pagination.js';

export async function notify(userId: number, type: string, title: string, body: string, db: Db = pool) {
  const res = await execute('INSERT INTO notifications (user_id, type, title, body) VALUES (?,?,?,?)', [userId, type, title, body], db);
  const n = { id: res.insertId, type, title, body, readAt: null, createdAt: new Date() };
  // Pushed immediately; if `db` is an open transaction the client may see it a moment before commit, which is harmless.
  bus.toUser(userId, { type: 'notification', notification: n });
  return n;
}

export async function listNotifications(userId: number, q: PageQuery) {
  const [{ total }] = await query<{ total: number }>('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?', [userId]);
  const [{ unread }] = await query<{ unread: number }>('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId]);
  const rows = await query('SELECT id, type, title, body, read_at AS readAt, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', [userId, q.pageSize, offset(q)]);
  return { ...toPage(rows, Number(total), q), unread: Number(unread) };
}

export async function markRead(userId: number, ids: number[] | 'all') {
  if (ids === 'all') await execute('UPDATE notifications SET read_at = NOW(3) WHERE user_id = ? AND read_at IS NULL', [userId]);
  else if (ids.length) await execute('UPDATE notifications SET read_at = NOW(3) WHERE user_id = ? AND id IN (?) AND read_at IS NULL', [userId, ids]);
}
