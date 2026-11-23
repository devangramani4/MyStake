export type Side = 'BACK' | 'LAY';
export type MarketStatus = 'INACTIVE' | 'OPEN' | 'SUSPENDED' | 'CLOSED';
export type RunnerStatus = 'ACTIVE' | 'WINNER' | 'LOSER' | 'PLACED' | 'REMOVED' | 'REMOVED_VACANT' | 'HIDDEN';

export interface PriceSize { price: number; size: number }

export interface RunnerBook {
  selectionId: number;
  status: RunnerStatus;
  lastPriceTraded: number | null;
  totalMatched: number;
  back: PriceSize[];
  lay: PriceSize[];
}

export interface MarketBook {
  marketId: string;
  status: MarketStatus;
  inPlay: boolean;
  betDelay: number;
  totalMatched: number;
  version: number;
  updatedAt: number;
  runners: RunnerBook[];
}

export interface Sport { id: string; name: string; slug: string; icon: string | null; eventCount: number; liveCount: number }
export interface Competition { id: string; name: string; eventCount: number }

export interface RunnerInfo { selectionId: number; name: string; sortPriority: number; status: string }

export interface MarketSummary {
  marketId: string;
  name: string;
  marketType: string | null;
  startTime: string;
  status: MarketStatus;
  inPlay: boolean;
  suspendedByAdmin: boolean;
  totalMatched: string;
  runners: RunnerInfo[];
}

export interface EventSummary {
  eventId: string;
  name: string;
  sport: { id: string; name: string; slug: string };
  competition: { id: string; name: string } | null;
  openDate: string;
  status: 'UPCOMING' | 'IN_PLAY' | 'CLOSED' | 'SUSPENDED';
  hasStream: boolean;
  isFeatured: boolean;
  marketCount: number;
  mainMarket: MarketSummary | null;
}

export interface CricketScore { battingTeam: string; runs: number; wickets: number; overs: number; balls: number; target: number | null; partnership: number; maxOvers: number }
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

export interface EventDetail extends Omit<EventSummary, 'mainMarket' | 'marketCount' | 'isFeatured'> {
  venue: string | null;
  markets: MarketSummary[];
  books: MarketBook[];
  score: LiveScore | null;
}

export interface User {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  currency: string;
  status: string;
  emailVerified: boolean;
  kycStatus: string;
  twoFactorEnabled: boolean;
  termsAccepted: boolean;
  createdAt: string;
}

export interface Wallet { currency: string; balance: string; exposure: string; total: string; profitLoss?: string; pendingBets?: number }

export type BetStatus = 'PENDING' | 'UNMATCHED' | 'PARTIALLY_MATCHED' | 'MATCHED' | 'CANCELLED' | 'LAPSED' | 'FAILED' | 'SETTLED' | 'VOIDED';

export interface BetItem {
  id: string;
  betId: string;
  side: Side;
  price: string;
  stake: string;
  liability: string;
  sizeMatched: string;
  avgPriceMatched: string | null;
  status: BetStatus;
  result: 'WIN' | 'LOSS' | 'VOID' | 'PARTIAL' | null;
  profitLoss: string | null;
  commission: string;
  failureCode: string | null;
  potentialProfit: string;
  placedAt: string;
  settledAt: string | null;
  marketId: string;
  marketName: string;
  eventId: string;
  eventName: string;
  sportName: string;
  selectionId: number;
  selectionName: string;
}

export interface Page<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number }

export interface Transaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'COMMISSION' | 'ADJUSTMENT';
  amount: string;
  exposureChange: string;
  balanceAfter: string;
  exposureAfter: string;
  description: string | null;
  createdAt: string;
}

export interface Notification { id: number; type: string; title: string; body: string; readAt: string | null; createdAt: string }

export interface Promotion { slug: string; title: string; summary: string; body: string; badge: string | null; terms: string | null }

export interface ApiErrorBody { code: string; message: string; details?: Record<string, unknown>; requestId?: string }
