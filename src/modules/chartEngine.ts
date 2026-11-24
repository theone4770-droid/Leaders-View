import {
  Candle,
  MarketSymbol,
  PriceAlert,
  ReplayState,
  ThemeMode,
  TimeframeId,
  ViewportState,
} from '../types/chart';
import {
  MarketBidAskQuote,
  OpenPosition,
  PendingOrder,
  PendingOrderDraft,
} from '../types/trading';
import {
  computeBidAskQuote,
  computeUnrealizedPnL,
} from './spreadEngine';
import {
  computeProjectedPendingSlTpPnL,
  computeProjectedSlTpPnL,
  formatSignedUSD,
  isPendingSlTpValid,
  isSlTpPriceValidForPosition,
  PendingDraftDragTarget,
  PendingDraftGeometry,
  PendingOrderChartGeometry,
  PendingOrderDragPreview,
  PositionChartGeometry,
  PositionDragPreview,
  PositionLayoutRect,
} from './chartPositionControls';
import { formatOrderTypeLabel, getDirectionForPendingType, validatePendingPrices } from './tradingEngine';
import { getChartPalette } from './themeManager';
import { formatAxisTime, formatPrice, getCandleCountdownText, isMarketOpen, MARKETS } from './timeframeManager';
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
  quote?: MarketBidAskQuote | null;
  openPositions?: OpenPosition[];
  pendingOrders?: PendingOrder[];
  selectedPositionId?: string | null;
  positionDragPreview?: PositionDragPreview | null;
  selectedPendingOrderId?: string | null;
  pendingOrderDragPreview?: PendingOrderDragPreview | null;
  pendingOrderDraft?: PendingOrderDraft | null;
  pendingDraftDragTarget?: PendingDraftDragTarget | null;
  isFullScreen?: boolean;
}

export interface BaseRenderMetrics {
  plot: PlotRect;
  priceRange: ComputedPriceRange;
  positionGeometries: PositionChartGeometry[];
  pendingOrderGeometries: PendingOrderChartGeometry[];
  pendingDraftGeometry: PendingDraftGeometry | null;
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
    quote = null,
    openPositions = [],
    pendingOrders = [],
    selectedPositionId = null,
    positionDragPreview = null,
    selectedPendingOrderId = null,
    pendingOrderDragPreview = null,
    pendingOrderDraft = null,
    pendingDraftDragTarget = null,
    isFullScreen = false,
  } = params;

  const palette = getChartPalette(theme);
  const plot = getPlotRect(width, height);
  const priceRange = priceRangeOverride ?? computePriceRange(candles, viewport, plot);
  const decimals = MARKETS[market].decimals;
  const positionGeometries: PositionChartGeometry[] = [];
  const pendingOrderGeometries: PendingOrderChartGeometry[] = [];
  let pendingDraftGeometry: PendingDraftGeometry | null = null;

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

    const rawBodyWidth = Math.max(1, Math.min(viewport.barSpacing * 0.72, 42));
    const maxSafeBody = Math.max(1, Math.floor(viewport.barSpacing - 0.6));
    const wideWick = viewport.barSpacing > 14;
    const wickWidth = wideWick ? 2 : 1;
    let bodyWidth: number;
    if (wideWick) {
      bodyWidth = Math.max(4, Math.min(42, Math.floor(rawBodyWidth / 2) * 2));
    } else if (rawBodyWidth < 2 || maxSafeBody < 3) {
      bodyWidth = 1;
    } else {
      const capped = Math.min(41, Math.round(rawBodyWidth), maxSafeBody);
      bodyWidth = capped % 2 === 0 ? Math.max(1, capped - 1) : capped;
    }
    const halfBody = bodyWidth / 2;
    const wickOffset = wideWick ? 0 : 0.5;
    const getCrispCenter = (idx: number) => Math.round(indexToX(idx, viewport, plot)) + wickOffset;

    const lastIdx = candles.length - 1;
    const staticEnd = liveCandleOverride && visEnd === lastIdx ? visEnd - 1 : visEnd;

    // 1. Bullish wicks
    ctx.strokeStyle = palette.candleUpWick;
    ctx.lineWidth = wickWidth;
    ctx.beginPath();
    for (let i = visStart; i <= staticEnd; i++) {
      const c = candles[i];
      if (c.close < c.open) continue;
      const crispX = getCrispCenter(i);
      ctx.moveTo(crispX, priceToY(c.high, priceRange, plot));
      ctx.lineTo(crispX, priceToY(c.low, priceRange, plot));
    }
    if (liveCandleOverride && visEnd === lastIdx && visStart <= lastIdx) {
      const c = candles[lastIdx];
      if (liveCandleOverride.close >= c.open) {
        const crispX = getCrispCenter(lastIdx);
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
      const crispX = getCrispCenter(i);
      ctx.moveTo(crispX, priceToY(c.high, priceRange, plot));
      ctx.lineTo(crispX, priceToY(c.low, priceRange, plot));
    }
    if (liveCandleOverride && visEnd === lastIdx && visStart <= lastIdx) {
      const c = candles[lastIdx];
      if (liveCandleOverride.close < c.open) {
        const crispX = getCrispCenter(lastIdx);
        ctx.moveTo(crispX, priceToY(liveCandleOverride.high, priceRange, plot));
        ctx.lineTo(crispX, priceToY(liveCandleOverride.low, priceRange, plot));
      }
    }
    ctx.stroke();

    const drawCandleBody = (idx: number, openPrice: number, closePrice: number) => {
      const cx = getCrispCenter(idx);
      const yOpen = priceToY(openPrice, priceRange, plot);
      const yClose = priceToY(closePrice, priceRange, plot);
      const rawTop = Math.min(yOpen, yClose);
      const rawH = Math.abs(yClose - yOpen);
      const minBodyH = 1.5;
      const bodyH = Math.max(minBodyH, rawH);
      const bodyTop = rawH < minBodyH ? rawTop - (minBodyH - rawH) / 2 : rawTop;
      ctx.fillRect(cx - halfBody, bodyTop, bodyWidth, bodyH);
    };

    // 3. Bullish bodies
    ctx.fillStyle = palette.candleUp;
    for (let i = visStart; i <= staticEnd; i++) {
      const c = candles[i];
      if (c.close < c.open) continue;
      drawCandleBody(i, c.open, c.close);
    }
    if (liveCandleOverride && visEnd === lastIdx && visStart <= lastIdx) {
      const c = candles[lastIdx];
      if (liveCandleOverride.close >= c.open) {
        drawCandleBody(lastIdx, c.open, liveCandleOverride.close);
      }
    }

    // 4. Bearish bodies
    ctx.fillStyle = palette.candleDown;
    for (let i = visStart; i <= staticEnd; i++) {
      const c = candles[i];
      if (c.close >= c.open) continue;
      drawCandleBody(i, c.open, c.close);
    }
    if (liveCandleOverride && visEnd === lastIdx && visStart <= lastIdx) {
      const c = candles[lastIdx];
      if (liveCandleOverride.close < c.open) {
        drawCandleBody(lastIdx, c.open, liveCandleOverride.close);
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

    // 5a. MetaTrader-Style Dual BUY (ASK) and SELL (BID) Price Lines (drawn beneath interactive position pills)
    const lastCandle = candles[candles.length - 1];
    const effectiveLastClose = liveCandleOverride ? liveCandleOverride.close : lastCandle.close;
    const isLastUp = effectiveLastClose >= lastCandle.open;
    const priceLineColor = isLastUp ? palette.currentPriceLineUp : palette.currentPriceLineDown;

    if (quote && replay.mode === 'OFF') {
      const rawBidY = priceToY(quote.bid, priceRange, plot);
      const rawAskY = priceToY(quote.ask, priceRange, plot);
      const yBid = Math.round(rawBidY) + 0.5;
      // Lock spread pixel delta symmetrically so Bid & Ask glide in smooth lockstep without +/-1px jitter
      const spreadPx = quote.spread > 0 ? Math.max(2, Math.round(rawBidY - rawAskY)) : 0;
      const yAsk = yBid - spreadPx;

      const askColor = '#EF4444'; // Upper spread line: Red
      const bidColor = '#22C55E'; // Lower spread line: Green

      if (yBid >= plot.y - 2 && yBid <= plot.y + plot.height + 2) {
        ctx.save();
        ctx.strokeStyle = bidColor;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(plot.x, yBid);
        ctx.lineTo(plot.x + plot.width, yBid);
        ctx.stroke();
        ctx.restore();
      }

      if (yAsk >= plot.y - 2 && yAsk <= plot.y + plot.height + 2) {
        ctx.save();
        ctx.strokeStyle = askColor;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(plot.x, yAsk);
        ctx.lineTo(plot.x + plot.width, yAsk);
        ctx.stroke();
        ctx.restore();
      }

      const spreadY = isFullScreen ? plot.y + 46 : plot.y + 10;
      const spreadText = `SPREAD ${formatPrice(quote.spread, decimals)} · SIM STD`;
      ctx.save();
      ctx.font = '600 9.5px "JetBrains Mono", monospace';
      const sw = ctx.measureText(spreadText).width + 14;
      const sx = plot.x + plot.width - sw - 8;
      if (sx > plot.x + 150) {
        ctx.fillStyle = theme === 'dark' ? '#0C0C10' : '#FFFFFF';
        ctx.strokeStyle = theme === 'dark' ? 'rgba(212, 175, 55, 0.45)' : 'rgba(20, 19, 17, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        safeRoundRect(ctx, sx, spreadY, sw, 20, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = theme === 'dark' ? '#D4AF37' : '#141311';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(spreadText, sx + 7, spreadY + 10);
      }
      ctx.restore();
    } else {
      const lastY = Math.round(priceToY(effectiveLastClose, priceRange, plot)) + 0.5;
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
    }

    // 5b. Open Positions (Entry with live USD PnL, interactive SL/TP drag handles) & Pending Orders
    if (replay.mode === 'OFF') {
      const drawOrderTagLine = (
        priceVal: number | null,
        color: string,
        labelText: string,
        dash: number[],
        options?: { isHighlighted?: boolean; showClearX?: boolean; pillAlign?: 'left' | 'right' }
      ): { lineY: number; pillRect: PositionLayoutRect; clearRect: PositionLayoutRect | null } | null => {
        if (priceVal === null || !Number.isFinite(priceVal)) return null;
        const py = Math.round(priceToY(priceVal, priceRange, plot)) + 0.5;
        if (py < plot.y - 2 || py > plot.y + plot.height + 2) return null;
        const highlighted = Boolean(options?.isHighlighted);
        const showClearX = Boolean(options?.showClearX);

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = highlighted ? 1.5 : 1;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(plot.x, py);
        ctx.lineTo(plot.x + plot.width, py);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = '600 9.5px "JetBrains Mono", monospace';
        const textW = ctx.measureText(labelText).width;
        const clearBoxW = showClearX ? 18 : 0;
        const tw = textW + 12 + clearBoxW;
        const bx =
          options?.pillAlign === 'right'
            ? Math.max(plot.x + 8, plot.x + plot.width - tw - 8)
            : plot.x + 8;
        const pillH = 19;
        const pillY = py - pillH / 2;

        ctx.fillStyle = theme === 'dark' ? '#0C0C10' : '#FFFFFF';
        ctx.strokeStyle = highlighted ? '#D4AF37' : color;
        ctx.lineWidth = highlighted ? 1.4 : 1;
        ctx.beginPath();
        safeRoundRect(ctx, bx, pillY, tw, pillH, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, bx + 6, py);

        let clearRect: PositionLayoutRect | null = null;
        if (showClearX) {
          const cx = bx + tw - clearBoxW;
          ctx.beginPath();
          ctx.moveTo(cx, pillY + 3);
          ctx.lineTo(cx, pillY + pillH - 3);
          ctx.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = theme === 'dark' ? '#E5E7EB' : '#374151';
          ctx.textAlign = 'center';
          ctx.font = '700 10px "JetBrains Mono", monospace';
          ctx.fillText('×', cx + clearBoxW / 2, py + 0.5);
          clearRect = { x: cx, y: pillY, w: clearBoxW, h: pillH };
        }

        ctx.restore();
        return {
          lineY: py,
          pillRect: { x: bx, y: pillY, w: tw - clearBoxW, h: pillH },
          clearRect,
        };
      };

      const refSpot =
        candles.length > 0
          ? liveCandleOverride
            ? liveCandleOverride.close
            : candles[candles.length - 1].close
          : undefined;
      const effectiveQuoteForPnL =
        quote ?? computeBidAskQuote(market, refSpot, 'LIVE');

      for (let i = 0; i < openPositions.length; i++) {
        const pos = openPositions[i];
        if (pos.symbol !== market) continue;
        const isSelected = selectedPositionId === pos.id;
        const entryColor = pos.direction === 'BUY' ? '#22C55E' : '#EF4444';
        const { pnl } = computeUnrealizedPnL(pos, effectiveQuoteForPnL);
        const pnlColor =
          pnl >= 0
            ? theme === 'dark'
              ? '#22C55E'
              : '#15803D'
            : theme === 'dark'
              ? '#F43F5E'
              : '#DC2626';

        const entryY = Math.round(priceToY(pos.entryPrice, priceRange, plot)) + 0.5;
        const clampedEntryY = Math.max(plot.y + 12, Math.min(plot.y + plot.height - 12, entryY));
        const inPlotRange = entryY >= plot.y - 2 && entryY <= plot.y + plot.height + 2;

        ctx.save();
        if (inPlotRange) {
          ctx.strokeStyle = entryColor;
          ctx.lineWidth = isSelected ? 1.6 : 1.1;
          ctx.setLineDash(isSelected ? [5, 2] : [2, 2]);
          ctx.beginPath();
          ctx.moveTo(plot.x, entryY);
          ctx.lineTo(plot.x + plot.width, entryY);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        const dirText = `${pos.direction} ${pos.lotSize.toFixed(2)}`;
        const pnlText = formatSignedUSD(pnl);
        ctx.font = '700 9.5px "JetBrains Mono", monospace';
        const dirW = ctx.measureText(dirText).width;
        const pnlW = ctx.measureText(pnlText).width;
        const pillH = 20;
        const pillY = (inPlotRange ? entryY : clampedEntryY) - pillH / 2;
        const bx = plot.x + 8;
        const pillW = 7 + dirW + 10 + pnlW + 7;

        ctx.fillStyle = theme === 'dark' ? '#0B0B10' : '#FFFFFF';
        ctx.strokeStyle = isSelected ? '#D4AF37' : entryColor;
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.beginPath();
        safeRoundRect(ctx, bx, pillY, pillW, pillH, 4);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = entryColor;
        ctx.fillText(dirText, bx + 7, pillY + pillH / 2);

        const divX = bx + 7 + dirW + 5;
        ctx.beginPath();
        ctx.moveTo(divX, pillY + 4);
        ctx.lineTo(divX, pillY + pillH - 4);
        ctx.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = pnlColor;
        ctx.fillText(pnlText, divX + 5, pillY + pillH / 2);

        let slHandleRect: PositionLayoutRect | null = null;
        let tpHandleRect: PositionLayoutRect | null = null;

        if (isSelected) {
          const showSlHandle = pos.sl === null;
          const showTpHandle = pos.tp === null;
          const handleW = 42;
          let nextHandleX = bx + pillW + 5;

          if (showSlHandle && nextHandleX + handleW < plot.x + plot.width - 4) {
            ctx.fillStyle = theme === 'dark' ? '#2A1115' : '#FEE2E2';
            ctx.strokeStyle = '#E54855';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            safeRoundRect(ctx, nextHandleX, pillY, handleW, pillH, 4);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = theme === 'dark' ? '#FCA5A5' : '#DC2626';
            ctx.font = '700 9.5px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('SL ↕', nextHandleX + handleW / 2, pillY + pillH / 2);
            slHandleRect = { x: nextHandleX, y: pillY, w: handleW, h: pillH };
            nextHandleX += handleW + 4;
          }

          if (showTpHandle && nextHandleX + handleW < plot.x + plot.width - 4) {
            ctx.fillStyle = theme === 'dark' ? '#0D251C' : '#DCFCE7';
            ctx.strokeStyle = '#19B87D';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            safeRoundRect(ctx, nextHandleX, pillY, handleW, pillH, 4);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = theme === 'dark' ? '#6EE7B7' : '#059669';
            ctx.font = '700 9.5px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('TP ↕', nextHandleX + handleW / 2, pillY + pillH / 2);
            tpHandleRect = { x: nextHandleX, y: pillY, w: handleW, h: pillH };
          }
        }
        ctx.restore();

        const isDraggingThisSl =
          positionDragPreview?.positionId === pos.id && positionDragPreview.target === 'SL';
        const isDraggingThisTp =
          positionDragPreview?.positionId === pos.id && positionDragPreview.target === 'TP';

        const activeSlPrice = isDraggingThisSl ? positionDragPreview.price : pos.sl;
        const activeTpPrice = isDraggingThisTp ? positionDragPreview.price : pos.tp;

        let slLineInfo: ReturnType<typeof drawOrderTagLine> = null;
        if (activeSlPrice !== null) {
          const slValidity = isSlTpPriceValidForPosition(
            pos,
            'SL',
            activeSlPrice,
            effectiveQuoteForPnL
          );
          const projSlPnl = computeProjectedSlTpPnL(pos, activeSlPrice);
          const slLabel =
            isDraggingThisSl && !slValidity.valid
              ? `SL ${formatPrice(activeSlPrice, decimals)} · ${slValidity.reason}`
              : `SL ${formatPrice(activeSlPrice, decimals)} · ${formatSignedUSD(projSlPnl)}`;
          slLineInfo = drawOrderTagLine(
            activeSlPrice,
            isDraggingThisSl && !slValidity.valid ? '#F59E0B' : '#E54855',
            slLabel,
            isDraggingThisSl ? [3, 2] : [5, 3],
            {
              isHighlighted: isDraggingThisSl || isSelected,
              showClearX: isSelected && !isDraggingThisSl && pos.sl !== null,
            }
          );
        }

        let tpLineInfo: ReturnType<typeof drawOrderTagLine> = null;
        if (activeTpPrice !== null) {
          const tpValidity = isSlTpPriceValidForPosition(
            pos,
            'TP',
            activeTpPrice,
            effectiveQuoteForPnL
          );
          const projTpPnl = computeProjectedSlTpPnL(pos, activeTpPrice);
          const tpLabel =
            isDraggingThisTp && !tpValidity.valid
              ? `TP ${formatPrice(activeTpPrice, decimals)} · ${tpValidity.reason}`
              : `TP ${formatPrice(activeTpPrice, decimals)} · ${formatSignedUSD(projTpPnl)}`;
          tpLineInfo = drawOrderTagLine(
            activeTpPrice,
            isDraggingThisTp && !tpValidity.valid ? '#F59E0B' : '#19B87D',
            tpLabel,
            isDraggingThisTp ? [3, 2] : [5, 3],
            {
              isHighlighted: isDraggingThisTp || isSelected,
              showClearX: isSelected && !isDraggingThisTp && pos.tp !== null,
            }
          );
        }

        positionGeometries.push({
          positionId: pos.id,
          entryLineY: entryY,
          entryPillRect: { x: bx, y: pillY, w: pillW, h: pillH },
          slHandleRect,
          tpHandleRect,
          slLineY: slLineInfo?.lineY ?? null,
          slPillRect: slLineInfo?.pillRect ?? null,
          slClearRect: slLineInfo?.clearRect ?? null,
          tpLineY: tpLineInfo?.lineY ?? null,
          tpPillRect: tpLineInfo?.pillRect ?? null,
          tpClearRect: tpLineInfo?.clearRect ?? null,
        });
      }

      for (let i = 0; i < pendingOrders.length; i++) {
        const ord = pendingOrders[i];
        if (ord.symbol !== market) continue;
        const isSelected = selectedPendingOrderId === ord.id;
        const isStopLimit =
          ord.orderType === 'BUY_STOP_LIMIT' || ord.orderType === 'SELL_STOP_LIMIT';

        const isDraggingEntry =
          pendingOrderDragPreview?.orderId === ord.id && pendingOrderDragPreview.target === 'ENTRY';
        const isDraggingLimit =
          pendingOrderDragPreview?.orderId === ord.id && pendingOrderDragPreview.target === 'LIMIT';
        const isDraggingSl =
          pendingOrderDragPreview?.orderId === ord.id && pendingOrderDragPreview.target === 'SL';
        const isDraggingTp =
          pendingOrderDragPreview?.orderId === ord.id && pendingOrderDragPreview.target === 'TP';

        const activeEntryPrice = isDraggingEntry ? pendingOrderDragPreview.price : ord.entryPrice;
        const activeLimitPrice = isDraggingLimit ? pendingOrderDragPreview.price : ord.limitPrice;
        const activeSlPrice = isDraggingSl ? pendingOrderDragPreview.price : ord.sl;
        const activeTpPrice = isDraggingTp ? pendingOrderDragPreview.price : ord.tp;
        const execRefPrice = isStopLimit && activeLimitPrice !== null ? activeLimitPrice : activeEntryPrice;

        const rawEntryY = Math.round(priceToY(activeEntryPrice, priceRange, plot)) + 0.5;
        const entryVisible = rawEntryY >= plot.y - 2 && rawEntryY <= plot.y + plot.height + 2;
        const clampedEntryY = Math.max(plot.y + 14, Math.min(plot.y + plot.height - 14, rawEntryY));
        const orderColor = ord.direction === 'BUY' ? '#22C55E' : '#F43F5E';

        ctx.save();
        if (entryVisible) {
          ctx.strokeStyle = isSelected || isDraggingEntry ? '#D4AF37' : orderColor;
          ctx.lineWidth = isSelected || isDraggingEntry ? 1.8 : 1.25;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(plot.x, rawEntryY);
          ctx.lineTo(plot.x + plot.width, rawEntryY);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        const ordTitle = `${formatOrderTypeLabel(ord.orderType).toUpperCase()} ${ord.lotSize.toFixed(2)} ↕`;
        const ordPriceText = `${isStopLimit ? 'TRIG ' : ''}${formatPrice(activeEntryPrice, decimals)}`;
        ctx.font = '700 9.5px "JetBrains Mono", monospace';
        const titleW = ctx.measureText(ordTitle).width;
        const priceW = ctx.measureText(ordPriceText).width;
        const pillH = 20;
        const pillY = (entryVisible ? rawEntryY : clampedEntryY) - pillH / 2;
        const bx = plot.x + 8;
        const pillW = 7 + titleW + 10 + priceW + 7;

        ctx.fillStyle = theme === 'dark' ? '#0D0D12' : '#FFFFFF';
        ctx.strokeStyle = isSelected || isDraggingEntry ? '#D4AF37' : orderColor;
        ctx.lineWidth = isSelected || isDraggingEntry ? 1.5 : 1.1;
        ctx.beginPath();
        safeRoundRect(ctx, bx, pillY, pillW, pillH, 4);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = orderColor;
        ctx.fillText(ordTitle, bx + 7, pillY + pillH / 2);

        const divX = bx + 7 + titleW + 5;
        ctx.beginPath();
        ctx.moveTo(divX, pillY + 4);
        ctx.lineTo(divX, pillY + pillH - 4);
        ctx.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = theme === 'dark' ? '#F5F5F7' : '#141311';
        ctx.fillText(ordPriceText, divX + 5, pillY + pillH / 2);

        let slHandleRect: PositionLayoutRect | null = null;
        let tpHandleRect: PositionLayoutRect | null = null;
        const handleW = 40;
        const showSlHandle = activeSlPrice === null && !isDraggingSl;
        const showTpHandle = activeTpPrice === null && !isDraggingTp;

        let nextHandleX = bx + pillW + 5;
        let handleY = pillY;
        const neededHandles = (showSlHandle ? 1 : 0) + (showTpHandle ? 1 : 0);
        const neededW = neededHandles * handleW + Math.max(0, neededHandles - 1) * 4;
        if (neededHandles > 0 && nextHandleX + neededW > plot.x + plot.width - 4) {
          nextHandleX = bx;
          handleY = pillY + pillH + 3;
          if (handleY + pillH > plot.y + plot.height - 4) {
            handleY = pillY - pillH - 3;
          }
        }

        if (showSlHandle) {
          ctx.fillStyle = theme === 'dark' ? '#2A1115' : '#FEE2E2';
          ctx.strokeStyle = '#E54855';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          safeRoundRect(ctx, nextHandleX, handleY, handleW, pillH, 4);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = theme === 'dark' ? '#FCA5A5' : '#DC2626';
          ctx.font = '700 9.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('SL ↕', nextHandleX + handleW / 2, handleY + pillH / 2);
          slHandleRect = { x: nextHandleX, y: handleY, w: handleW, h: pillH };
          nextHandleX += handleW + 4;
        }
        if (showTpHandle) {
          ctx.fillStyle = theme === 'dark' ? '#0D251C' : '#DCFCE7';
          ctx.strokeStyle = '#19B87D';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          safeRoundRect(ctx, nextHandleX, handleY, handleW, pillH, 4);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = theme === 'dark' ? '#6EE7B7' : '#059669';
          ctx.font = '700 9.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('TP ↕', nextHandleX + handleW / 2, handleY + pillH / 2);
          tpHandleRect = { x: nextHandleX, y: handleY, w: handleW, h: pillH };
        }
        ctx.restore();

        let limitLineInfo: ReturnType<typeof drawOrderTagLine> = null;
        if (isStopLimit && activeLimitPrice !== null) {
          const rawLimitY = Math.round(priceToY(activeLimitPrice, priceRange, plot)) + 0.5;
          const overlapsEntryPill = Math.abs(rawLimitY - rawEntryY) < 24;
          limitLineInfo = drawOrderTagLine(
            activeLimitPrice,
            '#38BDF8',
            `LIMIT ↕ ${formatPrice(activeLimitPrice, decimals)}`,
            [4, 3],
            {
              isHighlighted: isDraggingLimit || isSelected,
              showClearX: false,
              pillAlign: overlapsEntryPill ? 'right' : 'left',
            }
          );
        }

        let slLineInfo: ReturnType<typeof drawOrderTagLine> = null;
        if (activeSlPrice !== null) {
          const slValid = isPendingSlTpValid(ord.direction, execRefPrice, 'SL', activeSlPrice);
          const projSlPnl = computeProjectedPendingSlTpPnL(
            ord.symbol,
            ord.direction,
            ord.lotSize,
            execRefPrice,
            activeSlPrice
          );
          const slLabel =
            isDraggingSl && !slValid.valid
              ? `SL ${formatPrice(activeSlPrice, decimals)} · ${slValid.reason}`
              : `SL ↕ ${formatPrice(activeSlPrice, decimals)} · ${formatSignedUSD(projSlPnl)}`;
          slLineInfo = drawOrderTagLine(
            activeSlPrice,
            isDraggingSl && !slValid.valid ? '#F59E0B' : '#E54855',
            slLabel,
            isDraggingSl ? [3, 2] : [4, 3],
            {
              isHighlighted: isDraggingSl || isSelected,
              showClearX: isSelected && !isDraggingSl && ord.sl !== null,
            }
          );
        }

        let tpLineInfo: ReturnType<typeof drawOrderTagLine> = null;
        if (activeTpPrice !== null) {
          const tpValid = isPendingSlTpValid(ord.direction, execRefPrice, 'TP', activeTpPrice);
          const projTpPnl = computeProjectedPendingSlTpPnL(
            ord.symbol,
            ord.direction,
            ord.lotSize,
            execRefPrice,
            activeTpPrice
          );
          const tpLabel =
            isDraggingTp && !tpValid.valid
              ? `TP ${formatPrice(activeTpPrice, decimals)} · ${tpValid.reason}`
              : `TP ↕ ${formatPrice(activeTpPrice, decimals)} · ${formatSignedUSD(projTpPnl)}`;
          tpLineInfo = drawOrderTagLine(
            activeTpPrice,
            isDraggingTp && !tpValid.valid ? '#F59E0B' : '#19B87D',
            tpLabel,
            isDraggingTp ? [3, 2] : [4, 3],
            {
              isHighlighted: isDraggingTp || isSelected,
              showClearX: isSelected && !isDraggingTp && ord.tp !== null,
            }
          );
        }

        pendingOrderGeometries.push({
          orderId: ord.id,
          entryLineY: rawEntryY,
          entryPillRect: { x: bx, y: pillY, w: pillW, h: pillH },
          limitLineY: limitLineInfo?.lineY ?? null,
          limitPillRect: limitLineInfo?.pillRect ?? null,
          slHandleRect,
          tpHandleRect,
          slLineY: slLineInfo?.lineY ?? null,
          slPillRect: slLineInfo?.pillRect ?? null,
          slClearRect: slLineInfo?.clearRect ?? null,
          tpLineY: tpLineInfo?.lineY ?? null,
          tpPillRect: tpLineInfo?.pillRect ?? null,
          tpClearRect: tpLineInfo?.clearRect ?? null,
        });
      }

      // Interactive Pending Order Draft (when user picks an order type from MT5 bottom drawer)
      if (pendingOrderDraft && pendingOrderDraft.symbol === market) {
        const isDraftStopLimit =
          pendingOrderDraft.orderType === 'BUY_STOP_LIMIT' ||
          pendingOrderDraft.orderType === 'SELL_STOP_LIMIT';
        const draftDir = getDirectionForPendingType(pendingOrderDraft.orderType);
        const draftExecRef =
          isDraftStopLimit && pendingOrderDraft.limitPrice !== null
            ? pendingOrderDraft.limitPrice
            : pendingOrderDraft.entryPrice;
        const draftValidation = effectiveQuoteForPnL
          ? validatePendingPrices({
              orderType: pendingOrderDraft.orderType,
              entryPrice: pendingOrderDraft.entryPrice,
              limitPrice: pendingOrderDraft.limitPrice,
              sl: pendingOrderDraft.sl,
              tp: pendingOrderDraft.tp,
              quote: effectiveQuoteForPnL,
            })
          : { valid: true };
        const entryColor = draftValidation.valid ? '#D4AF37' : '#F59E0B';
        const rawEntryY = Math.round(priceToY(pendingOrderDraft.entryPrice, priceRange, plot)) + 0.5;
        const entryVisible = rawEntryY >= plot.y - 2 && rawEntryY <= plot.y + plot.height + 2;
        const clampedEntryY = Math.max(plot.y + 14, Math.min(plot.y + plot.height - 14, rawEntryY));

        ctx.save();
        if (entryVisible) {
          ctx.strokeStyle = entryColor;
          ctx.lineWidth = pendingDraftDragTarget === 'ENTRY' ? 2.1 : 1.6;
          ctx.setLineDash([6, 3]);
          ctx.beginPath();
          ctx.moveTo(plot.x, rawEntryY);
          ctx.lineTo(plot.x + plot.width, rawEntryY);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        const draftTitle = `${formatOrderTypeLabel(pendingOrderDraft.orderType).toUpperCase()} ${pendingOrderDraft.lotSize.toFixed(2)} ↕`;
        const draftPriceStr = `${isDraftStopLimit ? 'TRIG ' : ''}${formatPrice(pendingOrderDraft.entryPrice, decimals)}`;
        ctx.font = '700 9.5px "JetBrains Mono", monospace';
        const titleW = ctx.measureText(draftTitle).width;
        const priceW = ctx.measureText(draftPriceStr).width;
        const pillH = 20;
        const pillY = (entryVisible ? rawEntryY : clampedEntryY) - pillH / 2;
        const bx = plot.x + 8;
        const pillW = 7 + titleW + 10 + priceW + 7;

        ctx.fillStyle = theme === 'dark' ? '#121008' : '#FFFFFF';
        ctx.strokeStyle = entryColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        safeRoundRect(ctx, bx, pillY, pillW, pillH, 4);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = entryColor;
        ctx.fillText(draftTitle, bx + 7, pillY + pillH / 2);

        const divX = bx + 7 + titleW + 5;
        ctx.beginPath();
        ctx.moveTo(divX, pillY + 4);
        ctx.lineTo(divX, pillY + pillH - 4);
        ctx.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = theme === 'dark' ? '#FFFFFF' : '#141311';
        ctx.fillText(draftPriceStr, divX + 5, pillY + pillH / 2);

        let slHandleRect: PositionLayoutRect | null = null;
        let tpHandleRect: PositionLayoutRect | null = null;
        const handleW = 40;
        const needSl = pendingOrderDraft.sl === null;
        const needTp = pendingOrderDraft.tp === null;
        const neededHandles = (needSl ? 1 : 0) + (needTp ? 1 : 0);
        const neededW = neededHandles * handleW + Math.max(0, neededHandles - 1) * 4;
        let nextHandleX = bx + pillW + 5;
        let handleY = pillY;
        // Wrap SL/TP drag pills cleanly onto row below if narrow mobile width would clip them
        if (neededHandles > 0 && nextHandleX + neededW > plot.x + plot.width - 4) {
          nextHandleX = bx;
          handleY = pillY + pillH + 3;
          if (handleY + pillH > plot.y + plot.height - 4) {
            handleY = pillY - pillH - 3;
          }
        }

        if (needSl) {
          ctx.fillStyle = theme === 'dark' ? '#2A1115' : '#FEE2E2';
          ctx.strokeStyle = '#E54855';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          safeRoundRect(ctx, nextHandleX, handleY, handleW, pillH, 4);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = theme === 'dark' ? '#FCA5A5' : '#DC2626';
          ctx.font = '700 9.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('SL ↕', nextHandleX + handleW / 2, handleY + pillH / 2);
          slHandleRect = { x: nextHandleX, y: handleY, w: handleW, h: pillH };
          nextHandleX += handleW + 4;
        }
        if (needTp) {
          ctx.fillStyle = theme === 'dark' ? '#0D251C' : '#DCFCE7';
          ctx.strokeStyle = '#19B87D';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          safeRoundRect(ctx, nextHandleX, handleY, handleW, pillH, 4);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = theme === 'dark' ? '#6EE7B7' : '#059669';
          ctx.font = '700 9.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('TP ↕', nextHandleX + handleW / 2, handleY + pillH / 2);
          tpHandleRect = { x: nextHandleX, y: handleY, w: handleW, h: pillH };
        }
        ctx.restore();

        let limitLineInfo: ReturnType<typeof drawOrderTagLine> = null;
        if (isDraftStopLimit && pendingOrderDraft.limitPrice !== null) {
          const rawLimitY = Math.round(priceToY(pendingOrderDraft.limitPrice, priceRange, plot)) + 0.5;
          const overlapsEntryPill = Math.abs(rawLimitY - rawEntryY) < 24;
          limitLineInfo = drawOrderTagLine(
            pendingOrderDraft.limitPrice,
            '#38BDF8',
            `LIMIT ↕ ${formatPrice(pendingOrderDraft.limitPrice, decimals)}`,
            [4, 3],
            {
              isHighlighted: pendingDraftDragTarget === 'LIMIT',
              showClearX: false,
              pillAlign: overlapsEntryPill ? 'right' : 'left',
            }
          );
        }

        let slLineInfo: ReturnType<typeof drawOrderTagLine> = null;
        if (pendingOrderDraft.sl !== null) {
          const slValid = isPendingSlTpValid(draftDir, draftExecRef, 'SL', pendingOrderDraft.sl);
          const projSlPnl = computeProjectedPendingSlTpPnL(
            pendingOrderDraft.symbol,
            draftDir,
            pendingOrderDraft.lotSize,
            draftExecRef,
            pendingOrderDraft.sl
          );
          const slLabel =
            !slValid.valid
              ? `SL ${formatPrice(pendingOrderDraft.sl, decimals)} · ${slValid.reason}`
              : `SL ↕ ${formatPrice(pendingOrderDraft.sl, decimals)} · ${formatSignedUSD(projSlPnl)}`;
          slLineInfo = drawOrderTagLine(
            pendingOrderDraft.sl,
            !slValid.valid ? '#F59E0B' : '#E54855',
            slLabel,
            pendingDraftDragTarget === 'SL' ? [3, 2] : [4, 3],
            { isHighlighted: pendingDraftDragTarget === 'SL', showClearX: true }
          );
        }

        let tpLineInfo: ReturnType<typeof drawOrderTagLine> = null;
        if (pendingOrderDraft.tp !== null) {
          const tpValid = isPendingSlTpValid(draftDir, draftExecRef, 'TP', pendingOrderDraft.tp);
          const projTpPnl = computeProjectedPendingSlTpPnL(
            pendingOrderDraft.symbol,
            draftDir,
            pendingOrderDraft.lotSize,
            draftExecRef,
            pendingOrderDraft.tp
          );
          const tpLabel =
            !tpValid.valid
              ? `TP ${formatPrice(pendingOrderDraft.tp, decimals)} · ${tpValid.reason}`
              : `TP ↕ ${formatPrice(pendingOrderDraft.tp, decimals)} · ${formatSignedUSD(projTpPnl)}`;
          tpLineInfo = drawOrderTagLine(
            pendingOrderDraft.tp,
            !tpValid.valid ? '#F59E0B' : '#19B87D',
            tpLabel,
            pendingDraftDragTarget === 'TP' ? [3, 2] : [4, 3],
            { isHighlighted: pendingDraftDragTarget === 'TP', showClearX: true }
          );
        }

        pendingDraftGeometry = {
          entryLineY: rawEntryY,
          entryPillRect: { x: bx, y: pillY, w: pillW, h: pillH },
          limitLineY: limitLineInfo?.lineY ?? null,
          limitPillRect: limitLineInfo?.pillRect ?? null,
          slHandleRect,
          tpHandleRect,
          slLineY: slLineInfo?.lineY ?? null,
          slPillRect: slLineInfo?.pillRect ?? null,
          slClearRect: slLineInfo?.clearRect ?? null,
          tpLineY: tpLineInfo?.lineY ?? null,
          tpPillRect: tpLineInfo?.pillRect ?? null,
          tpClearRect: tpLineInfo?.clearRect ?? null,
        };
      }
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
  ctx.font = '500 10px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const labelMaxWidth = PRICE_AXIS_WIDTH - 8;
  for (let p = firstPriceTick, iter = 0; p <= priceRange.max && iter < 240; p += safePriceStep, iter++) {
    const y = priceToY(p, priceRange, plot);
    if (y > plot.y + 10 && y < plot.y + plot.height - 10) {
      ctx.fillText(formatPrice(p, decimals), axisX + 5, y, labelMaxWidth);
    }
  }

  // Current BUY/ASK & SELL/BID + live candle countdown timer badge on right price axis
  if (candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    const effectiveLastClose = liveCandleOverride ? liveCandleOverride.close : lastCandle.close;
    const bidPrice = quote && replay.mode === 'OFF' ? quote.bid : effectiveLastClose;
    const nowMs = Date.now();
    const showTimer = replay.mode === 'OFF' && isMarketOpen(market, nowMs);
    const rawBidY = priceToY(bidPrice, priceRange, plot);
    const minBidY = quote && replay.mode === 'OFF' ? plot.y + 28 : plot.y + 11;
    const maxBadgeY = Math.max(minBidY, plot.y + plot.height - (showTimer ? 26 : 11));
    const bidBadgeY = Math.max(minBidY, Math.min(maxBadgeY, rawBidY));
    const isLastUp = effectiveLastClose >= lastCandle.open;
    const bidBadgeColor = quote && replay.mode === 'OFF'
      ? '#16A34A'
      : isLastUp
        ? palette.currentPriceLineUp
        : palette.currentPriceLineDown;

    if (quote && replay.mode === 'OFF') {
      const rawAskY = priceToY(quote.ask, priceRange, plot);
      const askBadgeY = Math.min(bidBadgeY - 19, Math.max(plot.y + 10, rawAskY));
      ctx.fillStyle = '#E11D48';
      ctx.fillRect(axisX + 1, askBadgeY - 9, PRICE_AXIS_WIDTH - 2, 18);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(formatPrice(quote.ask, decimals), axisX + 5, askBadgeY, labelMaxWidth);
    }

    // Bid / Spot Price row
    ctx.fillStyle = bidBadgeColor;
    ctx.fillRect(axisX + 1, bidBadgeY - 10, PRICE_AXIS_WIDTH - 2, 19);
    ctx.fillStyle = palette.currentPriceText;
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatPrice(bidPrice, decimals), axisX + 5, bidBadgeY - 0.5, labelMaxWidth);

    // Connected live candle countdown timer row directly below price (off when market is closed)
    if (showTimer) {
      const countdown = getCandleCountdownText(nowMs, interval);
      ctx.fillStyle = bidBadgeColor;
      ctx.fillRect(axisX + 1, bidBadgeY + 9, PRICE_AXIS_WIDTH - 2, 16);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.fillRect(axisX + 1, bidBadgeY + 9, PRICE_AXIS_WIDTH - 2, 16);
      ctx.fillStyle = palette.currentPriceText;
      ctx.font = '600 9.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(countdown, axisX + 5, bidBadgeY + 17.5, labelMaxWidth);
    }
  }

  // Active SL / TP drag price badge on right price axis
  if (positionDragPreview && replay.mode === 'OFF') {
    const dragY = priceToY(positionDragPreview.price, priceRange, plot);
    const clampedDragY = Math.max(plot.y + 10, Math.min(plot.y + plot.height - 10, dragY));
    ctx.fillStyle = positionDragPreview.target === 'SL' ? '#E54855' : '#19B87D';
    ctx.fillRect(axisX + 1, clampedDragY - 9, PRICE_AXIS_WIDTH - 2, 18);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      formatPrice(positionDragPreview.price, decimals),
      axisX + 5,
      clampedDragY,
      labelMaxWidth
    );
  }

  // Active Placed Pending Order drag price badge on right price axis
  if (pendingOrderDragPreview && replay.mode === 'OFF') {
    const dragY = priceToY(pendingOrderDragPreview.price, priceRange, plot);
    const clampedDragY = Math.max(plot.y + 10, Math.min(plot.y + plot.height - 10, dragY));
    ctx.fillStyle =
      pendingOrderDragPreview.target === 'SL'
        ? '#E54855'
        : pendingOrderDragPreview.target === 'TP'
          ? '#19B87D'
          : pendingOrderDragPreview.target === 'LIMIT'
            ? '#0284C7'
            : '#D4AF37';
    ctx.fillRect(axisX + 1, clampedDragY - 9, PRICE_AXIS_WIDTH - 2, 18);
    ctx.fillStyle = pendingOrderDragPreview.target === 'ENTRY' ? '#080808' : '#FFFFFF';
    ctx.font = '700 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      formatPrice(pendingOrderDragPreview.price, decimals),
      axisX + 5,
      clampedDragY,
      labelMaxWidth
    );
  }

  // Pending Order Draft right-axis price badge(s)
  if (pendingOrderDraft && pendingOrderDraft.symbol === market && replay.mode === 'OFF') {
    const drawPendingAxisBadge = (priceVal: number, bg: string, fg: string) => {
      const py = priceToY(priceVal, priceRange, plot);
      const cy = Math.max(plot.y + 10, Math.min(plot.y + plot.height - 10, py));
      ctx.fillStyle = bg;
      ctx.fillRect(axisX + 1, cy - 9, PRICE_AXIS_WIDTH - 2, 18);
      ctx.fillStyle = fg;
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(formatPrice(priceVal, decimals), axisX + 5, cy, labelMaxWidth);
    };
    drawPendingAxisBadge(pendingOrderDraft.entryPrice, '#D4AF37', '#080808');
    if (pendingOrderDraft.limitPrice !== null) {
      drawPendingAxisBadge(pendingOrderDraft.limitPrice, '#0284C7', '#FFFFFF');
    }
    if (pendingOrderDraft.sl !== null) {
      drawPendingAxisBadge(pendingOrderDraft.sl, '#E54855', '#FFFFFF');
    }
    if (pendingOrderDraft.tp !== null) {
      drawPendingAxisBadge(pendingOrderDraft.tp, '#19B87D', '#FFFFFF');
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

  return { plot, priceRange, positionGeometries, pendingOrderGeometries, pendingDraftGeometry };
}
