/**
 * Subset of the Betfair Exchange API-NG types used by the platform.
 * Field names mirror the official API so responses map 1:1.
 */
export type MarketStatus = 'INACTIVE' | 'OPEN' | 'SUSPENDED' | 'CLOSED';
export type RunnerStatus = 'ACTIVE' | 'WINNER' | 'LOSER' | 'PLACED' | 'REMOVED_VACANT' | 'REMOVED' | 'HIDDEN';
export type Side = 'BACK' | 'LAY';

export interface EventTypeResult { eventType: { id: string; name: string }; marketCount: number }
export interface CompetitionResult { competition: { id: string; name: string }; marketCount: number; competitionRegion?: string }
export interface EventResult {
  event: { id: string; name: string; countryCode?: string; timezone?: string; venue?: string; openDate: string };
  marketCount: number;
}

export interface MarketFilter {
  eventTypeIds?: string[];
  competitionIds?: string[];
  eventIds?: string[];
  marketIds?: string[];
  marketTypeCodes?: string[];
  inPlayOnly?: boolean;
  turnInPlayEnabled?: boolean;
  marketStartTime?: { from?: string; to?: string };
  textQuery?: string;
}

export interface RunnerCatalog { selectionId: number; runnerName: string; handicap: number; sortPriority: number }

export interface MarketCatalogue {
  marketId: string;
  marketName: string;
  marketStartTime?: string;
  totalMatched?: number;
  description?: { bettingType: string; marketType: string; turnInPlayEnabled: boolean; persistenceEnabled?: boolean };
  runners?: RunnerCatalog[];
  eventType?: { id: string; name: string };
  competition?: { id: string; name: string };
  event?: { id: string; name: string; countryCode?: string; timezone?: string; venue?: string; openDate: string };
}

export interface PriceSize { price: number; size: number }

export interface RunnerBook {
  selectionId: number;
  handicap: number;
  status: RunnerStatus;
  lastPriceTraded?: number;
  totalMatched?: number;
  ex?: { availableToBack: PriceSize[]; availableToLay: PriceSize[]; tradedVolume?: PriceSize[] };
}

export interface MarketBook {
  marketId: string;
  isMarketDataDelayed: boolean;
  status: MarketStatus;
  betDelay: number;
  inplay: boolean;
  numberOfActiveRunners: number;
  totalMatched: number;
  version: number;
  runners: RunnerBook[];
}

export interface PlaceInstruction {
  orderType: 'LIMIT';
  selectionId: number;
  handicap?: number;
  side: Side;
  limitOrder: { size: number; price: number; persistenceType: 'LAPSE' | 'PERSIST' | 'MARKET_ON_CLOSE' };
  customerOrderRef?: string;
}

export type InstructionReportStatus = 'SUCCESS' | 'FAILURE' | 'TIMEOUT';
export type OrderStatus = 'PENDING' | 'EXECUTION_COMPLETE' | 'EXECUTABLE' | 'EXPIRED';

export interface PlaceInstructionReport {
  status: InstructionReportStatus;
  errorCode?: string;
  orderStatus?: OrderStatus;
  instruction: PlaceInstruction;
  betId?: string;
  placedDate?: string;
  averagePriceMatched?: number;
  sizeMatched?: number;
}

export interface PlaceExecutionReport {
  customerRef?: string;
  status: InstructionReportStatus;
  errorCode?: string;
  marketId: string;
  instructionReports: PlaceInstructionReport[];
}

export interface CancelInstruction { betId: string; sizeReduction?: number }
export interface CancelExecutionReport {
  status: InstructionReportStatus;
  errorCode?: string;
  marketId: string;
  instructionReports: Array<{ status: InstructionReportStatus; errorCode?: string; instruction: CancelInstruction; sizeCancelled: number; cancelledDate?: string }>;
}

export interface ReplaceInstruction { betId: string; newPrice: number }
export interface ReplaceExecutionReport {
  status: InstructionReportStatus;
  errorCode?: string;
  marketId: string;
  instructionReports: Array<{ status: InstructionReportStatus; errorCode?: string; cancelInstructionReport?: { sizeCancelled: number }; placeInstructionReport?: PlaceInstructionReport }>;
}

export interface CurrentOrderSummary {
  betId: string;
  marketId: string;
  selectionId: number;
  side: Side;
  priceSize: PriceSize;
  status: OrderStatus;
  averagePriceMatched: number;
  sizeMatched: number;
  sizeRemaining: number;
  sizeLapsed: number;
  sizeCancelled: number;
  sizeVoided: number;
  customerOrderRef?: string;
}

export interface AccountFunds {
  availableToBetBalance: number;
  exposure: number;
  retainedCommission: number;
  exposureLimit: number;
  discountRate?: number;
  pointsBalance?: number;
}

/** Normalised, UI-ready market snapshot pushed through our WebSocket layer. */
export interface MarketSnapshot {
  marketId: string;
  status: MarketStatus;
  inPlay: boolean;
  betDelay: number;
  totalMatched: number;
  version: number;
  updatedAt: number;
  runners: Array<{
    selectionId: number;
    status: RunnerStatus;
    lastPriceTraded: number | null;
    totalMatched: number;
    back: PriceSize[];
    lay: PriceSize[];
  }>;
}
