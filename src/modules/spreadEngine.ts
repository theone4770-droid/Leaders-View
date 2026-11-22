import { ConnectionStatus, MarketSymbol } from '../types/chart';
import {
  InstrumentSpreadConfig,
  MarketBidAskQuote,
  OpenPosition,
} from '../types/trading';

export const INSTRUMENT_SPREAD_CONFIG: Record<MarketSymbol, InstrumentSpreadConfig> = {
  XAUUSD: {
    symbol: 'XAUUSD',
    baseSpread: 0.34,
    minSpread: 0.24,
    maxSpread: 0.52,
    contractSize: 100, // 1.00 lot = 100 troy oz -> $1 move = $100 P/L; 0.01 lot -> $1 per $1 move
    decimals: 2,
    pointStep: 0.01,
  },
  BTCUSD: {
    symbol: 'BTCUSD',
    baseSpread: 24.00,
    minSpread: 16.00,
    maxSpread: 38.00,
    contractSize: 1, // 1.00 lot = 1 BTC -> $1 move = $1 P/L
    decimals: 2,
    pointStep: 0.01,
  },
};

export function roundToInstrument(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function roundUSD(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Computes an instrument-specific Standard Account floating Bid/Ask quote
 * anchored on the current feed spot price (Bid = spot, Ask = Bid + spread).
 * Simulated Standard Account spreads are always honestly labeled.
 */
export function computeBidAskQuote(
  symbol: MarketSymbol,
  spotPrice: number | undefined,
  connectionStatus: ConnectionStatus,
  nowMs: number = Date.now()
): MarketBidAskQuote | null {
  if (typeof spotPrice !== 'number' || !Number.isFinite(spotPrice) || spotPrice <= 0) {
    return null;
  }

  const cfg = INSTRUMENT_SPREAD_CONFIG[symbol];
  const isLiveFeed = connectionStatus === 'LIVE';
  const spread = Math.max(cfg.pointStep, roundToInstrument(cfg.baseSpread, cfg.decimals));

  const bid = roundToInstrument(spotPrice, cfg.decimals);
  const ask = roundToInstrument(bid + spread, cfg.decimals);
  const exactSpread = roundToInstrument(ask - bid, cfg.decimals);
  const mid = roundToInstrument((bid + ask) / 2, cfg.decimals);

  const spreadLabel = isLiveFeed
    ? 'LIVE SPOT · SIMULATED STD SPREAD'
    : 'DEMO · SIMULATED STD SPREAD';

  return {
    symbol,
    mid,
    bid,
    ask,
    spread: exactSpread,
    isLiveFeed,
    isSimulatedSpread: true,
    spreadLabel,
    timestamp: nowMs,
  };
}

export function computeUnrealizedPnL(
  position: Pick<OpenPosition, 'symbol' | 'direction' | 'lotSize' | 'entryPrice'>,
  quote: MarketBidAskQuote | null
): { currentClosePrice: number; pnl: number } {
  if (!quote) {
    return { currentClosePrice: position.entryPrice, pnl: 0 };
  }
  const cfg = INSTRUMENT_SPREAD_CONFIG[position.symbol];
  // MetaTrader execution convention: BUY closes at BID, SELL closes at ASK
  const currentClosePrice = position.direction === 'BUY' ? quote.bid : quote.ask;
  const diff =
    position.direction === 'BUY'
      ? currentClosePrice - position.entryPrice
      : position.entryPrice - currentClosePrice;
  const pnl = roundUSD(diff * position.lotSize * cfg.contractSize);
  return { currentClosePrice, pnl };
}

export function computeClosedPnL(
  symbol: MarketSymbol,
  direction: 'BUY' | 'SELL',
  lotSize: number,
  entryPrice: number,
  exitPrice: number
): number {
  const cfg = INSTRUMENT_SPREAD_CONFIG[symbol];
  const diff = direction === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return roundUSD(diff * lotSize * cfg.contractSize);
}

export function formatSpreadPoints(spread: number, symbol: MarketSymbol): number {
  const cfg = INSTRUMENT_SPREAD_CONFIG[symbol];
  return Math.round(spread / cfg.pointStep);
}
