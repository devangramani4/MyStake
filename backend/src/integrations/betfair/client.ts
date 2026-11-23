import type {
  AccountFunds, CancelExecutionReport, CancelInstruction, CompetitionResult, CurrentOrderSummary, EventResult,
  EventTypeResult, MarketBook, MarketCatalogue, MarketFilter, MarketSnapshot, PlaceExecutionReport,
  PlaceInstruction, ReplaceExecutionReport, ReplaceInstruction,
} from './types.js';

export type CatalogueProjection = 'COMPETITION' | 'EVENT' | 'EVENT_TYPE' | 'MARKET_START_TIME' | 'MARKET_DESCRIPTION' | 'RUNNER_DESCRIPTION';

export interface IntegrationStatus {
  mode: 'mock' | 'live';
  sessionValid: boolean;
  streamConnected: boolean;
  lastError: string | null;
  lastSuccessAt: number | null;
}

/**
 * The single seam between the platform and Betfair. Implemented by
 * `LiveBetfairClient` (real API-NG) and `MockBetfairClient` (development/tests).
 * Nothing outside `integrations/betfair` talks to Betfair directly.
 */
export interface BetfairClient {
  readonly mode: 'mock' | 'live';
  listEventTypes(filter?: MarketFilter): Promise<EventTypeResult[]>;
  listCompetitions(filter: MarketFilter): Promise<CompetitionResult[]>;
  listEvents(filter: MarketFilter): Promise<EventResult[]>;
  listMarketCatalogue(filter: MarketFilter, maxResults: number, projection?: CatalogueProjection[]): Promise<MarketCatalogue[]>;
  listMarketBook(marketIds: string[]): Promise<MarketBook[]>;
  placeOrders(marketId: string, instructions: PlaceInstruction[], customerRef: string): Promise<PlaceExecutionReport>;
  cancelOrders(marketId: string, instructions: CancelInstruction[], customerRef?: string): Promise<CancelExecutionReport>;
  replaceOrders(marketId: string, instructions: ReplaceInstruction[], customerRef?: string): Promise<ReplaceExecutionReport>;
  listCurrentOrders(params: { betIds?: string[]; customerOrderRefs?: string[]; marketIds?: string[] }): Promise<CurrentOrderSummary[]>;
  getAccountFunds(): Promise<AccountFunds>;
  status(): IntegrationStatus;
}

export type SnapshotListener = (snap: MarketSnapshot) => void;

/** Live price feed: Betfair Exchange Stream API, polling fallback, or mock simulator. */
export interface MarketStream {
  start(): void;
  stop(): void;
  /** Replace the full set of markets the platform needs prices for. */
  setSubscriptions(marketIds: string[]): void;
  onSnapshot(listener: SnapshotListener): void;
  onStatus(listener: (connected: boolean) => void): void;
  isConnected(): boolean;
}

export type ApiCallObserver = (entry: { operation: string; status: 'OK' | 'ERROR' | 'TIMEOUT'; durationMs: number; errorCode?: string }) => void;
