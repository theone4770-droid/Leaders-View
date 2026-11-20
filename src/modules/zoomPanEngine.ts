import { Candle, TimeframeId, ViewportState } from '../types/chart';
import { getIntervalDurationMs } from './timeframeManager';

export const PRICE_AXIS_WIDTH = 84;
export const TIME_AXIS_HEIGHT = 28;
export const MIN_BAR_SPACING = 2.2;
export const MAX_BAR_SPACING = 90;
export const DEFAULT_BAR_SPACING = 10;

export interface PlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputedPriceRange {
  min: number;
  max: number;
}

export function getPlotRect(canvasWidth: number, canvasHeight: number): PlotRect {
  return {
    x: 0,
    y: 0,
    width: Math.max(40, canvasWidth - PRICE_AXIS_WIDTH),
    height: Math.max(40, canvasHeight - TIME_AXIS_HEIGHT),
  };
}

export function createDefaultViewport(candleCount: number): ViewportState {
  return {
    rightOffset: Math.max(candleCount + 8, 20),
    barSpacing: DEFAULT_BAR_SPACING,
    autoScaleY: true,
    priceMin: 0,
    priceMax: 100,
  };
}

function safeBarSpacing(viewport: ViewportState): number {
  return Number.isFinite(viewport.barSpacing) && viewport.barSpacing >= 0.5
    ? viewport.barSpacing
    : DEFAULT_BAR_SPACING;
}

/** Convert candle index (may be fractional or outside candle array) to X pixel */
export function indexToX(index: number, viewport: ViewportState, plot: PlotRect): number {
  return plot.x + plot.width - (viewport.rightOffset - index) * safeBarSpacing(viewport);
}

/** Convert X pixel to fractional candle index */
export function xToIndex(x: number, viewport: ViewportState, plot: PlotRect): number {
  return viewport.rightOffset - (plot.x + plot.width - x) / safeBarSpacing(viewport);
}

/** Binary search / exact interpolation from UTC timestamp to fractional candle index */
export function timeToIndex(
  timeMs: number,
  candles: Candle[],
  interval: TimeframeId
): number {
  const n = candles.length;
  const dur = getIntervalDurationMs(interval);
  if (n === 0) return 0;

  if (timeMs <= candles[0].time) {
    return (timeMs - candles[0].time) / dur;
  }
  if (timeMs >= candles[n - 1].time) {
    return n - 1 + (timeMs - candles[n - 1].time) / dur;
  }

  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = candles[mid].time;
    if (t === timeMs) return mid;
    if (t < timeMs) lo = mid + 1;
    else hi = mid - 1;
  }

  const leftIdx = Math.max(0, hi);
  const rightIdx = Math.min(n - 1, lo);
  const leftTime = candles[leftIdx].time;
  const rightTime = candles[rightIdx].time;
  if (rightTime === leftTime) return leftIdx;
  return leftIdx + (timeMs - leftTime) / (rightTime - leftTime);
}

/** Convert fractional candle index to UTC timestamp */
export function indexToTime(
  index: number,
  candles: Candle[],
  interval: TimeframeId
): number {
  const n = candles.length;
  const dur = getIntervalDurationMs(interval);
  if (n === 0) return Date.now();

  if (index <= 0) {
    return candles[0].time + index * dur;
  }
  if (index >= n - 1) {
    return candles[n - 1].time + (index - (n - 1)) * dur;
  }

  const lo = Math.floor(index);
  const hi = Math.min(n - 1, lo + 1);
  const frac = index - lo;
  return candles[lo].time + frac * (candles[hi].time - candles[lo].time);
}

export function timeToX(
  timeMs: number,
  candles: Candle[],
  interval: TimeframeId,
  viewport: ViewportState,
  plot: PlotRect
): number {
  return indexToX(timeToIndex(timeMs, candles, interval), viewport, plot);
}

export function xToTime(
  x: number,
  candles: Candle[],
  interval: TimeframeId,
  viewport: ViewportState,
  plot: PlotRect
): number {
  return indexToTime(xToIndex(x, viewport, plot), candles, interval);
}

/** Compute visible Y price range (auto-scaled to visible candles or manual when dragged) */
export function computePriceRange(
  candles: Candle[],
  viewport: ViewportState,
  plot: PlotRect
): ComputedPriceRange {
  if (!viewport.autoScaleY && viewport.priceMax > viewport.priceMin) {
    return { min: viewport.priceMin, max: viewport.priceMax };
  }

  if (candles.length === 0) {
    return { min: 0, max: 100 };
  }

  const firstVisible = Math.max(0, Math.floor(xToIndex(plot.x, viewport, plot)) - 1);
  const lastVisible = Math.min(
    candles.length - 1,
    Math.ceil(xToIndex(plot.x + plot.width, viewport, plot)) + 1
  );

  let min = Infinity;
  let max = -Infinity;

  for (let i = firstVisible; i <= lastVisible; i++) {
    const c = candles[i];
    if (!c) continue;
    if (c.low < min) min = c.low;
    if (c.high > max) max = c.high;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    const fallback = candles[candles.length - 1];
    min = fallback.low;
    max = fallback.high;
  }

  const span = Math.max(max - min, max * 0.0008, 0.05);
  const padTop = span * 0.12;
  const padBottom = span * 0.14;

  return {
    min: min - padBottom,
    max: max + padTop,
  };
}

export function priceToY(price: number, range: ComputedPriceRange, plot: PlotRect): number {
  const span = range.max - range.min;
  if (span <= 0) return plot.y + plot.height / 2;
  return plot.y + ((range.max - price) / span) * plot.height;
}

export function yToPrice(y: number, range: ComputedPriceRange, plot: PlotRect): number {
  const span = range.max - range.min;
  if (plot.height <= 0) return range.min;
  return range.max - ((y - plot.y) / plot.height) * span;
}

/** Smooth horizontal zoom strictly anchored to anchorX so the candle under cursor never jumps */
export function zoomHorizontalAt(
  viewport: ViewportState,
  factor: number,
  anchorX: number,
  plot: PlotRect
): ViewportState {
  const anchorIndex = xToIndex(anchorX, viewport, plot);
  const nextSpacing = Math.max(
    MIN_BAR_SPACING,
    Math.min(MAX_BAR_SPACING, viewport.barSpacing * factor)
  );
  const nextRightOffset = anchorIndex + (plot.x + plot.width - anchorX) / nextSpacing;
  return {
    ...viewport,
    barSpacing: nextSpacing,
    rightOffset: nextRightOffset,
  };
}

/** Smooth vertical zoom strictly anchored to anchorY (or center of price scale) */
export function zoomVerticalAt(
  viewport: ViewportState,
  candles: Candle[],
  factor: number,
  anchorY: number,
  plot: PlotRect
): ViewportState {
  const currentRange = computePriceRange(candles, viewport, plot);
  const anchorPrice = yToPrice(anchorY, currentRange, plot);
  const clampedFactor = Math.max(0.2, Math.min(5, factor));

  const topDiff = (currentRange.max - anchorPrice) / clampedFactor;
  const botDiff = (anchorPrice - currentRange.min) / clampedFactor;
  const nextMax = anchorPrice + topDiff;
  const nextMin = anchorPrice - botDiff;

  if (nextMax - nextMin <= 1e-6) return viewport;

  return {
    ...viewport,
    autoScaleY: false,
    priceMin: nextMin,
    priceMax: nextMax,
  };
}

/** Pan chart horizontally and (optionally) vertically */
export function panViewport(
  viewport: ViewportState,
  candles: Candle[],
  dx: number,
  dy: number,
  plot: PlotRect,
  allowVerticalPan: boolean
): ViewportState {
  const deltaBars = dx / viewport.barSpacing;
  let nextRightOffset = viewport.rightOffset - deltaBars;

  // Prevent scrolling completely off into infinite void
  const minOffset = 4;
  const maxOffset = Math.max(candles.length + plot.width / viewport.barSpacing - 4, 20);
  nextRightOffset = Math.max(minOffset, Math.min(maxOffset, nextRightOffset));

  let autoScaleY = viewport.autoScaleY;
  let priceMin = viewport.priceMin;
  let priceMax = viewport.priceMax;

  if (allowVerticalPan && Math.abs(dy) > 0.5) {
    const range = computePriceRange(candles, viewport, plot);
    const span = range.max - range.min;
    const priceDelta = (dy / plot.height) * span;
    autoScaleY = false;
    priceMin = range.min + priceDelta;
    priceMax = range.max + priceDelta;
  }

  return {
    ...viewport,
    rightOffset: nextRightOffset,
    autoScaleY,
    priceMin,
    priceMax,
  };
}

/** Fit a specific number of latest candles neatly into view */
export function fitCandlesToRange(
  candles: Candle[],
  startTimeMs: number,
  plot: PlotRect
): ViewportState {
  if (candles.length === 0) return createDefaultViewport(0);
  let startIndex = 0;
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].time >= startTimeMs) {
      startIndex = i;
      break;
    }
  }
  const visibleBars = Math.max(12, candles.length - startIndex + 6);
  const barSpacing = Math.max(
    MIN_BAR_SPACING,
    Math.min(MAX_BAR_SPACING, plot.width / visibleBars)
  );
  return {
    rightOffset: candles.length + 5,
    barSpacing,
    autoScaleY: true,
    priceMin: 0,
    priceMax: 100,
  };
}
