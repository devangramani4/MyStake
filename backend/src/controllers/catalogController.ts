import type { Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { getBetfair } from '../integrations/betfair/index.js';
import { parse } from '../middleware/validate.js';
import * as markets from '../services/marketService.js';
import { odds } from '../services/oddsService.js';
import { AppError } from '../utils/errors.js';

const eventsQuery = z.object({
  sport: z.string().max(50).optional(),
  competition: z.string().max(30).optional(),
  status: z.enum(['UPCOMING', 'IN_PLAY']).optional(),
  featured: z.coerce.boolean().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export async function sports(_req: Request, res: Response) {
  res.set('Cache-Control', 'public, max-age=30');
  res.json({ items: await markets.listSports() });
}

export async function competitions(req: Request, res: Response) {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ items: await markets.listCompetitions(String(req.params.sport)) });
}

export async function events(req: Request, res: Response) {
  const q = parse(eventsQuery, req.query);
  const r = await markets.listEvents({ ...q, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
  res.json({ items: r.items, total: r.total, page: q.page, pageSize: q.pageSize });
}

export async function event(req: Request, res: Response) {
  const ev = await markets.getEvent(String(req.params.eventId));
  const books = await odds.getMany(ev.markets.map((m) => m.marketId));
  const { scores } = await getBetfair();
  res.json({ ...ev, books, score: scores.get(ev.eventId) });
}

const idsSchema = z.object({ ids: z.string().regex(/^[\d.,]+$/).max(2000) });

/** Initial books for a set of markets; subsequent updates arrive via WebSocket. */
export async function books(req: Request, res: Response) {
  const { ids } = parse(idsSchema, req.query);
  const list = ids.split(',').filter(Boolean).slice(0, 100);
  res.json({ items: await odds.getMany(list) });
}

export async function book(req: Request, res: Response) {
  const snap = await odds.get(String(req.params.marketId));
  if (!snap) throw new AppError('NOT_FOUND', 'Market not found');
  res.json(snap);
}

export async function scores(req: Request, res: Response) {
  const { scores } = await getBetfair();
  const ids = typeof req.query.eventIds === 'string' ? req.query.eventIds.split(',').slice(0, 100) : null;
  res.json({ items: ids ? ids.map((id) => scores.get(id)).filter(Boolean) : scores.all() });
}

export async function promotions(_req: Request, res: Response) {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    items: await query(
      `SELECT slug, title, summary, body, badge, terms, starts_at AS startsAt, ends_at AS endsAt FROM promotions
        WHERE is_active = 1 AND starts_at <= NOW(3) AND (ends_at IS NULL OR ends_at > NOW(3)) ORDER BY id`,
    ),
  });
}

export async function stats(_req: Request, res: Response) {
  const [r] = await query<{ live: number; upcoming: number; markets: number; matched: string | null }>(
    `SELECT (SELECT COUNT(*) FROM events WHERE status='IN_PLAY' AND is_enabled=1) AS live,
            (SELECT COUNT(*) FROM events WHERE status='UPCOMING' AND is_enabled=1) AS upcoming,
            (SELECT COUNT(*) FROM markets WHERE status <> 'CLOSED' AND is_enabled=1) AS markets,
            (SELECT SUM(total_matched) FROM markets WHERE status <> 'CLOSED') AS matched`,
  );
  res.set('Cache-Control', 'public, max-age=15');
  res.json({ liveEvents: Number(r.live), upcomingEvents: Number(r.upcoming), openMarkets: Number(r.markets), totalMatched: r.matched ?? '0' });
}
