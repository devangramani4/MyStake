import type { MarketBook } from '../../types';
import { http } from '../api/http';

export const marketsService = {
  book: (marketId: string) => http.get<MarketBook>(`/markets/${marketId}/book`).then((r) => r.data),
  books: (marketIds: string[]) => (marketIds.length ? http.get<{ items: MarketBook[] }>('/markets/books', { params: { ids: marketIds.join(',') } }).then((r) => r.data.items) : Promise.resolve([])),
};
