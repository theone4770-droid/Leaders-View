export type MarketSymbol = 'XAUUSD' | 'BTCUSD';

export type ConnectionStatus = 'LIVE' | 'DELAYED' | 'DISCONNECTED';

export type ThemeMode = 'dark' | 'light';

export type TimeframeId =
  | '1s'
  | '5s'
  | '10s'
  | '15s'
  | '30s'
  | '45s'
  | '1m'
  | '2m'
  | '3m'
  | '5m'
  | '10m'
  | '15m'
  | '30m'
  | '45m'
  | '1h'
  | '2h'
  | '3h'
  | '4h'
  | '1D'
  | '1W'
  | '1M'
  | '3M'
  | '6M'
  | '12M';

export type DateRangeId = '1D' | '5D' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '3Y' | '5Y';

export interface Candle {
  time: number; // UTC ms open timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TickerData {
  market: MarketSymbol;
  symbol: string;
  description: string;
  providerSymbol: string;
  price: number;
  open24h: number;
  change: number;
  changePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timestamp: number;
}

export interface MarketMeta {
  symbol: MarketSymbol;
  description: string;
  decimals: number;
  minTick: number;
  providerLabel: string;
}

export interface ViewportState {
  /** Index of the rightmost visible candle (can be fractional or beyond last candle for right margin) */
  rightOffset: number;
  /** Pixel width of one candle slot (candle body + gap) */
  barSpacing: number;
  /** Vertical auto-scale enabled unless user manually drags price scale or pans vertically */
  autoScaleY: boolean;
  /** Manual price scale minimum (used when autoScaleY is false) */
  priceMin: number;
  /** Manual price scale maximum (used when autoScaleY is false) */
  priceMax: number;
}

export type DrawingCategoryId =
  | 'FAVORITES'
  | 'TOOLS'
  | 'TREND_TOOLS'
  | 'GANN_AND_FIBONACCI'
  | 'PATTERNS'
  | 'FORECASTING_AND_MEASUREMENT'
  | 'GEOMETRIC_SHAPES'
  | 'ANNOTATION'
  | 'VISUALS';

export type LineStyleType = 'solid' | 'dashed' | 'dotted';

export interface WorldPoint {
  time: number;
  price: number;
}

export interface DrawingStyle {
  color: string;
  fillColor?: string;
  lineWidth: number;
  lineStyle: LineStyleType;
  opacity: number; // 0..1
  fontSize?: number;
}

export interface FibLevelConfig {
  level: number;
  enabled: boolean;
  color?: string;
}

export interface DrawingObject {
  id: string;
  toolId: string;
  market: MarketSymbol;
  points: WorldPoint[];
  style: DrawingStyle;
  text?: string;
  visualGlyph?: string;
  /** Extra parameters for Long/Short Position targets & stops and Fibonacci Retracement levels */
  meta?: {
    stopPrice?: number;
    targetPrice?: number;
    locked?: boolean;
    visible?: boolean;
    createdAt?: number;
    fibLevels?: FibLevelConfig[];
    fibShowPrices?: boolean;
    fibExtendRight?: boolean;
    fibReverse?: boolean;
    fibShowBackground?: boolean;
  };
}

export type CursorToolId =
  | 'tool_cross'
  | 'tool_dot'
  | 'tool_arrow'
  | 'tool_demonstration'
  | 'tool_magic'
  | 'tool_eraser';

export interface DrawingToolDefinition {
  id: string;
  name: string;
  category: Exclude<DrawingCategoryId, 'FAVORITES'>;
  pointCount: number; // 0 = cursor/eraser, 1 = single click, 2 = 2-pt, 3 = 3-pt, -1 = multi-point click, -2 = freehand drag
  isCursorTool?: boolean;
  isVisualPicker?: 'EMOJIS' | 'STICKERS' | 'ICONS';
  defaultColor?: string;
}

export type AlertCondition =
  | 'CROSSING'
  | 'CROSSING_UP'
  | 'CROSSING_DOWN'
  | 'GREATER_THAN'
  | 'LESS_THAN';

export interface PriceAlert {
  id: string;
  market: MarketSymbol;
  price: number;
  condition: AlertCondition;
  note: string;
  active: boolean;
  triggered: boolean;
  triggeredAt?: number;
  createdAt: number;
  lastCheckedPrice?: number;
}

export type ReplaySpeed = 0.1 | 0.2 | 0.3 | 0.5 | 1 | 3 | 5 | 7 | 10;

export interface ReplayState {
  mode: 'OFF' | 'SELECTING' | 'READY' | 'PLAYING' | 'PAUSED';
  cutIndex: number | null;
  speed: ReplaySpeed;
}

export interface CrosshairData {
  visible: boolean;
  x: number;
  y: number;
  time: number;
  price: number;
  candle: Candle | null;
}
