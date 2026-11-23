import type { BetfairRpc } from './http.js';
import type { CompetitionResult, EventResult, EventTypeResult, MarketFilter } from './types.js';

export const navigation = (rpc: BetfairRpc) => ({
  listEventTypes: (filter: MarketFilter = {}) => rpc.betting<EventTypeResult[]>('listEventTypes', { filter, locale: 'en' }),
  listCompetitions: (filter: MarketFilter) => rpc.betting<CompetitionResult[]>('listCompetitions', { filter, locale: 'en' }),
  listEvents: (filter: MarketFilter) => rpc.betting<EventResult[]>('listEvents', { filter, locale: 'en' }),
});
