import type { CatalogueProjection } from './client.js';
import type { BetfairRpc } from './http.js';
import type { MarketCatalogue, MarketFilter } from './types.js';

const DEFAULT_PROJECTION: CatalogueProjection[] = ['EVENT', 'EVENT_TYPE', 'COMPETITION', 'MARKET_START_TIME', 'MARKET_DESCRIPTION', 'RUNNER_DESCRIPTION'];

export const marketCatalogue = (rpc: BetfairRpc) => ({
  /** Betfair caps maxResults at 1000 and weights by projection; callers should batch. */
  listMarketCatalogue: (filter: MarketFilter, maxResults: number, projection: CatalogueProjection[] = DEFAULT_PROJECTION) =>
    rpc.betting<MarketCatalogue[]>('listMarketCatalogue', {
      filter,
      maxResults: Math.min(maxResults, 1000),
      marketProjection: projection,
      sort: 'FIRST_TO_START',
      locale: 'en',
    }),
});
