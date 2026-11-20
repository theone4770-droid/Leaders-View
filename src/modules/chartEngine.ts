import {
  Candle,
  MarketSymbol,
  PriceAlert,
  ReplayState,
  ThemeMode,
  TimeframeId,
  ViewportState,
} from '../types/chart';
import { getChartPalette } from './themeManager';
import { formatAxisTime, formatPrice, getCandleCountdownText, MARKETS } from './timeframeManager';
import {
  ComputedPriceRange,
  computePriceRange,
  getPlotRect,
  indexToTime,
  indexToX,
  PlotRect,
  PRICE_AXIS_WIDTH,
  priceToY,
  TIME_AXIS_HEIGHT,
  xToIndex,
} from './zoomPanEngine';

export interface RenderBaseChartParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  candles: Candle[];
  viewport: ViewportState;
  market: MarketSymbol;
  interval: TimeframeId;
  theme: ThemeMode;
  alerts: PriceAlert[];
  replay: ReplayState;
  replayHoverIndex: number | null;
  liveCandleOverride?: { close: number; high: number; low: number } | null;
  priceRangeOverride?: ComputedPriceRange | null;
}

export interface BaseRenderMetrics {
  plot: PlotRect;
  priceRange: ComputedPriceRange;
}

function computeNiceStep(range: number, targetTicks: number): number {
  if (range <= 0 || !Number.isFinite(range)) return 1;
  const rough = range / Math.max(2, targetTicks);
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  if (norm < 1.5) return 1 * mag;
  if (norm < 3) return 2 * mag;
  if (norm < 7) return 5 * mag;
  return 10 * mag;
}

function safeRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rw = Math.max(0, w);
  const rh = Math.max(0, h);
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, rw, rh, r);
  } else {
    ctx.rect(x, y, rw, rh);
  }
}

export function renderBaseChart(params: RenderBaseChartParams): BaseRenderMetrics {
  const {
    ctx,
    width,
    height,
    candles,
    viewport,
    market,
    interval,
    theme,
    alerts,
    replay,
    replayHoverIndex,
    liveCandleOverride,
    priceRangeOverride,
  } = params;

  const palette = getChartPalette(theme);
  const plot = getPlotRect(width, height);
  const priceRange = priceRangeOverride ?? computePriceRange(candles, viewport, plot);
  const decimals = MARKETS[market].decimals;

  // 1. Background fill
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);

  // 2. Plot area clipping & grid
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.width, plot.height);
  ctx.clip();

  // Horizontal price grid lines
  const yTickCount = Math.max(3, Math.floor(plot.height / 58));
  const priceStep = computeNiceStep(priceRange.max - priceRange.min, yTickCount);
  const safePriceStep = Number.isFinite(priceStep) && priceStep > 0 ? priceStep : 1;
  const firstPriceTick = Math.ceil(priceRange.min / safePriceStep) * safePriceStep;

  ctx.strokeStyle = palette.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let p = firstPriceTick, iter = 0; p <= priceRange.max && iter < 240; p += safePriceStep, iter++) {
    const y = Math.round(priceToY(p, priceRange, plot)) + 0.5;
    if (y >= plot.y && y <= plot.y + plot.height) {
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
    }
  }
  ctx.stroke();

  // Vertical time grid lines
  const minLabelPx = 92;
  const safeSpacing = Number.isFinite(viewport.barSpacing) && viewport.barSpacing >= 0.5 ? viewport.barSpacing : 10;
  const barStep = Math.max(1, Math.ceil(minLabelPx / safeSpacing));
  const startIdx = Math.floor(xToIndex(plot.x, viewport, plot));
  const endIdx = Math.ceil(xToIndex(plot.x + plot.width, viewport, plot));
  const firstTimeIdx = Math.floor(startIdx / barStep) * barStep;

  ctx.beginPath();
  for (let i = firstTimeIdx, iter = 0; i <= endIdx && iter < 240; i += barStep, iter++) {
    const x = Math.round(indexToX(i, viewport, plot)) + 0.5;
    if (x >= plot.x && x <= plot.x + plot.width) {
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.height);
    }
  }
  ctx.stroke();

  // 3. Candlesticks (volume histogram removed per clean price-action view)
  if (candles.length > 0) {
    const visStart = Math.max(0, startIdx - 1);
    const visEnd = Math.min(candles.length - 1, endIdx + 1);

    const bodyWidth = Math.max(1.5, Math.min(viewport.barSpacing * 0.72, 42));
    const halfBody = bodyWidth / 2;

    const wickWidth = viewport.barSpacing > 14 ? 1.5 : 1;
    const wickOffset = wickWidth === 1 ? 0.5 : 0;
    const lastIdx = candles.length - 1;
    const staticEnd = liveCandleOverride && visEnd === lastIdx ? visEnd - 1 : visEnd;

    // 1. Bullish wicks
    ctx.strokeStyle = palette.candleUpWick;
    ctx.lineWidth = wickWidth;
    ctx.beginPath();
    for (let i = visStart; i <= staticEnd; i++) {
      const c = candles[i];
      if (c.close < c.open) continue;
      const crispX = Math.round(indexToX(i, viewport, plot)) + wickOffset;
      ctx.moveTo(crispX, priceToY(c.high, priceRange, plot));
      ctx.lineTo(crispX, priceToY(c.low, priceRange, plot));
    }
    if (liveCandleOverride && visEnd === lastIdx && visStart <= lastIdx) {
      const c = candles[lastIdx];
      if (liveCandleOverride.close >= c.open) {
        const crispX = Math.round(indexToX(lastIdx, viewport, plot)) + wickOffset;
        ctx.moveTo(crispX, priceToY(liveCandleOverride.high, priceRange, plot));
        ctx.lineTo(crispX, priceToY(liveCandleOverride.low, priceRange, plot));
      }
    }
    ctx.stroke();

    // 2. Bearish wicks
    ctx.strokeStyle = palette.candleDownWick;
    ctx.beginPath();
    for (let i = visStart; i <= staticEnd; i++) {
      const c = candles[i];
      if (c.close >= c.open) continue;
      const crispX = Math.round(indexToX(i, viewport, plot)) + wickOffset;
      ctx.moveTo(crispX, priceToY(c.high, priceRange, plot));
      ctx.lineTo(crispX, priceToY(c.low, priceRange, plot));
    }
    if (liveCandleOverride && visEnd === lastIdx && visStart <= lastIdx) {
      const c = candles[lastIdx];
      if (liveCandleOverride.close < c.open) {
        const crispX = Math.round(indexToX(lastIdx, viewport, plot)) + wickOffset;
        ctx.moveTo(crispX, priceToY(liveCandleOverride.high, priceRange, plot));
        ctx.lineTo(crispX, priceToY(liveCandleOverride.low, priceRange, plot));
      }
    }
    ctx.stroke();

    // 3. Bullish bodies
    ctx.fillStyle = palette.candleUp;
    for (let i = visStart; i <= staticEnd; i++) {
      const c = candles[i];
      if (c.close < c.open) continue;
      const cx = indexToX(i, viewport, plot);
      const yOpen = priceToY(c.open, priceRange, plot);
      const yClose = priceToY(c.close, priceRange, plot);
      ctx.fillRect(cx - halfBody, Math.min(yOpen, yClose), bodyWidth, Math.max(1.2, Math.abs(yClose - yOpen)));
    }
    if (liveCandleOverride && visEnd === lastIdx && visStart <= lastIdx) {
      const c = candles[lastIdx];
      if (liveCandleOverride.close >= c.open) {
        const cx = indexToX(lastIdx, viewport, plot);
        const yOpen = priceToY(c.open, priceRange, plot);
        const yClose = priceToY(liveCandleOverride.close, priceRange, plot);
        ctx.fillRect(cx - halfBody, Math.min(yOpen, yClose), bodyWidth, Math.max(1.2, Math.abs(yClose - yOpen)));
      }
    }

    // 4. Bearish bodies
    ctx.fillStyle = palette.candleDown;
    for (let i = visStart; i <= staticEnd; i++) {
      const c = candles[i];
      if (c.close >= c.open) continue;
      const cx = indexToX(i, viewport, plot);
      const yOpen = priceToY(c.open, priceRange, plot);
      const yClose = priceToY(c.close, priceRange, plot);
      ctx.fillRect(cx - halfBody, Math.min(yOpen, yClose), bodyWidth, Math.max(1.2, Math.abs(yClose - yOpen)));
    }
    if (liveCandleOverride && visEnd === lastIdx && visStart <= lastIdx) {
      const c = candles[lastIdx];
      if (liveCandleOverride.close < c.open) {
        const cx = indexToX(lastIdx, viewport, plot);
        const yOpen = priceToY(c.open, priceRange, plot);
        const yClose = priceToY(liveCandleOverride.close, priceRange, plot);
        ctx.fillRect(cx - halfBody, Math.min(yOpen, yClose), bodyWidth, Math.max(1.2, Math.abs(yClose - yOpen)));
      }
    }

    // 4. Active price alert lines
    if (alerts.length > 0) {
      for (let ai = 0; ai < alerts.length; ai++) {
        const alert = alerts[ai];
        if (alert.market !== market || !alert.active || alert.triggered) continue;
        const y = Math.round(priceToY(alert.price, priceRange, plot)) + 0.5;
        if (y < plot.y - 2 || y > plot.y + plot.height + 2) continue;
        ctx.save();
        ctx.strokeStyle = palette.alertLine;
        ctx.lineWidth = 1.25;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(plot.x, y);
        ctx.lineTo(plot.x + plot.width, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Alert badge inside plot on right edge
        const tag = `ALERT ${formatPrice(alert.price, decimals)}${alert.note ? ` · ${alert.note.slice(0, 18)}` : ''}`;
        ctx.font = '600 10px "JetBrains Mono", monospace';
        const tw = ctx.measureText(tag).width + 12;
        const bx = plot.x + plot.width - tw - 8;
        ctx.fillStyle = theme === 'dark' ? 'rgba(20, 17, 10, 0.92)' : 'rgba(255, 250, 236, 0.95)';
        ctx.strokeStyle = palette.gold;
        ctx.lineWidth = 1;
        ctx.beginPath();
        safeRoundRect(ctx, bx, y - 10, tw, 20, 3);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = palette.goldBright;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(tag, bx + 6, y);
        ctx.restore();
      }
    }

    // 5. Current price horizontal dashed line
    const lastCandle = candles[candles.length - 1];
    const effectiveLastClose = liveCandleOverride ? liveCandleOverride.close : lastCandle.close;
    const lastY = Math.round(priceToY(effectiveLastClose, priceRange, plot)) + 0.5;
    const isLastUp = effectiveLastClose >= lastCandle.open;
    const priceLineColor = isLastUp ? palette.currentPriceLineUp : palette.currentPriceLineDown;

    if (lastY >= plot.y && lastY <= plot.y + plot.height) {
      ctx.save();
      ctx.strokeStyle = priceLineColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(plot.x, lastY);
      ctx.lineTo(plot.x + plot.width, lastY);
      ctx.stroke();
      ctx.restore();
    }

    // 6. Bar Replay cut-line (when selecting replay point)
    if (replay.mode === 'SELECTING' && replayHoverIndex !== null) {
      const clampedIdx = Math.max(1, Math.min(candles.length - 1, Math.round(replayHoverIndex)));
      const rx = Math.round(indexToX(clampedIdx, viewport, plot)) + 0.5;
      ctx.save();
      // Dim future bars after hover cut-line
      ctx.fillStyle = theme === 'dark' ? 'rgba(8, 8, 8, 0.58)' : 'rgba(250, 248, 243, 0.62)';
      ctx.fillRect(rx, plot.y, plot.x + plot.width - rx, plot.height);

      // Crisp gold vertical cut line
      ctx.strokeStyle = palette.replayLine;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(rx, plot.y);
      ctx.lineTo(rx, plot.y + plot.height);
      ctx.stroke();
      ctx.setLineDash([]);

      // Top badge
      const label = 'SELECT REPLAY START';
      ctx.font = '700 10px "Plus Jakarta Sans", sans-serif';
      const lw = ctx.measureText(label).width + 16;
      const lx = Math.max(plot.x + 6, Math.min(plot.x + plot.width - lw - 6, rx - lw / 2));
      ctx.fillStyle = palette.gold;
      ctx.beginPath();
      safeRoundRect(ctx, lx, plot.y + 10, lw, 22, 4);
      ctx.fill();
      ctx.fillStyle = '#080808';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + lw / 2, plot.y + 21);
      ctx.restore();
    }
  }

  ctx.restore();

  // 7. Right Price Scale Axis
  const axisX = plot.x + plot.width;
  ctx.fillStyle = palette.axisBg;
  ctx.fillRect(axisX, 0, PRICE_AXIS_WIDTH, height);

  // Axis separator borders
  ctx.strokeStyle = palette.axisBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(axisX + 0.5, 0);
  ctx.lineTo(axisX + 0.5, height);
  ctx.moveTo(0, plot.height + 0.5);
  ctx.lineTo(width, plot.height + 0.5);
  ctx.stroke();

  // Price labels
  ctx.fillStyle = palette.axisText;
  ctx.font = '500 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let p = firstPriceTick, iter = 0; p <= priceRange.max && iter < 240; p += safePriceStep, iter++) {
    const y = priceToY(p, priceRange, plot);
    if (y > plot.y + 10 && y < plot.y + plot.height - 10) {
      ctx.fillText(formatPrice(p, decimals), axisX + 8, y);
    }
  }

  // Current price + live candle countdown timer badge on right price axis (TradingView style)
  if (candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    const effectiveLastClose = liveCandleOverride ? liveCandleOverride.close : lastCandle.close;
    const showTimer = replay.mode === 'OFF';
    const rawY = priceToY(effectiveLastClose, priceRange, plot);
    const minBadgeY = plot.y + 11;
    const maxBadgeY = Math.max(minBadgeY, plot.y + plot.height - (showTimer ? 26 : 11));
    const lastY = Math.max(minBadgeY, Math.min(maxBadgeY, rawY));
    const isLastUp = effectiveLastClose >= lastCandle.open;
    const badgeColor = isLastUp ? palette.currentPriceLineUp : palette.currentPriceLineDown;

    // Price row
    ctx.fillStyle = badgeColor;
    ctx.fillRect(axisX + 1, lastY - 10, PRICE_AXIS_WIDTH - 2, 19);
    ctx.fillStyle = palette.currentPriceText;
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatPrice(effectiveLastClose, decimals), axisX + 7, lastY - 0.5);

    // Connected live candle countdown timer row directly below price
    if (showTimer) {
      const countdown = getCandleCountdownText(Date.now(), interval);
      ctx.fillStyle = badgeColor;
      ctx.fillRect(axisX + 1, lastY + 9, PRICE_AXIS_WIDTH - 2, 16);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.fillRect(axisX + 1, lastY + 9, PRICE_AXIS_WIDTH - 2, 16);
      ctx.fillStyle = palette.currentPriceText;
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(countdown, axisX + 7, lastY + 17.5);
    }
  }

  // 8. Bottom Time Scale Axis
  ctx.fillStyle = palette.axisBg;
  ctx.fillRect(0, plot.height + 1, plot.width, TIME_AXIS_HEIGHT - 1);

  ctx.fillStyle = palette.axisText;
  ctx.font = '500 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = firstTimeIdx, iter = 0; i <= endIdx && iter < 240; i += barStep, iter++) {
    const x = indexToX(i, viewport, plot);
    if (x > plot.x + 28 && x < plot.x + plot.width - 28) {
      const t = indexToTime(i, candles, interval);
      ctx.fillText(formatAxisTime(t, interval), x, plot.height + TIME_AXIS_HEIGHT / 2 + 1);
    }
  }

  // Corner gold mark
  ctx.fillStyle = palette.gold;
  ctx.font = '700 9px "Cinzel", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('LV', axisX + PRICE_AXIS_WIDTH / 2, plot.height + TIME_AXIS_HEIGHT / 2 + 1);

  return { plot, priceRange };
}
