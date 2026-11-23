import { execute, query, queryOne } from '../config/db.js';
import { env } from '../config/env.js';
import { getBetfair } from '../integrations/betfair/index.js';
import type { MarketCatalogue } from '../integrations/betfair/types.js';
import { notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Catalogue: Betfair navigation data mirrored into MySQL so the platform can
 * enable/disable/feature items, join bets to markets, and serve fast,
 * filterable listings without hitting Betfair on every page view.
 */


export async function syncCatalogue() {
  const { client } = await getBetfair();
  const started = Date.now();
  const sports = await query<{ id: number; betfair_id: string }>('SELECT id, betfair_id FROM sports WHERE is_enabled = 1');
  const allowed = new Set(env.BETFAIR_EVENT_TYPE_IDS.split(',').map((s) => s.trim()));
  let marketCount = 0;
  for (const sport of sports.filter((s) => allowed.has(s.betfair_id))) {
    try {
      const catalogue = await client.listMarketCatalogue(
        {
          eventTypeIds: [sport.betfair_id],
          marketStartTime: { from: new Date(Date.now() - 12 * 3600_000).toISOString(), to: new Date(Date.now() + 7 * 86_400_000).toISOString() },
        },
        500,
      );
      for (const m of catalogue) await upsertMarket(sport.id, m);
      await execute(`UPDATE sports SET market_count = ? WHERE id = ?`, [catalogue.length, sport.id]);
      marketCount += catalogue.length;
    } catch (err) {
      logger.error({ sport: sport.betfair_id, err: (err as Error).message }, 'catalogue sync failed for sport');
    }
  }
  logger.info({ job: 'catalogueSync', markets: marketCount, ms: Date.now() - started }, 'catalogue synced');
}

async function upsertMarket(sportId: number, m: MarketCatalogue) {
  if (!m.event) return;
  let competitionId: number | null = null;
  if (m.competition) {
    await execute('INSERT INTO competitions (betfair_id, sport_id, name) VALUES (?,?,?) ON DUPLICATE KEY UPDATE name = VALUES(name)', [m.competition.id, sportId, m.competition.name]);
    competitionId = (await queryOne<{ id: number }>('SELECT id FROM competitions WHERE betfair_id = ?', [m.competition.id]))!.id;
  }
  await execute(
    `INSERT INTO events (betfair_id, sport_id, competition_id, name, country_code, timezone, venue, open_date)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), competition_id = VALUES(competition_id), open_date = VALUES(open_date), venue = VALUES(venue)`,
    [m.event.id, sportId, competitionId, m.event.name, m.event.countryCode ?? null, m.event.timezone ?? null, m.event.venue ?? null, new Date(m.event.openDate)],
  );
  const event = (await queryOne<{ id: number }>('SELECT id FROM events WHERE betfair_id = ?', [m.event.id]))!;
  await execute(
    `INSERT INTO markets (betfair_id, event_id, name, market_type, betting_type, start_time, turn_in_play, total_matched)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), start_time = VALUES(start_time), total_matched = VALUES(total_matched)`,
    [m.marketId, event.id, m.marketName, m.description?.marketType ?? null, m.description?.bettingType ?? 'ODDS', new Date(m.marketStartTime ?? m.event.openDate), m.description?.turnInPlayEnabled ? 1 : 0, m.totalMatched ?? 0],
  );
  const market = (await queryOne<{ id: number }>('SELECT id FROM markets WHERE betfair_id = ?', [m.marketId]))!;
  for (const r of m.runners ?? []) {
    await execute(
      `INSERT INTO market_runners (market_id, selection_id, name, handicap, sort_priority) VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), sort_priority = VALUES(sort_priority)`,
      [market.id, r.selectionId, r.runnerName, r.handicap ?? 0, r.sortPriority],
    );
  }
}

// ───────── Read models ─────────
export interface MarketSummary {
  marketId: string;
  name: string;
  marketType: string | null;
  startTime: Date;
  status: string;
  inPlay: boolean;
  suspendedByAdmin: boolean;
  totalMatched: string;
  runners: Array<{ selectionId: number; name: string; sortPriority: number; status: string }>;
}

export interface EventSummary {
  eventId: string;
  name: string;
  sport: { id: string; name: string; slug: string };
  competition: { id: string; name: string } | null;
  openDate: Date;
  status: string;
  hasStream: boolean;
  isFeatured: boolean;
  marketCount: number;
  mainMarket: MarketSummary | null;
}

export async function listSports() {
  return query(
    `SELECT s.betfair_id AS id, s.name, s.slug, s.icon,
            (SELECT COUNT(*) FROM events e WHERE e.sport_id = s.id AND e.is_enabled = 1 AND e.status IN ('UPCOMING','IN_PLAY')) AS eventCount,
            (SELECT COUNT(*) FROM events e WHERE e.sport_id = s.id AND e.is_enabled = 1 AND e.status = 'IN_PLAY') AS liveCount
       FROM sports s WHERE s.is_enabled = 1 ORDER BY s.display_order`,
  );
}

export async function listCompetitions(sportSlug: string) {
  return query(
    `SELECT c.betfair_id AS id, c.name, COUNT(e.id) AS eventCount
       FROM competitions c JOIN sports s ON s.id = c.sport_id
       JOIN events e ON e.competition_id = c.id AND e.is_enabled = 1 AND e.status IN ('UPCOMING','IN_PLAY')
      WHERE s.slug = ? AND c.is_enabled = 1 GROUP BY c.id ORDER BY c.name`,
    [sportSlug],
  );
}

interface EventFilter {
  sport?: string;
  competition?: string;
  status?: 'UPCOMING' | 'IN_PLAY';
  featured?: boolean;
  q?: string;
  limit: number;
  offset: number;
}

export async function listEvents(f: EventFilter): Promise<{ items: EventSummary[]; total: number }> {
  const where = [`e.is_enabled = 1`, `s.is_enabled = 1`, `e.status IN ('UPCOMING','IN_PLAY')`, `EXISTS (SELECT 1 FROM markets mx WHERE mx.event_id = e.id AND mx.status <> 'CLOSED' AND mx.is_enabled = 1)`];
  const params: unknown[] = [];
  if (f.sport) { where.push('s.slug = ?'); params.push(f.sport); }
  if (f.competition) { where.push('c.betfair_id = ?'); params.push(f.competition); }
  if (f.status) { where.push('e.status = ?'); params.push(f.status); }
  if (f.featured) where.push('e.is_featured = 1');
  if (f.q) { where.push('e.name LIKE ?'); params.push(`%${f.q.replace(/[%_]/g, '\\$&')}%`); }
  const w = where.join(' AND ');
  const from = `FROM events e JOIN sports s ON s.id = e.sport_id LEFT JOIN competitions c ON c.id = e.competition_id WHERE ${w}`;
  const [{ total }] = await query<{ total: number }>(`SELECT COUNT(*) AS total ${from}`, params);
  const rows = await query<{
    id: number; betfair_id: string; name: string; open_date: Date; status: string; has_stream: number; is_featured: number;
    sport_id: string; sport_name: string; sport_slug: string; comp_id: string | null; comp_name: string | null; market_count: number;
  }>(
    `SELECT e.id, e.betfair_id, e.name, e.open_date, e.status, e.has_stream, e.is_featured,
            s.betfair_id AS sport_id, s.name AS sport_name, s.slug AS sport_slug, c.betfair_id AS comp_id, c.name AS comp_name,
            (SELECT COUNT(*) FROM markets m WHERE m.event_id = e.id AND m.status <> 'CLOSED' AND m.is_enabled = 1) AS market_count
       ${from} ORDER BY (e.status = 'IN_PLAY') DESC, e.open_date ASC LIMIT ? OFFSET ?`,
    [...params, f.limit, f.offset],
  );
  const main = await mainMarkets(rows.map((r) => r.id));
  return {
    total: Number(total),
    items: rows.map((r) => ({
      eventId: r.betfair_id,
      name: r.name,
      sport: { id: r.sport_id, name: r.sport_name, slug: r.sport_slug },
      competition: r.comp_id ? { id: r.comp_id, name: r.comp_name! } : null,
      openDate: r.open_date,
      status: r.status,
      hasStream: !!r.has_stream,
      isFeatured: !!r.is_featured,
      marketCount: Number(r.market_count),
      mainMarket: main.get(r.id) ?? null,
    })),
  };
}

/** The headline market per event (Match Odds / Win / Winner, else first by order). */
async function mainMarkets(eventIds: number[]): Promise<Map<number, MarketSummary>> {
  if (!eventIds.length) return new Map();
  const markets = await query<{ id: number; event_id: number; betfair_id: string; name: string; market_type: string | null; start_time: Date; status: string; in_play: number; admin_suspended: number; total_matched: string }>(
    `SELECT m.* FROM markets m WHERE m.event_id IN (?) AND m.status <> 'CLOSED' AND m.is_enabled = 1
      ORDER BY m.event_id, FIELD(m.market_type, 'MATCH_ODDS', 'WIN', 'WINNER') = 0, FIELD(m.market_type, 'MATCH_ODDS','WIN','WINNER'), m.display_order, m.id`,
    [eventIds],
  );
  const firstByEvent = new Map<number, (typeof markets)[number]>();
  for (const m of markets) if (!firstByEvent.has(m.event_id)) firstByEvent.set(m.event_id, m);
  const runners = await runnersFor([...firstByEvent.values()].map((m) => m.id));
  const out = new Map<number, MarketSummary>();
  for (const [eventId, m] of firstByEvent) out.set(eventId, toMarketSummary(m, runners.get(m.id) ?? []));
  return out;
}

async function runnersFor(marketIds: number[]) {
  const map = new Map<number, MarketSummary['runners']>();
  if (!marketIds.length) return map;
  const rows = await query<{ market_id: number; selection_id: number; name: string; sort_priority: number; status: string }>(
    'SELECT market_id, selection_id, name, sort_priority, status FROM market_runners WHERE market_id IN (?) ORDER BY sort_priority',
    [marketIds],
  );
  for (const r of rows) {
    if (!map.has(r.market_id)) map.set(r.market_id, []);
    map.get(r.market_id)!.push({ selectionId: Number(r.selection_id), name: r.name, sortPriority: r.sort_priority, status: r.status });
  }
  return map;
}

const toMarketSummary = (
  m: { betfair_id: string; name: string; market_type: string | null; start_time: Date; status: string; in_play: number; admin_suspended: number; total_matched: string },
  runners: MarketSummary['runners'],
): MarketSummary => ({
  marketId: m.betfair_id,
  name: m.name,
  marketType: m.market_type,
  startTime: m.start_time,
  status: m.admin_suspended ? 'SUSPENDED' : m.status,
  inPlay: !!m.in_play,
  suspendedByAdmin: !!m.admin_suspended,
  totalMatched: m.total_matched,
  runners,
});

export async function getEvent(betfairEventId: string) {
  const e = await queryOne<{ id: number; betfair_id: string; name: string; open_date: Date; status: string; has_stream: number; venue: string | null; sport_id: string; sport_name: string; sport_slug: string; comp_id: string | null; comp_name: string | null }>(
    `SELECT e.*, s.betfair_id AS sport_id, s.name AS sport_name, s.slug AS sport_slug, c.betfair_id AS comp_id, c.name AS comp_name
       FROM events e JOIN sports s ON s.id = e.sport_id LEFT JOIN competitions c ON c.id = e.competition_id
      WHERE e.betfair_id = ? AND e.is_enabled = 1`,
    [betfairEventId],
  );
  if (!e) throw notFound('Event');
  const markets = await query<{ id: number; betfair_id: string; name: string; market_type: string | null; start_time: Date; status: string; in_play: number; admin_suspended: number; total_matched: string }>(
    `SELECT * FROM markets WHERE event_id = ? AND is_enabled = 1 AND status <> 'CLOSED' ORDER BY FIELD(market_type, 'MATCH_ODDS','WIN','WINNER') = 0, display_order, id`,
    [e.id],
  );
  const runners = await runnersFor(markets.map((m) => m.id));
  return {
    eventId: e.betfair_id,
    name: e.name,
    openDate: e.open_date,
    status: e.status,
    venue: e.venue,
    hasStream: !!e.has_stream,
    sport: { id: e.sport_id, name: e.sport_name, slug: e.sport_slug },
    competition: e.comp_id ? { id: e.comp_id, name: e.comp_name } : null,
    markets: markets.map((m) => toMarketSummary(m, runners.get(m.id) ?? [])),
  };
}

export interface MarketRecord {
  id: number;
  betfair_id: string;
  event_id: number;
  name: string;
  status: 'INACTIVE' | 'OPEN' | 'SUSPENDED' | 'CLOSED';
  in_play: number;
  admin_suspended: number;
  is_enabled: number;
  settled_at: Date | null;
  event_name: string;
  event_betfair_id: string;
  sport_name: string;
}

export const getMarketRecord = (betfairMarketId: string) =>
  queryOne<MarketRecord>(
    `SELECT m.*, e.name AS event_name, e.betfair_id AS event_betfair_id, s.name AS sport_name
       FROM markets m JOIN events e ON e.id = m.event_id JOIN sports s ON s.id = e.sport_id WHERE m.betfair_id = ?`,
    [betfairMarketId],
  );

export const getRunnerName = async (marketDbId: number, selectionId: number) =>
  (await queryOne<{ name: string }>('SELECT name FROM market_runners WHERE market_id = ? AND selection_id = ?', [marketDbId, selectionId]))?.name ?? String(selectionId);
