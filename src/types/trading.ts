import { MarketSymbol } from './chart';

export type TradingScreen = 'NONE' | 'TRADE' | 'PENDING' | 'HISTORY';

export type TradeDirection = 'BUY' | 'SELL';

export type PendingOrderType =
  | 'BUY_STOP'
  | 'SELL_STOP'
  | 'BUY_LIMIT'
  | 'SELL_LIMIT'
  | 'BUY_STOP_LIMIT'
  | 'SELL_STOP_LIMIT';

export type HistoryOrderType = TradeDirection | PendingOrderType;

export type OrderStatus = 'Filled' | 'Cancelled' | 'Pending' | 'Rejected' | 'Expired';

export type DealDirection = 'IN' | 'OUT';

export type HistoryTab = 'POSITION' | 'ORDERS' | 'DEALS';

export type HistorySortOption =
  | 'NEWEST'
  | 'OLDEST'
  | 'HIGHEST_PROFIT'
  | 'LOWEST_PROFIT';

export type HistorySymbolFilter = 'ALL' | MarketSymbol;

export type CalendarPreset =
  | 'TODAY'
  | 'YESTERDAY'
  | 'LAST_WEEK'
  | 'LAST_MONTH'
  | 'LAST_3_MONTHS'
  | 'CUSTOM';

export interface CalendarFilterState {
  preset: CalendarPreset;
  customStartDate: string; // YYYY-MM-DD local
  customEndDate: string;   // YYYY-MM-DD local
}

export interface InstrumentSpreadConfig {
  symbol: MarketSymbol;
  baseSpread: number;
  minSpread: number;
  maxSpread: number;
  contractSize: number; // XAUUSD: 100 oz per 1.00 lot; BTCUSD: 1 BTC per 1.00 lot
  decimals: number;
  pointStep: number;
}

export interface MarketBidAskQuote {
  symbol: MarketSymbol;
  mid: number;
  bid: number;
  ask: number;
  spread: number;
  isLiveFeed: boolean;
  isSimulatedSpread: boolean;
  spreadLabel: string;
  timestamp: number;
}

export interface OpenPosition {
  id: string;
  symbol: MarketSymbol;
  direction: TradeDirection;
  lotSize: number;
  entryPrice: number;
  sl: number | null;
  tp: number | null;
  openedAt: number;
  sourceOrderId: string;
}

export interface PendingOrder {
  id: string;
  symbol: MarketSymbol;
  orderType: PendingOrderType;
  direction: TradeDirection;
  lotSize: number;
  entryPrice: number; // For Stop-Limit, this is Stop trigger price
  limitPrice: number | null; // Used by BUY_STOP_LIMIT / SELL_STOP_LIMIT
  stopTriggered: boolean; // Becomes true when Stop-Limit trigger fires and arms limit order
  sl: number | null;
  tp: number | null;
  expiresAt: number | null; // UTC ms or null for GTC
  createdAt: number;
  status: 'Pending';
}

export interface ClosedPositionRecord {
  id: string;
  positionId: string;
  symbol: MarketSymbol;
  direction: TradeDirection;
  lotSize: number;
  entryPrice: number;
  exitPrice: number;
  sl: number | null;
  tp: number | null;
  openedAt: number;
  closedAt: number;
  profitLoss: number;
  closeReason: 'MANUAL' | 'SL' | 'TP';
}

export interface OrderHistoryRecord {
  id: string;
  symbol: MarketSymbol;
  direction: TradeDirection;
  orderType: HistoryOrderType;
  lotSize: number;
  requestedPrice: number;
  limitPrice: number | null;
  executedPrice: number | null;
  sl: number | null;
  tp: number | null;
  createdAt: number;
  updatedAt: number;
  status: OrderStatus;
  note?: string;
}

export interface DealHistoryRecord {
  id: string;
  orderId: string;
  positionId: string;
  symbol: MarketSymbol;
  direction: TradeDirection;
  dealType: DealDirection;
  lotSize: number;
  executedPrice: number;
  executedAt: number;
  profitLoss: number | null; // null or realized P/L for OUT deals
}

export interface BalanceLedgerEntry {
  id: string;
  timestamp: number;
  type: 'INITIAL_DEMO' | 'REALIZED_PNL' | 'DEMO_RESET' | 'DEMO_DEPOSIT';
  symbol: MarketSymbol | 'USD';
  description: string;
  amount: number;
  balanceAfter: number;
}

export interface TradingAccountState {
  version: number;
  balanceUSD: number;
  initialBalanceUSD: number;
  activeBuySell: boolean;
  openPositions: OpenPosition[];
  pendingOrders: PendingOrder[];
  positionHistory: ClosedPositionRecord[];
  orderHistory: OrderHistoryRecord[];
  dealHistory: DealHistoryRecord[];
  ledger: BalanceLedgerEntry[];
}
