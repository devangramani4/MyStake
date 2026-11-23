/**
 * DEVELOPMENT / TEST ONLY. Generates a synthetic exchange catalogue.
 * Loaded exclusively when BETFAIR_MODE=mock; production refuses this mode.
 */
import { tick, snapPrice } from '../../../utils/exchange.js';

export interface MockRunner { selectionId: number; name: string; prob: number; status: 'ACTIVE' | 'WINNER' | 'LOSER' | 'REMOVED' }
export interface MockMarket {
  marketId: string;
  eventId: string;
  name: string;
  marketType: string;
  startTime: number;
  status: 'OPEN' | 'SUSPENDED' | 'CLOSED';
  inPlay: boolean;
  turnInPlay: boolean;
  totalMatched: number;
  version: number;
  runners: MockRunner[];
  suspendedUntil: number;
  closesAt: number;
  /** close before the event goes in-play (e.g. toss market) */
  closeAtStart?: boolean;
}
export interface MockEvent { eventId: string; sportId: string; competitionId: string; name: string; countryCode: string; venue: string; openDate: number; durationMs: number; home: string; away: string }
export interface MockCompetition { id: string; sportId: string; name: string; region: string }
export interface MockSport { id: string; name: string }

let seed = 1337;
export function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

export const SPORTS: MockSport[] = [
  { id: '4', name: 'Cricket' }, { id: '1', name: 'Football' }, { id: '2', name: 'Tennis' },
  { id: '7522', name: 'Basketball' }, { id: '7511', name: 'Baseball' }, { id: '7524', name: 'Ice Hockey' },
  { id: '998917', name: 'Volleyball' }, { id: '5', name: 'Rugby Union' }, { id: '3', name: 'Golf' },
  { id: '6', name: 'Boxing' }, { id: '26420387', name: 'Mixed Martial Arts' }, { id: '7', name: 'Horse Racing' },
  { id: '27454571', name: 'Esports' },
];

const TEAMS: Record<string, { comps: Array<[string, string, string]>; teams: string[] }> = {
  '4': { comps: [['101', 'International T20', 'INT'], ['102', 'Indian Premier League', 'IN'], ['103', 'Test Series', 'INT']], teams: ['India', 'Australia', 'England', 'South Africa', 'New Zealand', 'Pakistan', 'Sri Lanka', 'West Indies', 'Bangladesh', 'Afghanistan'] },
  '1': { comps: [['201', 'English Premier League', 'GB'], ['202', 'La Liga', 'ES'], ['203', 'UEFA Champions League', 'INT']], teams: ['Arsenal', 'Chelsea', 'Liverpool', 'Man City', 'Tottenham', 'Real Madrid', 'Barcelona', 'Sevilla', 'Bayern', 'Inter', 'Juventus', 'PSG'] },
  '2': { comps: [['301', 'ATP Tour', 'INT'], ['302', 'WTA Tour', 'INT']], teams: ['C. Alcaraz', 'J. Sinner', 'N. Djokovic', 'D. Medvedev', 'A. Zverev', 'T. Fritz', 'I. Swiatek', 'A. Sabalenka', 'C. Gauff', 'E. Rybakina'] },
  '7522': { comps: [['401', 'NBA', 'US'], ['402', 'EuroLeague', 'EU']], teams: ['Lakers', 'Celtics', 'Warriors', 'Bucks', 'Nuggets', 'Heat', 'Suns', 'Knicks'] },
  '7511': { comps: [['501', 'MLB', 'US']], teams: ['Yankees', 'Dodgers', 'Astros', 'Braves', 'Mets', 'Red Sox'] },
  '7524': { comps: [['601', 'NHL', 'US']], teams: ['Rangers', 'Bruins', 'Oilers', 'Maple Leafs', 'Avalanche', 'Panthers'] },
  '998917': { comps: [['701', 'Volleyball Nations League', 'INT']], teams: ['Poland', 'Italy', 'Brazil', 'USA', 'France', 'Japan'] },
  '5': { comps: [['801', 'Six Nations', 'EU']], teams: ['Ireland', 'France', 'England', 'Scotland', 'Wales', 'Italy'] },
  '3': { comps: [['901', 'PGA Tour', 'US']], teams: [] },
  '6': { comps: [['1001', 'World Title Fights', 'INT']], teams: ['Fighter A. Cruz', 'Fighter B. Okafor', 'Fighter C. Ivanov', 'Fighter D. Mensah'] },
  '26420387': { comps: [['1101', 'UFC', 'INT']], teams: ['R. Silva', 'K. Novak', 'M. Petrov', 'J. Adeyemi', 'L. Santos', 'T. Walker'] },
  '7': { comps: [['1201', 'UK Racing', 'GB'], ['1202', 'IE Racing', 'IE']], teams: [] },
  '27454571': { comps: [['1301', 'CS2 Major', 'INT'], ['1302', 'LoL Worlds', 'INT']], teams: ['Team Nova', 'Vertex', 'Blue Owls', 'Ironclad', 'Zenith', 'Polaris'] },
};
const GOLFERS = ['S. Scheffler', 'R. McIlroy', 'X. Schauffele', 'J. Rahm', 'C. Morikawa', 'V. Hovland', 'L. Aberg', 'T. Fleetwood'];
const HORSES = ['Silver Comet', 'Night Archer', 'Golden Mile', 'River Dancer', 'Storm Chaser', 'Lucky Clover', 'Iron Duke', 'Velvet Sky'];
const COURSES = ['Ascot', 'Cheltenham', 'Newmarket', 'Leopardstown', 'York', 'Curragh'];

let nextEventId = 34000000;
let nextMarketNum = 230000000;
let nextSelection = 47000;

const DURATION: Record<string, number> = { '4': 45, '1': 30, '2': 25, '7522': 25, '7511': 25, '7524': 25, '998917': 20, '5': 25, '3': 40, '6': 10, '26420387': 10, '7': 4, '27454571': 20 };

function normalise(probs: number[]) {
  const s = probs.reduce((a, b) => a + b, 0);
  return probs.map((p) => p / s);
}

function market(event: MockEvent, name: string, marketType: string, runners: Array<[string, number]>, extra: Partial<MockMarket> = {}): MockMarket {
  const probs = normalise(runners.map(([, p]) => p));
  return {
    marketId: `1.${nextMarketNum++}`,
    eventId: event.eventId,
    name,
    marketType,
    startTime: event.openDate,
    status: 'OPEN',
    inPlay: false,
    turnInPlay: true,
    totalMatched: Math.round(5000 + rand() * 900000),
    version: 1,
    runners: runners.map(([n], i) => ({ selectionId: nextSelection++, name: n, prob: probs[i], status: 'ACTIVE' })),
    suspendedUntil: 0,
    closesAt: event.openDate + event.durationMs,
    ...extra,
  };
}

export function buildEvent(sportId: string, openDate: number): { event: MockEvent; markets: MockMarket[] } {
  const cfg = TEAMS[sportId];
  const [compId, , region] = pick(cfg.comps);
  const durationMs = DURATION[sportId] * 60_000;
  let home = '', away = '', name: string;
  if (sportId === '7') {
    name = `${pick(COURSES)} ${new Date(openDate).toISOString().slice(11, 16)}`;
  } else if (sportId === '3') {
    name = `${pick(['The Open', 'Masters Invitational', 'Players Classic'])} ${new Date(openDate).getUTCFullYear()}`;
  } else {
    home = pick(cfg.teams);
    do away = pick(cfg.teams); while (away === home);
    name = `${home} v ${away}`;
  }
  const event: MockEvent = { eventId: String(nextEventId++), sportId, competitionId: compId, name, countryCode: region.slice(0, 2), venue: '', openDate, durationMs, home, away };
  const strength = 0.3 + rand() * 0.4;
  const markets: MockMarket[] = [];
  switch (sportId) {
    case '4':
      markets.push(market(event, 'Match Odds', 'MATCH_ODDS', [[home, strength], [away, 1 - strength]]));
      markets.push(market(event, 'Toss Winner', 'TOSS', [[home, 0.5], [away, 0.5]], { closeAtStart: true, turnInPlay: false }));
      markets.push(market(event, 'Total Runs Over/Under 320.5', 'TOTAL_RUNS', [['Over 320.5', 0.5], ['Under 320.5', 0.5]]));
      markets.push(market(event, `Top ${home} Batsman`, 'TOP_BATSMAN', [['Opener 1', 0.25], ['Opener 2', 0.22], ['No. 3', 0.2], ['No. 4', 0.18], ['No. 5', 0.15]]));
      break;
    case '1':
      markets.push(market(event, 'Match Odds', 'MATCH_ODDS', [[home, strength], [away, (1 - strength) * 0.7], ['The Draw', 0.27]]));
      markets.push(market(event, 'Over/Under 2.5 Goals', 'OVER_UNDER_25', [['Under 2.5 Goals', 0.48], ['Over 2.5 Goals', 0.52]]));
      markets.push(market(event, 'Both teams to Score?', 'BOTH_TEAMS_TO_SCORE', [['Yes', 0.55], ['No', 0.45]]));
      break;
    case '3':
      markets.push(market(event, 'Winner', 'WINNER', GOLFERS.map((g, i) => [g, 1 / (i + 2)] as [string, number])));
      break;
    case '7':
      markets.push(market(event, 'Win', 'WIN', HORSES.slice(0, 6 + Math.floor(rand() * 3)).map((h, i) => [h, 1 / (i + 1.5)] as [string, number]), { turnInPlay: true }));
      break;
    default:
      markets.push(market(event, sportId === '6' || sportId === '26420387' ? 'Match Odds' : 'Match Odds', 'MATCH_ODDS', [[home, strength], [away, 1 - strength]]));
      if (['7522', '7524', '5'].includes(sportId)) {
        markets.push(market(event, 'Handicap', 'HANDICAP', [[`${home} -3.5`, 0.5], [`${away} +3.5`, 0.5]]));
      }
  }
  return { event, markets };
}

/** Odds ladder (top 3 levels) from a probability, with a small spread. */
export function ladders(prob: number) {
  const fair = Math.min(1000, Math.max(1.01, 1 / Math.max(prob, 0.001)));
  const bestBack = snapPrice(fair * 0.985);
  const bestLay = tick(bestBack, 1);
  const size = () => Math.round((200 + rand() * 9000) * 100) / 100;
  let b = bestBack, l = bestLay;
  const back = [] as Array<{ price: number; size: number }>;
  const lay = [] as Array<{ price: number; size: number }>;
  for (let i = 0; i < 3; i++) {
    back.push({ price: b, size: size() });
    lay.push({ price: l, size: size() });
    b = tick(b, -1);
    l = tick(l, 1);
  }
  return { back, lay };
}

export function competitionsList(): MockCompetition[] {
  return Object.entries(TEAMS).flatMap(([sportId, c]) => c.comps.map(([id, name, region]) => ({ id, sportId, name, region })));
}
