/**
 * DEVELOPMENT / TEST ONLY — synthetic live scores for in-play mock events.
 * Betfair's betting API does not provide scores; production uses a
 * ScoreProvider for a licensed data feed (see integrations/scores).
 */
import type { LiveScore, ScoreProvider } from '../../scores/types.js';
import type { MockExchange } from './mockExchange.js';
import { rand } from './mockData.js';

export class MockScoreProvider implements ScoreProvider {
  private scores = new Map<string, LiveScore>();
  private listeners: Array<(s: LiveScore) => void> = [];

  constructor(private readonly ex: MockExchange) {
    setInterval(() => this.tick(), 3000).unref();
  }

  onScore(l: (s: LiveScore) => void) { this.listeners.push(l); }
  get(eventId: string) { return this.scores.get(eventId) ?? null; }
  all() { return [...this.scores.values()]; }

  private tick() {
    const now = Date.now();
    for (const ev of this.ex.events.values()) {
      if (now < ev.openDate) continue;
      const finished = now > ev.openDate + ev.durationMs;
      let s = this.scores.get(ev.eventId);
      if (!s) {
        s = { eventId: ev.eventId, sport: ev.sportId, status: 'IN_PLAY', home: { name: ev.home, score: '0' }, away: { name: ev.away, score: '0' }, timeline: [], updatedAt: now };
        if (ev.sportId === '4') s.cricket = { battingTeam: ev.home, runs: 0, wickets: 0, overs: 0, balls: 0, target: null, partnership: 0, maxOvers: 20 };
        this.scores.set(ev.eventId, s);
      }
      if (finished) {
        if (s.status !== 'FINISHED') { s.status = 'FINISHED'; this.emit(s); }
        continue;
      }
      const elapsedMin = Math.floor((now - ev.openDate) / 60_000);
      s.clock = `${elapsedMin}'`;
      if (s.cricket) this.cricketBall(s);
      else if (ev.sportId === '1' && rand() < 0.03) this.goal(s, rand() < 0.5 ? 'home' : 'away', elapsedMin);
      else if (['7522'].includes(ev.sportId)) this.points(s, Math.floor(rand() * 4));
      else if (['7524', '7511', '5', '998917', '27454571', '2'].includes(ev.sportId) && rand() < 0.08) this.points(s, 1);
      s.updatedAt = now;
      this.emit(s);
    }
  }

  private cricketBall(s: LiveScore) {
    const c = s.cricket!;
    const r = rand();
    if (r < 0.04 && c.wickets < 10) {
      c.wickets++;
      c.partnership = 0;
      s.timeline.unshift({ at: Date.now(), text: `WICKET! ${c.battingTeam} ${c.runs}/${c.wickets}` });
    } else {
      const runs = r < 0.35 ? 0 : r < 0.7 ? 1 : r < 0.82 ? 2 : r < 0.93 ? 4 : 6;
      c.runs += runs;
      c.partnership += runs;
      if (runs >= 4) s.timeline.unshift({ at: Date.now(), text: `${runs === 6 ? 'SIX' : 'FOUR'} — ${c.battingTeam} ${c.runs}/${c.wickets}` });
    }
    c.balls++;
    if (c.balls === 6) { c.balls = 0; c.overs++; }
    if ((c.overs >= c.maxOvers || c.wickets >= 10) && c.target === null) {
      c.target = c.runs + 1;
      s.home.score = `${c.runs}/${c.wickets}`;
      s.timeline.unshift({ at: Date.now(), text: `Innings break — target ${c.target}` });
      c.battingTeam = s.away.name;
      c.runs = 0; c.wickets = 0; c.overs = 0; c.balls = 0; c.partnership = 0;
    }
    const scoreStr = `${c.runs}/${c.wickets}`;
    if (c.target === null) s.home.score = scoreStr;
    else s.away.score = scoreStr;
    s.timeline = s.timeline.slice(0, 20);
  }

  private goal(s: LiveScore, side: 'home' | 'away', minute: number) {
    s[side].score = String(Number(s[side].score) + 1);
    s.timeline.unshift({ at: Date.now(), text: `${minute}' GOAL — ${s[side].name}` });
    s.timeline = s.timeline.slice(0, 20);
  }

  private points(s: LiveScore, n: number) {
    const side = rand() < 0.5 ? 'home' : 'away';
    s[side].score = String(Number(s[side].score) + n);
  }

  private emit(s: LiveScore) { this.listeners.forEach((l) => l({ ...s })); }
}
