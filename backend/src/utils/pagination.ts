import { z } from 'zod';

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PageQuery = z.infer<typeof pageQuery>;

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const toPage = <T>(items: T[], total: number, q: PageQuery): Page<T> => ({
  items,
  page: q.page,
  pageSize: q.pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
});

export const offset = (q: PageQuery) => (q.page - 1) * q.pageSize;

/** Date-range presets used by bet history and ledger filters. */
export const rangeQuery = z.object({
  range: z.enum(['today', 'yesterday', '7d', '30d', 'custom', 'all']).default('30d'),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export function resolveRange(r: z.infer<typeof rangeQuery>): { from: Date | null; to: Date | null } {
  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = 86_400_000;
  switch (r.range) {
    case 'today': return { from: startOfToday, to: null };
    case 'yesterday': return { from: new Date(+startOfToday - day), to: startOfToday };
    case '7d': return { from: new Date(+now - 7 * day), to: null };
    case '30d': return { from: new Date(+now - 30 * day), to: null };
    case 'custom': return { from: r.from ? new Date(r.from) : null, to: r.to ? new Date(r.to) : null };
    default: return { from: null, to: null };
  }
}
