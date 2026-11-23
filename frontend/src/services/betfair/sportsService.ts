import type { Competition, Sport } from '../../types';
import { http } from '../api/http';

export const sportsService = {
  list: () => http.get<{ items: Sport[] }>('/sports').then((r) => r.data.items.map((s) => ({ ...s, eventCount: Number(s.eventCount), liveCount: Number(s.liveCount) }))),
  competitions: (sportSlug: string) => http.get<{ items: Competition[] }>(`/sports/${encodeURIComponent(sportSlug)}/competitions`).then((r) => r.data.items),
};
