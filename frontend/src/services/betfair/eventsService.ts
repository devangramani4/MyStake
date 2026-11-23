import type { EventDetail, EventSummary, LiveScore } from '../../types';
import { http } from '../api/http';

export interface EventQuery { sport?: string; competition?: string; status?: 'UPCOMING' | 'IN_PLAY'; featured?: boolean; q?: string; page?: number; pageSize?: number }

export const eventsService = {
  list: (params: EventQuery, signal?: AbortSignal) => http.get<{ items: EventSummary[]; total: number; page: number; pageSize: number }>('/events', { params, signal }).then((r) => r.data),
  get: (eventId: string) => http.get<EventDetail>(`/events/${encodeURIComponent(eventId)}`).then((r) => r.data),
  scores: (eventIds: string[]) => http.get<{ items: LiveScore[] }>('/scores', { params: { eventIds: eventIds.join(',') } }).then((r) => r.data.items),
};
