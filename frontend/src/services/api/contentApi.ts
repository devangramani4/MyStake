import type { Promotion } from '../../types';
import { http } from './http';

export const contentApi = {
  promotions: () => http.get<{ items: Promotion[] }>('/promotions').then((r) => r.data.items),
  config: () => http.get<{ executionMode: 'house' | 'exchange'; minStake: number; currency: string }>('/config').then((r) => r.data),
  stats: () => http.get<{ liveEvents: number; upcomingEvents: number; openMarkets: number; totalMatched: string }>('/stats').then((r) => r.data),
};
