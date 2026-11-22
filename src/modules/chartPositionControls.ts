import { MarketSymbol } from '../types/chart';
import { MarketBidAskQuote, OpenPosition } from '../types/trading';
import { computeClosedPnL, INSTRUMENT_SPREAD_CONFIG } from './spreadEngine';

export interface PositionLayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PositionChartGeometry {
  positionId: string;
  entryLineY: number;
  entryPillRect: PositionLayoutRect;
  slHandleRect: PositionLayoutRect | null;
  tpHandleRect: PositionLayoutRect | null;
  slLineY: number | null;
  slPillRect: PositionLayoutRect | null;
  slClearRect: PositionLayoutRect | null;
  tpLineY: number | null;
  tpPillRect: PositionLayoutRect | null;
  tpClearRect: PositionLayoutRect | null;
}

export interface PositionDragPreview {
  positionId: string;
  target: 'SL' | 'TP';
  price: number;
}

export type PositionHitResult =
  | { kind: 'entry'; positionId: string; onPill: boolean }
  | { kind: 'slHandle'; positionId: string }
  | { kind: 'tpHandle'; positionId: string }
  | { kind: 'slLine'; positionId: string; onPill: boolean }
  | { kind: 'tpLine'; positionId: string; onPill: boolean }
  | { kind: 'clearSl'; positionId: string }
  | { kind: 'clearTp'; positionId: string };

export function formatSignedUSD(value: number): string {
  const abs = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (value > 0) return `+$${abs} USD`;
  if (value < 0) return `-$${abs} USD`;
  return `$0.00 USD`;
}

export function computeProjectedSlTpPnL(
  position: Pick<OpenPosition, 'symbol' | 'direction' | 'lotSize' | 'entryPrice'>,
  targetPrice: number
): number {
  return computeClosedPnL(
    position.symbol,
    position.direction,
    position.lotSize,
    position.entryPrice,
    targetPrice
  );
}

export function getReferenceMarketPriceForSlTp(
  position: Pick<OpenPosition, 'direction' | 'entryPrice'>,
  quote: MarketBidAskQuote | null
): number {
  if (!quote) return position.entryPrice;
  return position.direction === 'BUY' ? quote.bid : quote.ask;
}

export function isSlTpPriceValidForPosition(
  position: Pick<OpenPosition, 'direction' | 'entryPrice'>,
  target: 'SL' | 'TP',
  price: number,
  quote: MarketBidAskQuote | null
): { valid: boolean; reason?: string } {
  if (!Number.isFinite(price) || price <= 0) {
    return { valid: false, reason: 'Invalid price level.' };
  }
  const ref = getReferenceMarketPriceForSlTp(position, quote);
  if (target === 'SL') {
    if (position.direction === 'BUY' && price >= ref) {
      return { valid: false, reason: 'For BUY, SL must be below price' };
    }
    if (position.direction === 'SELL' && price <= ref) {
      return { valid: false, reason: 'For SELL, SL must be above price' };
    }
  } else {
    if (position.direction === 'BUY' && price <= ref) {
      return { valid: false, reason: 'For BUY, TP must be above price' };
    }
    if (position.direction === 'SELL' && price >= ref) {
      return { valid: false, reason: 'For SELL, TP must be below price' };
    }
  }
  return { valid: true };
}

function pointInRect(
  px: number,
  py: number,
  rect: PositionLayoutRect | null,
  padX = 4,
  padY = 4
): boolean {
  if (!rect) return false;
  return (
    px >= rect.x - padX &&
    px <= rect.x + rect.w + padX &&
    py >= rect.y - padY &&
    py <= rect.y + rect.h + padY
  );
}

export function hitTestPositionControls(
  x: number,
  y: number,
  geometries: PositionChartGeometry[],
  plotX: number,
  plotWidth: number
): PositionHitResult | null {
  if (x < plotX || x > plotX + plotWidth || geometries.length === 0) return null;

  // 1. Highest priority: exact interactive handles & clear buttons (reverse order = top-most drawn)
  for (let i = geometries.length - 1; i >= 0; i--) {
    const g = geometries[i];
    if (pointInRect(x, y, g.slClearRect, 5, 5)) {
      return { kind: 'clearSl', positionId: g.positionId };
    }
    if (pointInRect(x, y, g.tpClearRect, 5, 5)) {
      return { kind: 'clearTp', positionId: g.positionId };
    }
    if (pointInRect(x, y, g.slHandleRect, 4, 5)) {
      return { kind: 'slHandle', positionId: g.positionId };
    }
    if (pointInRect(x, y, g.tpHandleRect, 4, 5)) {
      return { kind: 'tpHandle', positionId: g.positionId };
    }
  }

  // 2. Existing SL / TP pills and horizontal lines
  for (let i = geometries.length - 1; i >= 0; i--) {
    const g = geometries[i];
    if (pointInRect(x, y, g.slPillRect, 4, 5)) {
      return { kind: 'slLine', positionId: g.positionId, onPill: true };
    }
    if (pointInRect(x, y, g.tpPillRect, 4, 5)) {
      return { kind: 'tpLine', positionId: g.positionId, onPill: true };
    }
    if (pointInRect(x, y, g.entryPillRect, 4, 5)) {
      return { kind: 'entry', positionId: g.positionId, onPill: true };
    }
  }

  // 3. Horizontal line proximity (±11px vertical touch tolerance)
  const LINE_TOLERANCE = 11;
  for (let i = geometries.length - 1; i >= 0; i--) {
    const g = geometries[i];
    if (g.slLineY !== null && Math.abs(y - g.slLineY) <= LINE_TOLERANCE) {
      return { kind: 'slLine', positionId: g.positionId, onPill: false };
    }
    if (g.tpLineY !== null && Math.abs(y - g.tpLineY) <= LINE_TOLERANCE) {
      return { kind: 'tpLine', positionId: g.positionId, onPill: false };
    }
    if (Math.abs(y - g.entryLineY) <= LINE_TOLERANCE) {
      return { kind: 'entry', positionId: g.positionId, onPill: false };
    }
  }

  return null;
}

export function getInstrumentDecimals(symbol: MarketSymbol): number {
  return INSTRUMENT_SPREAD_CONFIG[symbol].decimals;
}
