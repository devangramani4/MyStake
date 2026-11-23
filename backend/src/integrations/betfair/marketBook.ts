import type { BetfairRpc } from './http.js';
import type { MarketBook, MarketSnapshot } from './types.js';

/** Request weight limits: EX_BEST_OFFERS ≈ 5 points/market → keep batches ≤ 40 markets. */
const BATCH = 40;

export const marketBook = (rpc: BetfairRpc) => ({
  async listMarketBook(marketIds: string[]): Promise<MarketBook[]> {
    const out: MarketBook[] = [];
    for (let i = 0; i < marketIds.length; i += BATCH) {
      const books = await rpc.betting<MarketBook[]>('listMarketBook', {
        marketIds: marketIds.slice(i, i + BATCH),
        priceProjection: { priceData: ['EX_BEST_OFFERS'], exBestOffersOverrides: { bestPricesDepth: 3 }, virtualise: true },
        orderProjection: 'EXECUTABLE',
      });
      out.push(...books);
    }
    return out;
  },
});

export function bookToSnapshot(b: MarketBook): MarketSnapshot {
  return {
    marketId: b.marketId,
    status: b.status,
    inPlay: b.inplay,
    betDelay: b.betDelay,
    totalMatched: b.totalMatched ?? 0,
    version: b.version,
    updatedAt: Date.now(),
    runners: b.runners.map((r) => ({
      selectionId: r.selectionId,
      status: r.status,
      lastPriceTraded: r.lastPriceTraded ?? null,
      totalMatched: r.totalMatched ?? 0,
      back: (r.ex?.availableToBack ?? []).slice(0, 3),
      lay: (r.ex?.availableToLay ?? []).slice(0, 3),
    })),
  };
}
