import type { Promotion } from '../../types';
import { http } from './http';

export const contentApi = {
  promotions: () => http.get<{ items: Promotion[] }>('/promotions').then((r) => r.data.items),
  stats: () => http.get<{ liveEvents: number; upcomingEvents: number; openMarkets: number; totalMatched: string }>('/stats').then((r) => r.data),
};
