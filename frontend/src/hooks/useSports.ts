import { useEffect, useState } from 'react';
import { sportsService } from '../services/betfair/sportsService';
import type { Sport } from '../types';

/** Sports navigation, cached for the session and refreshed every minute (counts change). */
let cache: { at: number; data: Sport[] } | null = null;
let inflight: Promise<Sport[]> | null = null;
const subscribers = new Set<(s: Sport[]) => void>();

function load(force = false) {
  if (!force && cache && Date.now() - cache.at < 60_000) return Promise.resolve(cache.data);
  inflight ??= sportsService
    .list()
    .then((data) => {
      cache = { at: Date.now(), data };
      subscribers.forEach((s) => s(data));
      return data;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export function useSports() {
  const [sports, setSports] = useState<Sport[]>(cache?.data ?? []);
  const [error, setError] = useState(false);
  useEffect(() => {
    subscribers.add(setSports);
    load().then(setSports).catch(() => setError(true));
    const id = setInterval(() => void load(true).catch(() => undefined), 60_000);
    return () => {
      subscribers.delete(setSports);
      clearInterval(id);
    };
  }, []);
  return { sports, error, loading: !cache && !error };
}
