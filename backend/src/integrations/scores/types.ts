/** Live score data contract. Supplied by a licensed score feed in production. */
export interface CricketScore {
  battingTeam: string;
  runs: number;
  wickets: number;
  overs: number;
  balls: number;
  target: number | null;
  partnership: number;
  maxOvers: number;
}

export interface LiveScore {
  eventId: string;
  sport: string;
  status: 'IN_PLAY' | 'BREAK' | 'FINISHED';
  clock?: string;
  home: { name: string; score: string };
  away: { name: string; score: string };
  cricket?: CricketScore;
  timeline: Array<{ at: number; text: string }>;
  updatedAt: number;
}

export interface ScoreProvider {
  onScore(listener: (s: LiveScore) => void): void;
  get(eventId: string): LiveScore | null;
  all(): LiveScore[];
}

/** Used in live mode until a score feed is configured: no scores, UI hides the panel. */
export class NullScoreProvider implements ScoreProvider {
  onScore() {}
  get() { return null; }
  all() { return []; }
}
