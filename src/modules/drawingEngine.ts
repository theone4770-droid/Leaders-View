import {
  Candle,
  CrosshairData,
  DrawingObject,
  FibLevelConfig,
  LineStyleType,
  MarketSymbol,
  ThemeMode,
  TimeframeId,
  ViewportState,
  WorldPoint,
} from '../types/chart';
import { getChartPalette } from './themeManager';
import {
  formatCrosshairTime,
  formatPrice,
  getIntervalDurationMs,
  MARKETS,
} from './timeframeManager';
import {
  ComputedPriceRange,
  indexToX,
  PlotRect,
  PRICE_AXIS_WIDTH,
  priceToY,
  TIME_AXIS_HEIGHT,
  timeToIndex,
  timeToX,
  xToTime,
  yToPrice,
} from './zoomPanEngine';

export interface ScreenPoint {
  x: number;
  y: number;
}

export const DEFAULT_FIB_RETRACEMENT_LEVELS: FibLevelConfig[] = [
  { level: 0, enabled: true },
  { level: 0.11, enabled: true },
  { level: 0.236, enabled: true },
  { level: 0.382, enabled: true },
  { level: 0.5, enabled: true },
  { level: 0.618, enabled: true },
  { level: 0.786, enabled: true },
  { level: 1, enabled: true },
  { level: 1.272, enabled: false },
  { level: 1.618, enabled: false },
  { level: 2.618, enabled: false },
];

export function getFibRetracementLevels(d: DrawingObject): FibLevelConfig[] {
  if (d.meta?.fibLevels && d.meta.fibLevels.length > 0) {
    return d.meta.fibLevels;
  }
  return DEFAULT_FIB_RETRACEMENT_LEVELS.map((item) => ({ ...item }));
}

export interface LaserTrailPoint {
  x: number;
  y: number;
  createdAt: number;
}

export interface RenderDrawingsParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  plot: PlotRect;
  priceRange: ComputedPriceRange;
  candles: Candle[];
  viewport: ViewportState;
  market: MarketSymbol;
  interval: TimeframeId;
  theme: ThemeMode;
  drawings: DrawingObject[];
  draftDrawing: DrawingObject | null;
  selectedDrawingId: string | null;
  hoveredDrawingId?: string | null;
  hoveredHandleIndex?: number | null;
  crosshair: CrosshairData;
  activeToolId: string;
  isFreeCrosshair?: boolean;
  laserTrail: LaserTrailPoint[];
}

export interface HitTestResult {
  drawingId: string;
  handleIndex: number; // -1 = body hit, 0..N = anchor handle hit, 100 = target handle, 101 = stop handle
}

function applyDash(ctx: CanvasRenderingContext2D, style: LineStyleType): void {
  if (style === 'dashed') ctx.setLineDash([7, 5]);
  else if (style === 'dotted') ctx.setLineDash([2, 4]);
  else ctx.setLineDash([]);
}

const RGBA_CACHE = new Map<string, string>();

function hexToRgba(hex: string, alpha: number): string {
  const roundedAlpha = Math.round(alpha * 1000) / 1000;
  const cacheKey = `${hex}|${roundedAlpha}`;
  const cached = RGBA_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;

  const clean = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  let result = hex;
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    result = `rgba(${r},${g},${b},${roundedAlpha})`;
  } else if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    result = `rgba(${r},${g},${b},${roundedAlpha})`;
  }
  if (RGBA_CACHE.size >= 512) {
    RGBA_CACHE.clear();
  }
  RGBA_CACHE.set(cacheKey, result);
  return result;
}

function toScreen(
  pt: WorldPoint,
  candles: Candle[],
  interval: TimeframeId,
  viewport: ViewportState,
  priceRange: ComputedPriceRange,
  plot: PlotRect
): ScreenPoint {
  return {
    x: timeToX(pt.time, candles, interval, viewport, plot),
    y: priceToY(pt.price, priceRange, plot),
  };
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  from: ScreenPoint,
  to: ScreenPoint,
  size: number,
  color: string
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawExtendedRay(
  ctx: CanvasRenderingContext2D,
  p1: ScreenPoint,
  p2: ScreenPoint,
  plot: PlotRect,
  bothDirections: boolean
): void {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return;
  const ux = dx / len;
  const uy = dy / len;
  const ext = Math.max(plot.width, plot.height) * 3;

  ctx.beginPath();
  if (bothDirections) {
    ctx.moveTo(p1.x - ux * ext, p1.y - uy * ext);
    ctx.lineTo(p1.x + ux * ext, p1.y + uy * ext);
  } else {
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p1.x + ux * ext, p1.y + uy * ext);
  }
  ctx.stroke();
}

function drawInfoBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  lines: string[],
  bg: string,
  border: string,
  textColor: string
): void {
  ctx.save();
  ctx.font = '600 10.5px "JetBrains Mono", monospace';
  const lineH = 15;
  const padX = 8;
  const padY = 5;
  let maxW = 0;
  for (const line of lines) {
    maxW = Math.max(maxW, ctx.measureText(line).width);
  }
  const boxW = maxW + padX * 2;
  const boxH = lines.length * lineH + padY * 2;
  const bx = x - boxW / 2;
  const by = y;

  ctx.fillStyle = bg;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(bx, by, Math.max(0, boxW), Math.max(0, boxH), 4);
  } else {
    ctx.rect(bx, by, Math.max(0, boxW), Math.max(0, boxH));
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  lines.forEach((line, idx) => {
    ctx.fillText(line, bx + padX, by + padY + lineH * idx + lineH / 2);
  });
  ctx.restore();
}

function formatDurationMs(ms: number): string {
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remM = mins % 60;
  if (hrs < 24) return remM > 0 ? `${hrs}h ${remM}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  const remH = hrs % 24;
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
}

export function getPositionExtraPoints(
  drawing: DrawingObject,
  priceRange?: ComputedPriceRange
): {
  targetPrice: number;
  stopPrice: number;
} {
  const p1 = drawing.points[0];
  const p2 = drawing.points[1] ?? p1;
  const entry = p1.price;
  const isLong = drawing.toolId === 'long_position';
  const visibleSpan =
    priceRange && priceRange.max > priceRange.min ? priceRange.max - priceRange.min : 0;
  const fallbackSpan = visibleSpan > 0 ? visibleSpan * 0.14 : Math.max(entry * 0.001, 0.5);
  const pointSpan = Math.abs(p2.price - p1.price);
  const defaultSpan = pointSpan > 1e-6 ? pointSpan : fallbackSpan;

  const targetPrice =
    drawing.meta?.targetPrice ?? (isLong ? entry + defaultSpan : entry - defaultSpan);
  const stopPrice =
    drawing.meta?.stopPrice ?? (isLong ? entry - defaultSpan * 0.5 : entry + defaultSpan * 0.5);
  return { targetPrice, stopPrice };
}

export function getRectangleScreenHandles(p1: ScreenPoint, p2: ScreenPoint): ScreenPoint[] {
  const left = Math.min(p1.x, p2.x);
  const right = Math.max(p1.x, p2.x);
  const top = Math.min(p1.y, p2.y);
  const bot = Math.max(p1.y, p2.y);
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  return [
    p1,                    // 0: corner p0
    p2,                    // 1: corner p1
    { x: p2.x, y: p1.y },  // 2: corner (p1.time, p0.price)
    { x: p1.x, y: p2.y },  // 3: corner (p0.time, p1.price)
    { x: midX, y: top },   // 4: top edge midpoint
    { x: midX, y: bot },   // 5: bottom edge midpoint
    { x: left, y: midY },  // 6: left edge midpoint
    { x: right, y: midY }, // 7: right edge midpoint
  ];
}

function drawSingleObject(
  ctx: CanvasRenderingContext2D,
  d: DrawingObject,
  candles: Candle[],
  interval: TimeframeId,
  viewport: ViewportState,
  priceRange: ComputedPriceRange,
  plot: PlotRect,
  market: MarketSymbol,
  theme: ThemeMode,
  isSelected: boolean,
  isHovered = false,
  hoveredHandleIndex: number | null = null
): void {
  if (!d.points || d.points.length === 0) return;
  const palette = getChartPalette(theme);
  const decimals = MARKETS[market].decimals;
  const pts = d.points.map((p) => toScreen(p, candles, interval, viewport, priceRange, plot));
  const p1 = pts[0];
  const p2 = pts[1] ?? p1;
  const p3 = pts[2] ?? p2;
  const color = d.style.color || palette.gold;
  const alpha = Math.max(0.08, Math.min(1, d.style.opacity ?? 1));
  const lw = Math.max(1, d.style.lineWidth || 1);
  const badgeBg = theme === 'dark' ? 'rgba(14, 14, 16, 0.92)' : 'rgba(255, 253, 248, 0.95)';

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  applyDash(ctx, d.style.lineStyle);

  switch (d.toolId) {
    // ================= TREND TOOLS =================
    case 'trend_line': {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      break;
    }
    case 'trend_arrow':
    case 'shape_arrow': {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      drawArrowHead(ctx, p1, p2, 10 + lw * 1.5, color);
      break;
    }
    case 'arrow_marker': {
      ctx.lineWidth = lw + 4;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      drawArrowHead(ctx, p1, p2, 16 + lw * 2, color);
      break;
    }
    case 'arrow_marks': {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y - 12);
      ctx.lineTo(p1.x + 9, p1.y + 6);
      ctx.lineTo(p1.x - 9, p1.y + 6);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'ray': {
      drawExtendedRay(ctx, p1, p2, plot, false);
      break;
    }
    case 'extended_line': {
      drawExtendedRay(ctx, p1, p2, plot, true);
      break;
    }
    case 'info_line': {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      const dPrice = d.points[1].price - d.points[0].price;
      const pct = d.points[0].price !== 0 ? (dPrice / d.points[0].price) * 100 : 0;
      const bars = Math.round(
        Math.abs(
          timeToIndex(d.points[1].time, candles, interval) -
            timeToIndex(d.points[0].time, candles, interval)
        )
      );
      const angle = (-Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
      drawInfoBadge(
        ctx,
        (p1.x + p2.x) / 2,
        Math.min(p1.y, p2.y) - 44,
        [
          `${dPrice >= 0 ? '+' : ''}${formatPrice(dPrice, decimals)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`,
          `${bars} bars · ${angle.toFixed(1)}°`,
        ],
        badgeBg,
        color,
        palette.textPrimary
      );
      break;
    }
    case 'trend_angle': {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      // Horizontal baseline & angle arc
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p1.x + Math.max(48, Math.abs(p2.x - p1.x)), p1.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const rawRad = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const deg = (-rawRad * 180) / Math.PI;
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, 28, Math.min(0, rawRad), Math.max(0, rawRad));
      ctx.stroke();
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.fillStyle = color;
      ctx.fillText(`${deg.toFixed(1)}°`, p1.x + 34, p1.y + (p2.y < p1.y ? -8 : 14));
      ctx.restore();
      break;
    }
    case 'horizontal_line': {
      const y = Math.round(p1.y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
      ctx.stroke();
      // Price tag on right edge
      ctx.save();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = '600 10.5px "JetBrains Mono", monospace';
      const label = formatPrice(d.points[0].price, decimals);
      const w = ctx.measureText(label).width + 10;
      ctx.fillRect(plot.x + plot.width - w - 2, y - 9, w, 18);
      ctx.fillStyle = '#080808';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, plot.x + plot.width - w + 3, y);
      ctx.restore();
      break;
    }
    case 'horizontal_ray': {
      const y = Math.round(p1.y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(p1.x, y);
      ctx.lineTo(plot.x + plot.width, y);
      ctx.stroke();
      // Anchor dot
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(p1.x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      // Right edge price label
      ctx.fillStyle = color;
      ctx.font = '600 10.5px "JetBrains Mono", monospace';
      const label = formatPrice(d.points[0].price, decimals);
      const w = ctx.measureText(label).width + 10;
      ctx.fillRect(plot.x + plot.width - w - 2, y - 9, w, 18);
      ctx.fillStyle = '#080808';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, plot.x + plot.width - w + 3, y);
      break;
    }
    case 'vertical_line': {
      const x = Math.round(p1.x) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.height);
      ctx.stroke();
      break;
    }
    case 'crossline': {
      const x = Math.round(p1.x) + 0.5;
      const y = Math.round(p1.y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.height);
      ctx.stroke();
      break;
    }
    case 'parallel_channel': {
      const offsetY = pts.length >= 3 ? p3.y - p2.y : -42;
      const offsetX = pts.length >= 3 ? p3.x - p2.x : 0;
      const p1b = { x: p1.x + offsetX, y: p1.y + offsetY };
      const p2b = { x: p2.x + offsetX, y: p2.y + offsetY };

      ctx.fillStyle = hexToRgba(color, 0.12);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p2b.x, p2b.y);
      ctx.lineTo(p1b.x, p1b.y);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.moveTo(p1b.x, p1b.y);
      ctx.lineTo(p2b.x, p2b.y);
      ctx.stroke();

      // Dashed midline
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = Math.max(1, lw - 0.5);
      ctx.beginPath();
      ctx.moveTo((p1.x + p1b.x) / 2, (p1.y + p1b.y) / 2);
      ctx.lineTo((p2.x + p2b.x) / 2, (p2.y + p2b.y) / 2);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'flat_top_bottom': {
      const flatY = pts.length >= 3 ? p3.y : p1.y - 44;
      ctx.fillStyle = hexToRgba(color, 0.12);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p2.x, flatY);
      ctx.lineTo(p1.x, flatY);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.moveTo(p1.x, flatY);
      ctx.lineTo(p2.x, flatY);
      ctx.stroke();
      break;
    }
    case 'disjoint_channel': {
      const dy = pts.length >= 3 ? p3.y - p2.y : -44;
      const p1b = { x: p1.x, y: p1.y - dy };
      const p2b = { x: p2.x, y: p2.y + dy };
      ctx.fillStyle = hexToRgba(color, 0.12);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p2b.x, p2b.y);
      ctx.lineTo(p1b.x, p1b.y);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.moveTo(p1b.x, p1b.y);
      ctx.lineTo(p2b.x, p2b.y);
      ctx.stroke();
      break;
    }
    case 'regression_trend': {
      // Real least-squares linear regression over genuine candles between p1 & p2
      const idx1 = Math.max(0, Math.min(candles.length - 1, Math.round(timeToIndex(d.points[0].time, candles, interval))));
      const idx2 = Math.max(0, Math.min(candles.length - 1, Math.round(timeToIndex(d.points[1].time, candles, interval))));
      const lo = Math.min(idx1, idx2);
      const hi = Math.max(idx1, idx2);
      const count = hi - lo + 1;
      if (count >= 2 && candles.length > hi) {
        let sumX = 0;
        let sumY = 0;
        let sumXY = 0;
        let sumXX = 0;
        for (let i = lo; i <= hi; i++) {
          const x = i - lo;
          const y = candles[i].close;
          sumX += x;
          sumY += y;
          sumXY += x * y;
          sumXX += x * x;
        }
        const denom = count * sumXX - sumX * sumX || 1;
        const slope = (count * sumXY - sumX * sumY) / denom;
        const intercept = (sumY - slope * sumX) / count;
        let varSum = 0;
        for (let i = lo; i <= hi; i++) {
          const est = intercept + slope * (i - lo);
          const diff = candles[i].close - est;
          varSum += diff * diff;
        }
        const std = Math.sqrt(varSum / count);
        const xStart = indexToX(lo, viewport, plot);
        const xEnd = indexToX(hi, viewport, plot);
        const yStartMid = priceToY(intercept, priceRange, plot);
        const yEndMid = priceToY(intercept + slope * (hi - lo), priceRange, plot);
        const yStartUp = priceToY(intercept + std * 2, priceRange, plot);
        const yEndUp = priceToY(intercept + slope * (hi - lo) + std * 2, priceRange, plot);
        const yStartDn = priceToY(intercept - std * 2, priceRange, plot);
        const yEndDn = priceToY(intercept + slope * (hi - lo) - std * 2, priceRange, plot);

        ctx.fillStyle = hexToRgba('#19B87D', 0.08);
        ctx.beginPath();
        ctx.moveTo(xStart, yStartMid);
        ctx.lineTo(xEnd, yEndMid);
        ctx.lineTo(xEnd, yEndUp);
        ctx.lineTo(xStart, yStartUp);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = hexToRgba('#E54855', 0.08);
        ctx.beginPath();
        ctx.moveTo(xStart, yStartMid);
        ctx.lineTo(xEnd, yEndMid);
        ctx.lineTo(xEnd, yEndDn);
        ctx.lineTo(xStart, yStartDn);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(xStart, yStartUp);
        ctx.lineTo(xEnd, yEndUp);
        ctx.moveTo(xStart, yStartDn);
        ctx.lineTo(xEnd, yEndDn);
        ctx.stroke();

        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(xStart, yStartMid);
        ctx.lineTo(xEnd, yEndMid);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
      break;
    }
    case 'pitchfork':
    case 'inside_pitchfork':
    case 'schiff_pitchfork':
    case 'modified_schiff_pitchfork': {
      const mid23 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
      let origin = p1;
      if (d.toolId === 'schiff_pitchfork') {
        origin = { x: p1.x, y: (p1.y + p2.y) / 2 };
      } else if (d.toolId === 'modified_schiff_pitchfork') {
        origin = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      } else if (d.toolId === 'inside_pitchfork') {
        origin = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      }
      const target = d.toolId === 'inside_pitchfork' ? { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 } : mid23;
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;

      // Connecting handle line
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.stroke();
      ctx.restore();

      // Median line + upper/lower tines
      drawExtendedRay(ctx, origin, target, plot, false);
      drawExtendedRay(ctx, p2, { x: p2.x + dx, y: p2.y + dy }, plot, false);
      drawExtendedRay(ctx, p3, { x: p3.x + dx, y: p3.y + dy }, plot, false);
      break;
    }

    // ================= GANN AND FIBONACCI =================
    case 'fib_retracement': {
      const levels = getFibRetracementLevels(d)
        .filter((item) => item.enabled && Number.isFinite(item.level))
        .sort((a, b) => a.level - b.level);
      const leftX = Math.min(p1.x, p2.x);
      const rightX = Math.max(p1.x, p2.x);
      const extendRight = Boolean(d.meta?.fibExtendRight);
      const w = extendRight
        ? Math.max(40, plot.x + plot.width - leftX)
        : Math.max(40, rightX - leftX);
      const reverse = Boolean(d.meta?.fibReverse);
      const showBg = d.meta?.fibShowBackground !== false;
      const showPrices = d.meta?.fibShowPrices !== false;
      const priceDiff = d.points[1].price - d.points[0].price;

      // Diagonal guide
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = hexToRgba(color, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.restore();

      levels.forEach((item, idx) => {
        const lvl = item.level;
        const lvlPrice = reverse
          ? d.points[0].price + priceDiff * lvl
          : d.points[1].price - priceDiff * lvl;
        const y = priceToY(lvlPrice, priceRange, plot);
        const lineColor =
          item.color || (lvl === 0.618 || lvl === 0.5 || lvl === 0.11 ? palette.goldBright : color);

        if (showBg && idx > 0) {
          const prevLvl = levels[idx - 1].level;
          const prevPrice = reverse
            ? d.points[0].price + priceDiff * prevLvl
            : d.points[1].price - priceDiff * prevLvl;
          const prevY = priceToY(prevPrice, priceRange, plot);
          ctx.fillStyle = hexToRgba(lineColor, idx % 2 === 0 ? 0.08 : 0.04);
          ctx.fillRect(leftX, Math.min(y, prevY), w, Math.abs(y - prevY));
        }

        ctx.strokeStyle = lineColor;
        ctx.lineWidth =
          lvl === 0 || lvl === 1 || lvl === 0.618 || lvl === 0.11 ? lw : Math.max(1, lw - 0.5);
        ctx.beginPath();
        ctx.moveTo(leftX, y);
        ctx.lineTo(leftX + w, y);
        ctx.stroke();

        ctx.fillStyle = item.color || palette.textPrimary;
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const lvlLabel = lvl.toFixed(3);
        const labelText = showPrices
          ? `${lvlLabel} (${formatPrice(lvlPrice, decimals)})`
          : lvlLabel;
        ctx.fillText(labelText, leftX + 4, y - 2);
      });
      break;
    }
    case 'trend_based_fib_extension': {
      const levels = [0, 0.382, 0.618, 1, 1.272, 1.618, 2.618];
      const baseSpan = d.points[1].price - d.points[0].price;
      const startX = p3.x;
      const endX = Math.max(startX + 140, plot.x + plot.width - 20);

      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.stroke();
      ctx.restore();

      levels.forEach((lvl) => {
        const lvlPrice = d.points[2].price + baseSpan * lvl;
        const y = priceToY(lvlPrice, priceRange, plot);
        ctx.strokeStyle = lvl === 1.618 || lvl === 1 ? palette.goldBright : color;
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
        ctx.fillStyle = palette.textPrimary;
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillText(`${lvl.toFixed(3)} (${formatPrice(lvlPrice, decimals)})`, startX + 4, y - 3);
      });
      break;
    }
    case 'fib_channel': {
      const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];
      const dx = pts.length >= 3 ? p3.x - p2.x : 0;
      const dy = pts.length >= 3 ? p3.y - p2.y : -70;
      levels.forEach((lvl) => {
        ctx.beginPath();
        ctx.moveTo(p1.x + dx * lvl, p1.y + dy * lvl);
        ctx.lineTo(p2.x + dx * lvl, p2.y + dy * lvl);
        ctx.stroke();
      });
      break;
    }
    case 'fib_time_zone': {
      const fibs = [0, 1, 2, 3, 5, 8, 13, 21, 34];
      const stepX = Math.max(6, Math.abs(p2.x - p1.x));
      const dir = p2.x >= p1.x ? 1 : -1;
      fibs.forEach((f) => {
        const x = p1.x + dir * stepX * f;
        if (x < plot.x - 10 || x > plot.x + plot.width + 10) return;
        ctx.beginPath();
        ctx.moveTo(x, plot.y);
        ctx.lineTo(x, plot.y + plot.height);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillText(String(f), x + 3, plot.y + 14);
      });
      break;
    }
    case 'trend_based_fib_time': {
      const fibs = [0, 0.382, 0.618, 1, 1.618, 2.618, 4.236];
      const spanX = p2.x - p1.x;
      fibs.forEach((f) => {
        const x = p3.x + spanX * f;
        if (x < plot.x - 10 || x > plot.x + plot.width + 10) return;
        ctx.beginPath();
        ctx.moveTo(x, plot.y);
        ctx.lineTo(x, plot.y + plot.height);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillText(f.toFixed(3), x + 3, plot.y + 14);
      });
      break;
    }
    case 'fib_speed_resistance_fan': {
      const ratios = [0.25, 0.382, 0.5, 0.618, 0.75, 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      ctx.strokeRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(dx), Math.abs(dy));
      ratios.forEach((r) => {
        drawExtendedRay(ctx, p1, { x: p1.x + dx, y: p1.y + dy * r }, plot, false);
        drawExtendedRay(ctx, p1, { x: p1.x + dx * r, y: p1.y + dy }, plot, false);
      });
      break;
    }
    case 'fib_circles': {
      const ratios = [0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];
      const rx = Math.max(8, Math.abs(p2.x - p1.x));
      const ry = Math.max(8, Math.abs(p2.y - p1.y));
      ratios.forEach((r) => {
        ctx.beginPath();
        ctx.ellipse(p1.x, p1.y, rx * r, ry * r, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
      break;
    }
    case 'fib_spiral': {
      const baseR = Math.max(10, Math.hypot(p2.x - p1.x, p2.y - p1.y));
      const startAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      ctx.beginPath();
      const b = Math.log(1.6180339887) / (Math.PI / 2);
      for (let t = 0; t <= Math.PI * 4; t += 0.08) {
        const r = (baseR * 0.08) * Math.exp(b * t);
        if (r > Math.max(plot.width, plot.height) * 1.5) break;
        const x = p1.x + r * Math.cos(startAngle + t);
        const y = p1.y + r * Math.sin(startAngle + t);
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      break;
    }
    case 'fib_speed_resistance_arcs': {
      const ratios = [0.236, 0.382, 0.5, 0.618, 0.786, 1];
      const rad = Math.max(12, Math.hypot(p2.x - p1.x, p2.y - p1.y));
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ratios.forEach((r) => {
        ctx.beginPath();
        ctx.arc(p2.x, p2.y, rad * r, Math.PI, 0, p2.y > p1.y);
        ctx.stroke();
      });
      break;
    }
    case 'fib_wedge': {
      const ratios = [0.236, 0.382, 0.5, 0.618, 0.786, 1];
      const a1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const a2 = Math.atan2(p3.y - p1.y, p3.x - p1.x);
      const rMax = Math.max(Math.hypot(p2.x - p1.x, p2.y - p1.y), Math.hypot(p3.x - p1.x, p3.y - p1.y), 20);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.stroke();
      ratios.forEach((r) => {
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, rMax * r, Math.min(a1, a2), Math.max(a1, a2));
        ctx.stroke();
      });
      break;
    }
    case 'pitchfan': {
      const mid = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
      drawExtendedRay(ctx, p1, p2, plot, false);
      drawExtendedRay(ctx, p1, mid, plot, false);
      drawExtendedRay(ctx, p1, p3, plot, false);
      drawExtendedRay(ctx, p1, { x: (p2.x + mid.x) / 2, y: (p2.y + mid.y) / 2 }, plot, false);
      drawExtendedRay(ctx, p1, { x: (p3.x + mid.x) / 2, y: (p3.y + mid.y) / 2 }, plot, false);
      break;
    }
    case 'gann_box':
    case 'gann_square':
    case 'gann_square_fixed': {
      const left = Math.min(p1.x, p2.x);
      const top = Math.min(p1.y, p2.y);
      let w = Math.abs(p2.x - p1.x);
      let h = Math.abs(p2.y - p1.y);
      if (d.toolId === 'gann_square_fixed') {
        const s = Math.max(w, h, 30);
        w = s;
        h = s;
      }
      ctx.fillStyle = hexToRgba(color, 0.06);
      ctx.fillRect(left, top, w, h);
      ctx.strokeRect(left, top, w, h);

      const gridRatios = [0.25, 0.382, 0.5, 0.618, 0.75];
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = hexToRgba(color, 0.5);
      gridRatios.forEach((r) => {
        ctx.beginPath();
        ctx.moveTo(left + w * r, top);
        ctx.lineTo(left + w * r, top + h);
        ctx.moveTo(left, top + h * r);
        ctx.lineTo(left + w, top + h * r);
        ctx.stroke();
      });
      // Gann diagonals
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(left, top);
      ctx.lineTo(left + w, top + h);
      ctx.moveTo(left, top + h);
      ctx.lineTo(left + w, top);
      ctx.stroke();
      if (d.toolId !== 'gann_box') {
        ctx.beginPath();
        ctx.arc(left, top + h, Math.min(w, h), -Math.PI / 2, 0);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'gann_fan': {
      const slopes = [
        { label: '1/8', m: 0.125 },
        { label: '1/4', m: 0.25 },
        { label: '1/3', m: 0.333 },
        { label: '1/2', m: 0.5 },
        { label: '1/1', m: 1 },
        { label: '2/1', m: 2 },
        { label: '3/1', m: 3 },
        { label: '4/1', m: 4 },
        { label: '8/1', m: 8 },
      ];
      const dx = p2.x - p1.x || 60;
      const dy = p2.y - p1.y || -60;
      slopes.forEach((s) => {
        const target = { x: p1.x + dx, y: p1.y + dy * s.m };
        ctx.strokeStyle = s.m === 1 ? palette.goldBright : hexToRgba(color, 0.78);
        ctx.lineWidth = s.m === 1 ? lw + 0.5 : Math.max(1, lw - 0.5);
        drawExtendedRay(ctx, p1, target, plot, false);
        ctx.fillStyle = palette.textMuted;
        ctx.font = '600 9.5px "JetBrains Mono", monospace';
        ctx.fillText(s.label, target.x + 4, target.y);
      });
      break;
    }

    // ================= PATTERNS =================
    case 'xabcd_pattern':
    case 'cypher_pattern':
    case 'abcd_pattern':
    case 'triangle_pattern':
    case 'three_drives_pattern':
    case 'elliott_waves':
    case 'head_and_shoulders_pattern': {
      const labelSets: Record<string, string[]> = {
        xabcd_pattern: ['X', 'A', 'B', 'C', 'D'],
        cypher_pattern: ['X', 'A', 'B', 'C', 'D'],
        abcd_pattern: ['A', 'B', 'C', 'D'],
        triangle_pattern: ['A', 'B', 'C', 'D'],
        three_drives_pattern: ['1', 'A', '2', 'B', '3', 'C'],
        elliott_waves: ['(0)', '(1)', '(2)', '(3)', '(4)', '(5)'],
        head_and_shoulders_pattern: ['Start', 'LS', 'N1', 'HEAD', 'N2', 'RS', 'End'],
      };
      const labels = labelSets[d.toolId] ?? [];

      // Shaded harmonic triangles where applicable
      if ((d.toolId === 'xabcd_pattern' || d.toolId === 'cypher_pattern') && pts.length >= 3) {
        ctx.fillStyle = hexToRgba(color, 0.14);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.lineTo(pts[2].x, pts[2].y);
        ctx.closePath();
        ctx.fill();
        if (pts.length >= 5) {
          ctx.beginPath();
          ctx.moveTo(pts[2].x, pts[2].y);
          ctx.lineTo(pts[3].x, pts[3].y);
          ctx.lineTo(pts[4].x, pts[4].y);
          ctx.closePath();
          ctx.fill();
        }
      } else if (d.toolId === 'triangle_pattern' && pts.length >= 3) {
        ctx.fillStyle = hexToRgba(color, 0.14);
        ctx.beginPath();
        pts.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
        ctx.closePath();
        ctx.fill();
      } else if (d.toolId === 'head_and_shoulders_pattern' && pts.length >= 5) {
        // Extended neckline between N1 (idx 2) and N2 (idx 4)
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = palette.goldBright;
        drawExtendedRay(ctx, pts[2], pts[4], plot, true);
        ctx.restore();
      }

      // Pattern polyline
      ctx.beginPath();
      pts.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.stroke();

      // Vertex labels
      pts.forEach((pt, idx) => {
        const lbl = labels[idx] ?? String(idx + 1);
        ctx.save();
        ctx.setLineDash([]);
        ctx.fillStyle = badgeBg;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(pt.x - 14, pt.y - 22, 28, 16, 4);
        } else {
          ctx.rect(pt.x - 14, pt.y - 22, 28, 16);
        }
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = '700 9.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(lbl, pt.x, pt.y - 14);
        ctx.restore();
      });
      break;
    }
    case 'cyclic_lines': {
      const step = Math.max(10, Math.abs(p2.x - p1.x));
      const firstX = p1.x - Math.ceil((p1.x - plot.x) / step) * step;
      for (let x = firstX; x <= plot.x + plot.width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, plot.y);
        ctx.lineTo(x, plot.y + plot.height);
        ctx.stroke();
      }
      break;
    }
    case 'time_cycles': {
      const step = Math.max(14, Math.abs(p2.x - p1.x));
      const r = step / 2;
      const baseY = plot.y + plot.height - 2;
      const firstX = p1.x - Math.ceil((p1.x - plot.x) / step) * step;
      for (let x = firstX; x <= plot.x + plot.width + step; x += step) {
        ctx.beginPath();
        ctx.arc(x + r, baseY, r, Math.PI, 0);
        ctx.stroke();
      }
      break;
    }
    case 'sine_line': {
      const halfPeriod = Math.max(12, Math.abs(p2.x - p1.x));
      const amp = Math.abs(p2.y - p1.y) / 2 || 28;
      const midY = (p1.y + p2.y) / 2;
      const phaseSign = p2.y < p1.y ? -1 : 1;
      ctx.beginPath();
      for (let x = plot.x; x <= plot.x + plot.width; x += 3) {
        const theta = ((x - p1.x) / halfPeriod) * Math.PI;
        const y = midY + phaseSign * Math.sin(theta - Math.PI / 2) * amp;
        if (x === plot.x) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      break;
    }

    // ================= FORECASTING AND MEASUREMENT =================
    case 'long_position':
    case 'short_position': {
      const isLong = d.toolId === 'long_position';
      const { targetPrice, stopPrice } = getPositionExtraPoints(d, priceRange);
      const entryPrice = d.points[0].price;
      const entryY = p1.y;
      const targetY = priceToY(targetPrice, priceRange, plot);
      const stopY = priceToY(stopPrice, priceRange, plot);
      const leftX = Math.min(p1.x, p2.x);
      const boxW = Math.max(85, Math.abs(p2.x - p1.x));

      // Profit zone (light translucent green so candles remain clearly visible)
      ctx.fillStyle = 'rgba(25, 184, 125, 0.12)';
      ctx.fillRect(leftX, Math.min(entryY, targetY), boxW, Math.abs(targetY - entryY));
      ctx.strokeStyle = 'rgba(25, 184, 125, 0.72)';
      ctx.lineWidth = 1;
      ctx.strokeRect(leftX, Math.min(entryY, targetY), boxW, Math.abs(targetY - entryY));

      // Loss zone (light translucent red so candles remain clearly visible)
      ctx.fillStyle = 'rgba(229, 72, 85, 0.12)';
      ctx.fillRect(leftX, Math.min(entryY, stopY), boxW, Math.abs(stopY - entryY));
      ctx.strokeStyle = 'rgba(229, 72, 85, 0.72)';
      ctx.strokeRect(leftX, Math.min(entryY, stopY), boxW, Math.abs(stopY - entryY));

      // Single clean entry line in the middle (no center black box)
      ctx.strokeStyle = palette.goldBright;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(leftX, entryY);
      ctx.lineTo(leftX + boxW, entryY);
      ctx.stroke();

      const reward = Math.abs(targetPrice - entryPrice);
      const risk = Math.max(1e-6, Math.abs(entryPrice - stopPrice));
      const rewardPct = entryPrice > 0 ? (reward / entryPrice) * 100 : 0;
      const riskPct = entryPrice > 0 ? (risk / entryPrice) * 100 : 0;

      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#19B87D';
      ctx.fillText(
        `TP ${formatPrice(targetPrice, decimals)} (+${rewardPct.toFixed(2)}%)`,
        leftX + 6,
        isLong ? targetY + 12 : targetY - 6
      );
      ctx.fillStyle = '#E54855';
      ctx.fillText(
        `SL ${formatPrice(stopPrice, decimals)} (-${riskPct.toFixed(2)}%)`,
        leftX + 6,
        isLong ? stopY - 6 : stopY + 12
      );
      break;
    }
    case 'position_forecast': {
      const dPrice = d.points[1].price - d.points[0].price;
      const pct = d.points[0].price > 0 ? (dPrice / d.points[0].price) * 100 : 0;
      const forecastColor = dPrice >= 0 ? '#19B87D' : '#E54855';
      ctx.strokeStyle = forecastColor;
      ctx.fillStyle = hexToRgba(forecastColor, 0.14);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y - 18);
      ctx.lineTo(p2.x, p2.y + 18);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      drawArrowHead(ctx, p1, p2, 10, forecastColor);
      drawInfoBadge(
        ctx,
        p2.x,
        p2.y - 34,
        [`TARGET ${formatPrice(d.points[1].price, decimals)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`],
        badgeBg,
        forecastColor,
        palette.textPrimary
      );
      break;
    }
    case 'bars_pattern':
    case 'ghost_feed': {
      const idx1 = Math.max(0, Math.min(candles.length - 1, Math.round(timeToIndex(d.points[0].time, candles, interval))));
      const idx2 = Math.max(0, Math.min(candles.length - 1, Math.round(timeToIndex(d.points[1].time, candles, interval))));
      const lo = Math.min(idx1, idx2);
      const hi = Math.max(idx1, idx2);
      const span = Math.max(1, hi - lo);
      if (d.toolId === 'bars_pattern' && candles.length > hi && span >= 1) {
        const basePrice = candles[lo].open;
        const projOffset = Math.max(span + 2, 6);
        for (let i = lo; i <= hi; i++) {
          const src = candles[i];
          const px = indexToX(i + projOffset, viewport, plot);
          const pShift = d.points[1].price - basePrice;
          const yo = priceToY(src.open + pShift, priceRange, plot);
          const yc = priceToY(src.close + pShift, priceRange, plot);
          const yh = priceToY(src.high + pShift, priceRange, plot);
          const yl = priceToY(src.low + pShift, priceRange, plot);
          ctx.strokeStyle = hexToRgba(color, 0.75);
          ctx.fillStyle = hexToRgba(color, 0.35);
          ctx.beginPath();
          ctx.moveTo(px, yh);
          ctx.lineTo(px, yl);
          ctx.stroke();
          const bw = Math.max(2, viewport.barSpacing * 0.6);
          ctx.fillRect(px - bw / 2, Math.min(yo, yc), bw, Math.max(1.5, Math.abs(yc - yo)));
        }
      } else {
        // Ghost feed projected bars along p1 -> p2 trajectory
        const steps = Math.max(6, Math.min(35, Math.round(Math.abs(p2.x - p1.x) / Math.max(6, viewport.barSpacing))));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x = p1.x + (p2.x - p1.x) * t;
          const y = p1.y + (p2.y - p1.y) * t;
          const wave = Math.sin(i * 1.4) * 9;
          ctx.strokeStyle = hexToRgba(color, 0.55);
          ctx.fillStyle = hexToRgba(color, 0.25);
          ctx.beginPath();
          ctx.moveTo(x, y + wave - 12);
          ctx.lineTo(x, y + wave + 12);
          ctx.stroke();
          ctx.fillRect(x - 3, y + wave - 6, 6, 12);
        }
      }
      break;
    }
    case 'sector': {
      const r = Math.max(20, Math.hypot(p2.x - p1.x, p2.y - p1.y));
      const a = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      ctx.fillStyle = hexToRgba(color, 0.16);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.arc(p1.x, p1.y, r, a - 0.35, a + 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'anchored_vwap': {
      // Real Anchored VWAP calculation over genuine candles starting at p1
      const startIdx = Math.max(
        0,
        Math.min(candles.length - 1, Math.round(timeToIndex(d.points[0].time, candles, interval)))
      );
      let cumPV = 0;
      let cumV = 0;
      ctx.beginPath();
      for (let i = startIdx; i < candles.length; i++) {
        const c = candles[i];
        const typical = (c.high + c.low + c.close) / 3;
        const vol = Math.max(c.volume, 0.0001);
        cumPV += typical * vol;
        cumV += vol;
        const vwap = cumPV / cumV;
        const x = indexToX(i, viewport, plot);
        const y = priceToY(vwap, priceRange, plot);
        if (i === startIdx) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      break;
    }
    case 'fixed_range_volume_profile':
    case 'anchored_volume_profile': {
      // Real Volume Profile histogram across genuine candles in selected range
      const idx1 = Math.max(0, Math.min(candles.length - 1, Math.round(timeToIndex(d.points[0].time, candles, interval))));
      const idx2 =
        d.toolId === 'anchored_volume_profile'
          ? candles.length - 1
          : Math.max(0, Math.min(candles.length - 1, Math.round(timeToIndex(d.points[1].time, candles, interval))));
      const lo = Math.min(idx1, idx2);
      const hi = Math.max(idx1, idx2);

      if (candles.length > hi && hi >= lo) {
        let minP = Infinity;
        let maxP = -Infinity;
        for (let i = lo; i <= hi; i++) {
          if (candles[i].low < minP) minP = candles[i].low;
          if (candles[i].high > maxP) maxP = candles[i].high;
        }
        const bins = 24;
        const binSpan = Math.max(maxP - minP, 0.01) / bins;
        const volumes = new Array<number>(bins).fill(0);
        for (let i = lo; i <= hi; i++) {
          const c = candles[i];
          const mid = (c.high + c.low + c.close) / 3;
          const b = Math.max(0, Math.min(bins - 1, Math.floor((mid - minP) / binSpan)));
          volumes[b] += Math.max(c.volume, 0.001);
        }
        let maxBinVol = 0;
        let pocBin = 0;
        volumes.forEach((v, idx) => {
          if (v > maxBinVol) {
            maxBinVol = v;
            pocBin = idx;
          }
        });
        const leftX = indexToX(lo, viewport, plot);
        const rightX = Math.max(leftX + 60, indexToX(hi, viewport, plot));
        const profileMaxW = Math.min(140, (rightX - leftX) * 0.65);

        // Bounding vertical markers
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = hexToRgba(color, 0.45);
        ctx.beginPath();
        ctx.moveTo(leftX, plot.y);
        ctx.lineTo(leftX, plot.y + plot.height);
        ctx.moveTo(rightX, plot.y);
        ctx.lineTo(rightX, plot.y + plot.height);
        ctx.stroke();
        ctx.restore();

        for (let b = 0; b < bins; b++) {
          const bpLow = minP + b * binSpan;
          const bpHigh = bpLow + binSpan;
          const yTop = priceToY(bpHigh, priceRange, plot);
          const yBot = priceToY(bpLow, priceRange, plot);
          const barW = maxBinVol > 0 ? (volumes[b] / maxBinVol) * profileMaxW : 0;
          ctx.fillStyle = b === pocBin ? hexToRgba(palette.goldBright, 0.72) : hexToRgba(color, 0.34);
          ctx.fillRect(leftX, yTop + 0.5, barW, Math.max(1, yBot - yTop - 1));
        }

        // Point of Control (POC) line
        const pocPrice = minP + (pocBin + 0.5) * binSpan;
        const pocY = priceToY(pocPrice, priceRange, plot);
        ctx.strokeStyle = palette.goldBright;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(leftX, pocY);
        ctx.lineTo(rightX, pocY);
        ctx.stroke();
      }
      break;
    }
    case 'price_range':
    case 'date_range':
    case 'date_and_price_range': {
      const left = Math.min(p1.x, p2.x);
      const top = Math.min(p1.y, p2.y);
      const w = Math.max(2, Math.abs(p2.x - p1.x));
      const h = Math.max(2, Math.abs(p2.y - p1.y));
      const dPrice = d.points[1].price - d.points[0].price;
      const pct = d.points[0].price !== 0 ? (dPrice / d.points[0].price) * 100 : 0;
      const dTime = Math.abs(d.points[1].time - d.points[0].time);
      const bars = Math.max(
        0,
        Math.round(
          Math.abs(
            timeToIndex(d.points[1].time, candles, interval) -
              timeToIndex(d.points[0].time, candles, interval)
          )
        )
      );
      const boxColor = d.toolId === 'date_range' ? color : dPrice >= 0 ? '#19B87D' : '#E54855';

      ctx.fillStyle = hexToRgba(boxColor, 0.14);
      ctx.strokeStyle = boxColor;
      ctx.fillRect(left, top, w, h);
      ctx.strokeRect(left, top, w, h);

      // Center directional arrow(s)
      ctx.beginPath();
      if (d.toolId !== 'date_range') {
        const midX = left + w / 2;
        ctx.moveTo(midX, p1.y);
        ctx.lineTo(midX, p2.y);
      }
      if (d.toolId !== 'price_range') {
        const midY = top + h / 2;
        ctx.moveTo(p1.x, midY);
        ctx.lineTo(p2.x, midY);
      }
      ctx.stroke();

      const lines: string[] = [];
      if (d.toolId !== 'date_range') {
        lines.push(`${dPrice >= 0 ? '+' : ''}${formatPrice(dPrice, decimals)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`);
      }
      if (d.toolId !== 'price_range') {
        lines.push(`${bars} bars · ${formatDurationMs(dTime)}`);
      }
      drawInfoBadge(ctx, left + w / 2, top + h + 8, lines, badgeBg, boxColor, palette.textPrimary);
      break;
    }

    // ================= GEOMETRIC SHAPES =================
    case 'rectangle': {
      const left = Math.min(p1.x, p2.x);
      const top = Math.min(p1.y, p2.y);
      const w = Math.abs(p2.x - p1.x);
      const h = Math.abs(p2.y - p1.y);
      ctx.fillStyle = hexToRgba(d.style.fillColor || color, 0.14);
      ctx.fillRect(left, top, w, h);
      ctx.strokeRect(left, top, w, h);
      break;
    }
    case 'rotated_rectangle': {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const proj = pts.length >= 3 ? (p3.x - p1.x) * nx + (p3.y - p1.y) * ny : 45;
      const c1 = p1;
      const c2 = p2;
      const c3 = { x: p2.x + nx * proj, y: p2.y + ny * proj };
      const c4 = { x: p1.x + nx * proj, y: p1.y + ny * proj };
      ctx.fillStyle = hexToRgba(d.style.fillColor || color, 0.14);
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.lineTo(c2.x, c2.y);
      ctx.lineTo(c3.x, c3.y);
      ctx.lineTo(c4.x, c4.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'circle': {
      const r = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      ctx.fillStyle = hexToRgba(d.style.fillColor || color, 0.12);
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'ellipse': {
      const cx = (p1.x + p2.x) / 2;
      const cy = (p1.y + p2.y) / 2;
      const rx = Math.max(2, Math.abs(p2.x - p1.x) / 2);
      const ry = Math.max(2, Math.abs(p2.y - p1.y) / 2);
      ctx.fillStyle = hexToRgba(d.style.fillColor || color, 0.12);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'triangle': {
      ctx.fillStyle = hexToRgba(d.style.fillColor || color, 0.14);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      if (pts.length >= 3) {
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.stroke();
      break;
    }
    case 'path':
    case 'polyline': {
      ctx.beginPath();
      pts.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.stroke();
      if (d.toolId === 'path' && pts.length >= 2) {
        drawArrowHead(ctx, pts[pts.length - 2], pts[pts.length - 1], 10, color);
      }
      break;
    }
    case 'arc':
    case 'curve': {
      const ctrl = pts.length >= 3 ? p3 : { x: (p1.x + p2.x) / 2, y: Math.min(p1.y, p2.y) - 44 };
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.quadraticCurveTo(ctrl.x, ctrl.y, p2.x, p2.y);
      ctx.stroke();
      break;
    }
    case 'double_curve': {
      const c1 = pts[2] ?? { x: p1.x + (p2.x - p1.x) * 0.33, y: p1.y - 40 };
      const c2 = pts[3] ?? { x: p1.x + (p2.x - p1.x) * 0.66, y: p2.y + 40 };
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p2.x, p2.y);
      ctx.stroke();
      break;
    }
    case 'brush':
    case 'highlighter': {
      if (d.toolId === 'highlighter') {
        ctx.globalAlpha = Math.min(0.35, alpha * 0.4);
        ctx.lineWidth = Math.max(14, lw * 6);
      }
      ctx.beginPath();
      pts.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.stroke();
      break;
    }

    // ================= ANNOTATION (EXACT 7) =================
    case 'text':
    case 'anchored_text': {
      ctx.setLineDash([]);
      const content = d.text || (d.toolId === 'anchored_text' ? 'ANCHORED NOTE' : 'TEXT');
      const fs = d.style.fontSize || 13;
      ctx.font = `600 ${fs}px "Plus Jakarta Sans", sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(content, p1.x, p1.y);
      if (d.toolId === 'anchored_text') {
        ctx.beginPath();
        ctx.arc(p1.x - 8, p1.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'note':
    case 'price_note':
    case 'pin':
    case 'comment': {
      ctx.setLineDash([]);
      const label =
        d.toolId === 'price_note'
          ? `${formatPrice(d.points[0].price, decimals)}${d.text ? ` · ${d.text}` : ''}`
          : d.text || d.toolId.toUpperCase();
      // Anchor pin dot
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, d.toolId === 'pin' ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      if (d.toolId === 'pin') {
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y + 5);
        ctx.lineTo(p1.x, p1.y + 16);
        ctx.stroke();
      }
      drawInfoBadge(ctx, p1.x, p1.y - 32, [label], badgeBg, color, palette.textPrimary);
      break;
    }
    case 'callout': {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      drawInfoBadge(ctx, p2.x, p2.y - 12, [d.text || 'CALLOUT'], badgeBg, color, palette.textPrimary);
      break;
    }

    // ================= VISUALS (EXACT 3) =================
    case 'visual_emojis': {
      ctx.setLineDash([]);
      ctx.font = `${d.style.fontSize || 24}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.visualGlyph || '🚀', p1.x, p1.y);
      break;
    }
    case 'visual_stickers': {
      ctx.setLineDash([]);
      const sticker = d.visualGlyph || 'BULL';
      drawInfoBadge(ctx, p1.x, p1.y - 12, [sticker], '#14120C', palette.gold, palette.goldBright);
      break;
    }
    case 'visual_icons': {
      ctx.setLineDash([]);
      ctx.font = `700 ${d.style.fontSize || 20}px "Plus Jakarta Sans", sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.visualGlyph || '★', p1.x, p1.y);
      break;
    }

    default: {
      ctx.beginPath();
      pts.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.stroke();
    }
  }

  // Draw selection or hover anchor handles
  if (isSelected || isHovered) {
    ctx.setLineDash([]);
    ctx.globalAlpha = isSelected ? 1 : 0.85;
    const handlePts: ScreenPoint[] =
      d.toolId === 'brush' || d.toolId === 'highlighter'
        ? [pts[0], pts[pts.length - 1]]
        : d.toolId === 'rectangle' && pts.length >= 2
          ? getRectangleScreenHandles(pts[0], pts[1])
          : pts;

    handlePts.forEach((hp, idx) => {
      const isHandleHot = isHovered && hoveredHandleIndex === idx;
      const radius = isHandleHot ? 6.5 : isSelected ? 5 : 4.25;
      if (isHandleHot) {
        ctx.fillStyle = hexToRgba(palette.handleStroke, 0.25);
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = palette.handleFill;
      ctx.strokeStyle = palette.handleStroke;
      ctx.lineWidth = isHandleHot ? 2.4 : 2;
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // Extra TP & SL handles for Long/Short Position
    if (d.toolId === 'long_position' || d.toolId === 'short_position') {
      const { targetPrice, stopPrice } = getPositionExtraPoints(d, priceRange);
      const midX = (p1.x + Math.max(p1.x + 85, p2.x)) / 2;
      const tY = priceToY(targetPrice, priceRange, plot);
      const sY = priceToY(stopPrice, priceRange, plot);

      [
        { x: midX, y: tY, stroke: '#19B87D', hIdx: 100 },
        { x: midX, y: sY, stroke: '#E54855', hIdx: 101 },
      ].forEach((h) => {
        const isHot = isHovered && hoveredHandleIndex === h.hIdx;
        ctx.fillStyle = palette.handleFill;
        ctx.strokeStyle = h.stroke;
        ctx.lineWidth = isHot ? 2.5 : 2;
        ctx.beginPath();
        ctx.arc(h.x, h.y, isHot ? 6.5 : isSelected ? 5.5 : 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }
  }

  ctx.restore();
}

export function renderDrawingsLayer(params: RenderDrawingsParams): void {
  const {
    ctx,
    width,
    height,
    plot,
    priceRange,
    candles,
    viewport,
    market,
    interval,
    theme,
    drawings,
    draftDrawing,
    selectedDrawingId,
    hoveredDrawingId = null,
    hoveredHandleIndex = null,
    crosshair,
    activeToolId,
    isFreeCrosshair = false,
    laserTrail,
  } = params;

  ctx.clearRect(0, 0, width, height);
  const palette = getChartPalette(theme);
  const decimals = MARKETS[market].decimals;

  // Clip all drawings to plot area (skip save/clip/restore if nothing to draw)
  if (drawings.length > 0 || draftDrawing || laserTrail.length > 1) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.width, plot.height);
    ctx.clip();

    for (let i = 0; i < drawings.length; i++) {
      const d = drawings[i];
      if (d.meta?.visible === false) continue;
      const isSel = d.id === selectedDrawingId;
      const isHov = d.id === hoveredDrawingId;
      drawSingleObject(
        ctx,
        d,
        candles,
        interval,
        viewport,
        priceRange,
        plot,
        market,
        theme,
        isSel,
        isHov,
        isHov ? hoveredHandleIndex : null
      );
    }

    if (draftDrawing) {
      drawSingleObject(
        ctx,
        draftDrawing,
        candles,
        interval,
        viewport,
        priceRange,
        plot,
        market,
        theme,
        true,
        false,
        null
      );
    }

    // Demonstration laser pointer trail
    if (laserTrail.length > 1) {
      const now = performance.now();
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < laserTrail.length; i++) {
        const prev = laserTrail[i - 1];
        const curr = laserTrail[i];
        const age = (now - curr.createdAt) / 900;
        if (age >= 1) continue;
        ctx.strokeStyle = hexToRgba(palette.goldBright, (1 - age) * 0.9);
        ctx.lineWidth = 4 * (1 - age * 0.5);
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(curr.x, curr.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();
  }

  // Crosshair & Axis Readouts
  if (
    crosshair.visible &&
    crosshair.x >= plot.x &&
    crosshair.x <= plot.x + plot.width &&
    crosshair.y >= plot.y &&
    crosshair.y <= plot.y + plot.height
  ) {
    const cx = Math.round(crosshair.x) + 0.5;
    const cy = Math.round(crosshair.y) + 0.5;

    ctx.save();
    if (activeToolId === 'tool_dot' && !isFreeCrosshair) {
      ctx.fillStyle = palette.goldBright;
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (activeToolId !== 'tool_arrow' || isFreeCrosshair) {
      ctx.strokeStyle = palette.crosshairLine;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, plot.y);
      ctx.lineTo(cx, plot.y + plot.height);
      ctx.moveTo(plot.x, cy);
      ctx.lineTo(plot.x + plot.width, cy);
      ctx.stroke();
      ctx.setLineDash([]);

      if (isFreeCrosshair) {
        // TradingView-style freely movable crosshair target reticle
        ctx.fillStyle = hexToRgba(palette.goldBright, 0.14);
        ctx.strokeStyle = palette.goldBright;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = palette.goldBright;
        ctx.beginPath();
        ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const hasTrendLineSnap =
          (activeToolId === 'rectangle' || activeToolId === 'fib_retracement') &&
          drawings.some((d) => d.toolId === 'trend_line' && d.meta?.visible !== false && d.points.length >= 2);
        const isTrendStartSnap = activeToolId === 'trend_line' && !draftDrawing;
        if (activeToolId === 'tool_magic' || isTrendStartSnap || hasTrendLineSnap) {
          // Subtle magnet snap ring
          ctx.strokeStyle = palette.goldBright;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // Price label on right axis
    const axisX = plot.x + plot.width;
    ctx.fillStyle = palette.crosshairLabelBg;
    ctx.fillRect(axisX + 1, cy - 10, PRICE_AXIS_WIDTH - 2, 20);
    ctx.fillStyle = palette.crosshairLabelText;
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatPrice(crosshair.price, decimals), axisX + 7, cy);

    // 24-hour Time label on bottom axis
    const timeText = formatCrosshairTime(crosshair.time, interval);
    const tw = ctx.measureText(timeText).width + 16;
    const tx = Math.max(2, Math.min(plot.width - tw - 2, cx - tw / 2));
    ctx.fillStyle = palette.crosshairLabelBg;
    ctx.fillRect(tx, plot.height + 2, tw, TIME_AXIS_HEIGHT - 4);
    ctx.fillStyle = palette.crosshairLabelText;
    ctx.textAlign = 'center';
    ctx.fillText(timeText, tx + tw / 2, plot.height + TIME_AXIS_HEIGHT / 2 + 1);
    ctx.restore();
  }
}

function pointToSegmentDist(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pointToRayDist(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pointToLineDist(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pointInPolygon(p: ScreenPoint, poly: ScreenPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToQuadBezier(
  p: ScreenPoint,
  p0: ScreenPoint,
  ctrl: ScreenPoint,
  p1: ScreenPoint
): number {
  const steps = 18;
  let minD = Infinity;
  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const cur = {
      x: mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p1.x,
      y: mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p1.y,
    };
    const d = pointToSegmentDist(p, prev, cur);
    if (d < minD) minD = d;
    prev = cur;
  }
  return minD;
}

function distToCubicBezier(
  p: ScreenPoint,
  p0: ScreenPoint,
  c1: ScreenPoint,
  c2: ScreenPoint,
  p1: ScreenPoint
): number {
  const steps = 22;
  let minD = Infinity;
  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const cur = {
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p1.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p1.y,
    };
    const d = pointToSegmentDist(p, prev, cur);
    if (d < minD) minD = d;
    prev = cur;
  }
  return minD;
}

/** Hit-test drawings in reverse z-order (handles first, then drawing bodies) */
export function hitTestDrawings(
  x: number,
  y: number,
  drawings: DrawingObject[],
  candles: Candle[],
  interval: TimeframeId,
  viewport: ViewportState,
  priceRange: ComputedPriceRange,
  plot: PlotRect,
  selectedDrawingId: string | null
): HitTestResult | null {
  const pointer = { x, y };
  const handleRadius = 14;
  const bodyThreshold = 12;

  // 1. Check handles of selected drawing first
  if (selectedDrawingId) {
    const sel = drawings.find((d) => d.id === selectedDrawingId);
    if (sel && sel.meta?.visible !== false) {
      const pts = sel.points.map((p) => toScreen(p, candles, interval, viewport, priceRange, plot));
      if (sel.toolId === 'long_position' || sel.toolId === 'short_position') {
        const { targetPrice, stopPrice } = getPositionExtraPoints(sel, priceRange);
        const p1 = pts[0];
        const p2 = pts[1] ?? p1;
        const midX = (p1.x + Math.max(p1.x + 85, p2.x)) / 2;
        if (Math.hypot(x - midX, y - priceToY(targetPrice, priceRange, plot)) <= handleRadius) {
          return { drawingId: sel.id, handleIndex: 100 };
        }
        if (Math.hypot(x - midX, y - priceToY(stopPrice, priceRange, plot)) <= handleRadius) {
          return { drawingId: sel.id, handleIndex: 101 };
        }
      }
      if (sel.toolId !== 'brush' && sel.toolId !== 'highlighter') {
        const selHandles =
          sel.toolId === 'rectangle' && pts.length >= 2
            ? getRectangleScreenHandles(pts[0], pts[1])
            : pts;
        for (let i = 0; i < selHandles.length; i++) {
          if (Math.hypot(x - selHandles[i].x, y - selHandles[i].y) <= handleRadius) {
            return { drawingId: sel.id, handleIndex: i };
          }
        }
      }
    }
  }

  // 2. Check drawing handles (multi-point) & bodies top-down
  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i];
    if (d.meta?.visible === false || d.points.length === 0) continue;
    const pts = d.points.map((p) => toScreen(p, candles, interval, viewport, priceRange, plot));
    const p1 = pts[0];
    const p2 = pts[1] ?? p1;
    const p3 = pts[2] ?? p2;

    // Allow grabbing handles directly on hover for multi-point tools (all 8 handles for rectangle)
    if (pts.length >= 2 && d.toolId !== 'brush' && d.toolId !== 'highlighter') {
      const hoverHandles =
        d.toolId === 'rectangle' ? getRectangleScreenHandles(p1, p2) : pts;
      for (let h = 0; h < hoverHandles.length; h++) {
        if (Math.hypot(x - hoverHandles[h].x, y - hoverHandles[h].y) <= 11) {
          return { drawingId: d.id, handleIndex: h };
        }
      }
    }

    if (d.toolId === 'horizontal_line') {
      if (Math.abs(y - p1.y) <= bodyThreshold) return { drawingId: d.id, handleIndex: -1 };
      continue;
    }
    if (d.toolId === 'horizontal_ray') {
      if (Math.abs(y - p1.y) <= bodyThreshold && x >= p1.x - 12) {
        return { drawingId: d.id, handleIndex: -1 };
      }
      continue;
    }
    if (d.toolId === 'vertical_line') {
      if (Math.abs(x - p1.x) <= bodyThreshold) return { drawingId: d.id, handleIndex: -1 };
      continue;
    }
    if (d.toolId === 'crossline') {
      if (Math.abs(x - p1.x) <= bodyThreshold || Math.abs(y - p1.y) <= bodyThreshold) {
        return { drawingId: d.id, handleIndex: -1 };
      }
      continue;
    }
    if (d.toolId === 'ray') {
      if (pointToRayDist(pointer, p1, p2) <= bodyThreshold) {
        return { drawingId: d.id, handleIndex: -1 };
      }
      continue;
    }
    if (d.toolId === 'extended_line') {
      if (pointToLineDist(pointer, p1, p2) <= bodyThreshold) {
        return { drawingId: d.id, handleIndex: -1 };
      }
      continue;
    }
    if (d.toolId === 'parallel_channel') {
      const offsetY = pts.length >= 3 ? p3.y - p2.y : -42;
      const offsetX = pts.length >= 3 ? p3.x - p2.x : 0;
      const p1b = { x: p1.x + offsetX, y: p1.y + offsetY };
      const p2b = { x: p2.x + offsetX, y: p2.y + offsetY };
      const midA = { x: (p1.x + p1b.x) / 2, y: (p1.y + p1b.y) / 2 };
      const midB = { x: (p2.x + p2b.x) / 2, y: (p2.y + p2b.y) / 2 };
      if (
        pointToSegmentDist(pointer, p1, p2) <= bodyThreshold ||
        pointToSegmentDist(pointer, p1b, p2b) <= bodyThreshold ||
        pointToSegmentDist(pointer, midA, midB) <= bodyThreshold ||
        pointInPolygon(pointer, [p1, p2, p2b, p1b])
      ) {
        return { drawingId: d.id, handleIndex: -1 };
      }
      continue;
    }
    if (d.toolId === 'flat_top_bottom') {
      const flatY = pts.length >= 3 ? p3.y : p1.y - 44;
      const p1b = { x: p1.x, y: flatY };
      const p2b = { x: p2.x, y: flatY };
      if (
        pointToSegmentDist(pointer, p1, p2) <= bodyThreshold ||
        pointToSegmentDist(pointer, p1b, p2b) <= bodyThreshold ||
        pointInPolygon(pointer, [p1, p2, p2b, p1b])
      ) {
        return { drawingId: d.id, handleIndex: -1 };
      }
      continue;
    }
    if (d.toolId === 'disjoint_channel') {
      const dy = pts.length >= 3 ? p3.y - p2.y : -44;
      const p1b = { x: p1.x, y: p1.y - dy };
      const p2b = { x: p2.x, y: p2.y + dy };
      if (
        pointToSegmentDist(pointer, p1, p2) <= bodyThreshold ||
        pointToSegmentDist(pointer, p1b, p2b) <= bodyThreshold ||
        pointInPolygon(pointer, [p1, p2, p2b, p1b])
      ) {
        return { drawingId: d.id, handleIndex: -1 };
      }
      continue;
    }
    if (
      d.toolId === 'pitchfork' ||
      d.toolId === 'inside_pitchfork' ||
      d.toolId === 'schiff_pitchfork' ||
      d.toolId === 'modified_schiff_pitchfork'
    ) {
      const mid23 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
      let origin = p1;
      if (d.toolId === 'schiff_pitchfork') {
        origin = { x: p1.x, y: (p1.y + p2.y) / 2 };
      } else if (d.toolId === 'modified_schiff_pitchfork' || d.toolId === 'inside_pitchfork') {
        origin = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      }
      const dx = mid23.x - origin.x;
      const dy = mid23.y - origin.y;
      if (
        pointToSegmentDist(pointer, p2, p3) <= bodyThreshold ||
        pointToRayDist(pointer, origin, mid23) <= bodyThreshold ||
        pointToRayDist(pointer, p2, { x: p2.x + dx, y: p2.y + dy }) <= bodyThreshold ||
        pointToRayDist(pointer, p3, { x: p3.x + dx, y: p3.y + dy }) <= bodyThreshold
      ) {
        return { drawingId: d.id, handleIndex: -1 };
      }
      continue;
    }
    if (d.toolId === 'long_position' || d.toolId === 'short_position') {
      const { targetPrice, stopPrice } = getPositionExtraPoints(d, priceRange);
      const tY = priceToY(targetPrice, priceRange, plot);
      const sY = priceToY(stopPrice, priceRange, plot);
      const left = Math.min(p1.x, p2.x);
      const right = left + Math.max(85, Math.abs(p2.x - p1.x));
      const top = Math.min(p1.y, tY, sY);
      const bot = Math.max(p1.y, tY, sY);
      if (x >= left - 6 && x <= right + 6 && y >= top - 6 && y <= bot + 6) {
        return { drawingId: d.id, handleIndex: -1 };
      }
      continue;
    }
    if (
      d.toolId === 'rectangle' ||
      d.toolId === 'fib_retracement' ||
      d.toolId === 'gann_box' ||
      d.toolId === 'gann_square' ||
      d.toolId === 'gann_square_fixed' ||
      d.toolId === 'price_range' ||
      d.toolId === 'date_range' ||
      d.toolId === 'date_and_price_range' ||
      d.toolId === 'ellipse' ||
      d.toolId === 'regression_trend' ||
      d.toolId === 'fixed_range_volume_profile' ||
      d.toolId === 'anchored_volume_profile'
    ) {
      const left = Math.min(p1.x, p2.x);
      const right = Math.max(p1.x, p2.x);
      const top = Math.min(p1.y, p2.y);
      const bot = Math.max(p1.y, p2.y);
      if (
        (x >= left - 8 && x <= right + 8 && y >= top - 8 && y <= bot + 8) ||
        pointToSegmentDist(pointer, p1, p2) <= bodyThreshold
      ) {
        return { drawingId: d.id, handleIndex: -1 };
      }
      continue;
    }
    if (d.toolId === 'rotated_rectangle') {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const proj = pts.length >= 3 ? (p3.x - p1.x) * nx + (p3.y - p1.y) * ny : 45;
      const c1 = p1;
      const c2 = p2;
      const c3 = { x: p2.x + nx * proj, y: p2.y + ny * proj };
      const c4 = { x: p1.x + nx * proj, y: p1.y + ny * proj };
      if (
        pointToSegmentDist(pointer, c1, c2) <= bodyThreshold ||
        pointToSegmentDist(pointer, c2, c3) <= bodyThreshold ||
        pointToSegmentDist(pointer, c3, c4) <= bodyThreshold ||
        pointToSegmentDist(pointer, c4, c1) <= bodyThreshold ||
        pointInPolygon(pointer, [c1, c2, c3, c4])
      ) {
        return { drawingId: d.id, handleIndex: -1 };
      }
      continue;
    }
    if (d.toolId === 'triangle') {
      if (
        pointToSegmentDist(pointer, p1, p2) <= bodyThreshold ||
        (pts.length >= 3 &&
          (pointToSegmentDist(pointer, p2, p3) <= bodyThreshold ||
            pointToSegmentDist(pointer, p3, p1) <= bodyThreshold ||
            pointInPolygon(pointer, [p1, p2, p3])))
      ) {
        return { drawingId: d.id, handleIndex: -1 };
      }
      continue;
    }
    if (d.toolId === 'arc' || d.toolId === 'curve') {
      const ctrl = pts.length >= 3 ? p3 : { x: (p1.x + p2.x) / 2, y: Math.min(p1.y, p2.y) - 44 };
      if (distToQuadBezier(pointer, p1, ctrl, p2) <= bodyThreshold) {
        return { drawingId: d.id, handleIndex: -1 };
      }
      continue;
    }
    if (d.toolId === 'double_curve') {
      const c1 = pts[2] ?? { x: p1.x + (p2.x - p1.x) * 0.33, y: p1.y - 40 };
      const c2 = pts[3] ?? { x: p1.x + (p2.x - p1.x) * 0.66, y: p2.y + 40 };
      if (distToCubicBezier(pointer, p1, c1, c2, p2) <= bodyThreshold) {
        return { drawingId: d.id, handleIndex: -1 };
      }
      continue;
    }
    if (d.toolId === 'circle' || d.toolId === 'sector') {
      const r = Math.max(20, Math.hypot(p2.x - p1.x, p2.y - p1.y));
      const dist = Math.hypot(x - p1.x, y - p1.y);
      if (dist <= r + 8) return { drawingId: d.id, handleIndex: -1 };
      continue;
    }
    if (d.toolId === 'cyclic_lines') {
      const step = Math.max(10, Math.abs(p2.x - p1.x));
      const firstX = p1.x - Math.ceil((p1.x - plot.x) / step) * step;
      let hit = false;
      for (let cx = firstX; cx <= plot.x + plot.width; cx += step) {
        if (Math.abs(x - cx) <= bodyThreshold) {
          hit = true;
          break;
        }
      }
      if (hit) return { drawingId: d.id, handleIndex: -1 };
      continue;
    }

    if (pts.length === 1) {
      if (Math.hypot(x - p1.x, y - p1.y) <= 28) {
        return { drawingId: d.id, handleIndex: -1 };
      }
      continue;
    }

    // Check line segments between points (trend_line, trend_arrow, info_line, trend_angle, path, polyline, patterns, brush, highlighter, etc.)
    const segThreshold = d.toolId === 'highlighter' ? 18 : d.toolId === 'brush' ? 14 : bodyThreshold;
    for (let s = 0; s < pts.length - 1; s++) {
      if (pointToSegmentDist(pointer, pts[s], pts[s + 1]) <= segThreshold) {
        return { drawingId: d.id, handleIndex: -1 };
      }
    }
  }

  return null;
}

/** Snap pointer to nearest candle OHLC when MAGIC (magnet) tool is active */
export function snapPointToCandle(
  rawTime: number,
  rawPrice: number,
  candles: Candle[],
  interval: TimeframeId,
  priceRange: ComputedPriceRange,
  plot: PlotRect
): WorldPoint {
  if (candles.length === 0) return { time: rawTime, price: rawPrice };
  const idx = Math.max(0, Math.min(candles.length - 1, Math.round(timeToIndex(rawTime, candles, interval))));
  const c = candles[idx];
  const candidates = [c.open, c.high, c.low, c.close];
  const rawY = priceToY(rawPrice, priceRange, plot);
  let bestPrice = rawPrice;
  let bestDist = 26; // px snap radius
  for (const cand of candidates) {
    const d = Math.abs(priceToY(cand, priceRange, plot) - rawY);
    if (d < bestDist) {
      bestDist = d;
      bestPrice = cand;
    }
  }
  return { time: c.time, price: bestPrice };
}

/**
 * Magnetically attract pointer toward nearest candle body (open or close) when within snap radius,
 * while releasing smoothly for free placement/sliding once moved slightly away.
 */
export function snapPointToCandleBody(
  rawTime: number,
  rawPrice: number,
  candles: Candle[],
  interval: TimeframeId,
  priceRange: ComputedPriceRange,
  plot: PlotRect,
  barSpacing?: number,
  maxDistPx = 15
): WorldPoint {
  if (candles.length === 0) return { time: rawTime, price: rawPrice };
  const rawIdx = timeToIndex(rawTime, candles, interval);
  const idx = Math.max(0, Math.min(candles.length - 1, Math.round(rawIdx)));
  const c = candles[idx];

  const spacing = barSpacing ?? 10;
  const distX = Math.abs(rawIdx - idx) * spacing;
  const maxDistX = Math.max(14, Math.min(24, spacing * 0.75));
  if (distX > maxDistX) {
    return { time: rawTime, price: rawPrice };
  }

  const rawY = priceToY(rawPrice, priceRange, plot);
  const distOpen = Math.abs(priceToY(c.open, priceRange, plot) - rawY);
  const distClose = Math.abs(priceToY(c.close, priceRange, plot) - rawY);
  const minDistY = Math.min(distOpen, distClose);

  if (minDistY <= maxDistPx) {
    return {
      time: c.time,
      price: distOpen <= distClose ? c.open : c.close,
    };
  }

  return { time: rawTime, price: rawPrice };
}

/** Snap Box (rectangle) points onto existing Trend Lines (endpoints or segment) */
export function snapPointToTrendLines(
  rawTime: number,
  rawPrice: number,
  drawings: DrawingObject[],
  candles: Candle[],
  interval: TimeframeId,
  viewport: ViewportState,
  priceRange: ComputedPriceRange,
  plot: PlotRect,
  anchorWorldPt?: WorldPoint,
  maxDistPx?: number
): WorldPoint {
  const trendLines = drawings.filter(
    (d) => d.toolId === 'trend_line' && d.meta?.visible !== false && d.points.length >= 2
  );
  if (trendLines.length === 0) {
    return { time: rawTime, price: rawPrice };
  }

  const pointer = {
    x: timeToX(rawTime, candles, interval, viewport, plot),
    y: priceToY(rawPrice, priceRange, plot),
  };

  let bestDist = Infinity;
  let bestPoint: WorldPoint = { time: rawTime, price: rawPrice };

  for (let i = 0; i < trendLines.length; i++) {
    const tl = trendLines[i];
    const p1 = tl.points[0];
    const p2 = tl.points[1];
    const s1 = toScreen(p1, candles, interval, viewport, priceRange, plot);
    const s2 = toScreen(p2, candles, interval, viewport, priceRange, plot);

    // 1. Prioritize exact Trend Line endpoints
    const d1 = Math.hypot(pointer.x - s1.x, pointer.y - s1.y);
    const d2 = Math.hypot(pointer.x - s2.x, pointer.y - s2.y);
    if (d1 <= 22 && d1 < bestDist) {
      bestDist = d1;
      bestPoint = { time: p1.time, price: p1.price };
      continue;
    }
    if (d2 <= 22 && d2 < bestDist) {
      bestDist = d2;
      bestPoint = { time: p2.time, price: p2.price };
      continue;
    }

    // 2. Snap to closest point along Trend Line segment s1 -> s2
    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((pointer.x - s1.x) * dx + (pointer.y - s1.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = s1.x + t * dx;
    const projY = s1.y + t * dy;
    const dist = Math.hypot(pointer.x - projX, pointer.y - projY);

    if (dist < bestDist) {
      bestDist = dist;
      bestPoint = {
        time: xToTime(projX, candles, interval, viewport, plot),
        price: p1.price + (p2.price - p1.price) * t,
      };
    }
  }

  const effectiveLimit = maxDistPx ?? 42;
  if (bestDist > effectiveLimit) {
    return { time: rawTime, price: rawPrice };
  }

  // When placing/resizing the 2nd corner relative to an anchor, snap magnetically to a trend line
  // ONLY if it keeps a real 2D rectangle shape (never collapsing height/width to a flat line).
  if (anchorWorldPt) {
    const anchorScreen = toScreen(anchorWorldPt, candles, interval, viewport, priceRange, plot);
    const snapScreen = toScreen(bestPoint, candles, interval, viewport, priceRange, plot);
    if (
      Math.abs(snapScreen.x - anchorScreen.x) < 10 ||
      Math.abs(snapScreen.y - anchorScreen.y) < 10
    ) {
      return { time: rawTime, price: rawPrice };
    }
  }

  return bestPoint;
}

/** Attract/snap a moved Rectangle box cleanly onto any nearby Trend Line up to its end without going below trend line end */
export function snapMovedRectangleToTrendLines(
  rect: DrawingObject,
  drawings: DrawingObject[],
  candles: Candle[],
  interval: TimeframeId,
  viewport: ViewportState,
  priceRange: ComputedPriceRange,
  plot: PlotRect,
  snapRadiusPx = 38
): DrawingObject {
  if (rect.toolId !== 'rectangle' || rect.points.length < 2) return rect;
  const trendLines = drawings.filter(
    (d) => d.toolId === 'trend_line' && d.meta?.visible !== false && d.points.length >= 2
  );
  if (trendLines.length === 0) return rect;

  const p0 = rect.points[0];
  const p1 = rect.points[1];
  const midTime = (p0.time + p1.time) / 2;
  const midPrice = (p0.price + p1.price) / 2;
  const minTime = Math.min(p0.time, p1.time);
  const maxTime = Math.max(p0.time, p1.time);
  const minPrice = Math.min(p0.price, p1.price);
  const maxPrice = Math.max(p0.price, p1.price);

  const probePoints: WorldPoint[] = [
    p0,
    p1,
    { time: p1.time, price: p0.price },
    { time: p0.time, price: p1.price },
    { time: midTime, price: maxPrice },
    { time: midTime, price: minPrice },
    { time: minTime, price: midPrice },
    { time: maxTime, price: midPrice },
  ];

  let bestDist = snapRadiusPx;
  let bestTl: DrawingObject | null = null;
  let bestTouchPoint: WorldPoint | null = null;
  let bestT = 0;

  for (let pIdx = 0; pIdx < probePoints.length; pIdx++) {
    const probeWorld = probePoints[pIdx];
    const probeScreen = toScreen(probeWorld, candles, interval, viewport, priceRange, plot);

    for (let i = 0; i < trendLines.length; i++) {
      const tl = trendLines[i];
      const t1 = tl.points[0];
      const t2 = tl.points[1];
      const s1 = toScreen(t1, candles, interval, viewport, priceRange, plot);
      const s2 = toScreen(t2, candles, interval, viewport, priceRange, plot);

      const d1 = Math.hypot(probeScreen.x - s1.x, probeScreen.y - s1.y);
      if (d1 <= Math.min(24, bestDist)) {
        bestDist = d1;
        bestTl = tl;
        bestTouchPoint = { ...t1 };
        bestT = 0;
      }

      const d2 = Math.hypot(probeScreen.x - s2.x, probeScreen.y - s2.y);
      if (d2 <= Math.min(24, bestDist)) {
        bestDist = d2;
        bestTl = tl;
        bestTouchPoint = { ...t2 };
        bestT = 1;
      }

      const dx = s2.x - s1.x;
      const dy = s2.y - s1.y;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq === 0 ? 0 : ((probeScreen.x - s1.x) * dx + (probeScreen.y - s1.y) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const projX = s1.x + t * dx;
      const projY = s1.y + t * dy;
      const dist = Math.hypot(probeScreen.x - projX, probeScreen.y - projY);

      if (dist < bestDist) {
        bestDist = dist;
        bestTl = tl;
        bestT = t;
        bestTouchPoint =
          t <= 0.16
            ? { ...t1 }
            : t >= 0.84
              ? { ...t2 }
              : {
                  time: xToTime(projX, candles, interval, viewport, plot),
                  price: t1.price + (t2.price - t1.price) * t,
                };
      }
    }
  }

  if (!bestTl || !bestTouchPoint) return rect;

  const tlStart = bestTl.points[0];
  const tlEnd = bestTl.points[1];
  const isEndTouch = bestT >= 0.84;
  const anchorPoint = isEndTouch ? { ...tlEnd } : bestT <= 0.16 ? { ...tlStart } : bestTouchPoint;
  const boxHeight = Math.max(Math.abs(p1.price - p0.price), 1e-6);
  const origWidth = Math.max(Math.abs(p1.time - p0.time), getIntervalDurationMs(interval) * 3);

  // Place the box on the right side of the touched Trend Line point (up, middle, or end)
  const snapped: DrawingObject = {
    ...rect,
    points: [
      { time: anchorPoint.time, price: anchorPoint.price + boxHeight },
      { time: anchorPoint.time + origWidth, price: anchorPoint.price },
    ],
  };

  // If touched at Trend Line End and a Fib Retracement is already snapped to this Trend Line, lock 0.110..end
  if (isEndTouch) {
    const matchedFib = drawings.find(
      (d) =>
        d.toolId === 'fib_retracement' &&
        d.meta?.visible !== false &&
        d.points.length >= 2 &&
        Math.abs(d.points[0].time - tlStart.time) < 1e-6 &&
        Math.abs(d.points[0].price - tlStart.price) < 1e-6 &&
        Math.abs(d.points[1].time - tlEnd.time) < 1e-6 &&
        Math.abs(d.points[1].price - tlEnd.price) < 1e-6
    );
    if (matchedFib) {
      return reshapeRectangleToFib0110(snapped, bestTl, matchedFib, interval);
    }
  }

  return snapped;
}

/** Resolve exact touch anchor along a Trend Line (up/start, middle, or end) from screen coordinates */
export function findTrendLineTouchPoint(
  screenX: number,
  screenY: number,
  tl: DrawingObject,
  candles: Candle[],
  interval: TimeframeId,
  viewport: ViewportState,
  priceRange: ComputedPriceRange,
  plot: PlotRect
): { point: WorldPoint; t: number; isEnd: boolean } {
  const t1 = tl.points[0];
  const t2 = tl.points[1];
  const s1 = toScreen(t1, candles, interval, viewport, priceRange, plot);
  const s2 = toScreen(t2, candles, interval, viewport, priceRange, plot);

  const d1 = Math.hypot(screenX - s1.x, screenY - s1.y);
  const d2 = Math.hypot(screenX - s2.x, screenY - s2.y);
  if (d2 <= 24 && d2 <= d1) {
    return { point: { ...t2 }, t: 1, isEnd: true };
  }
  if (d1 <= 24) {
    return { point: { ...t1 }, t: 0, isEnd: false };
  }

  const dx = s2.x - s1.x;
  const dy = s2.y - s1.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((screenX - s1.x) * dx + (screenY - s1.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  if (t >= 0.84) {
    return { point: { ...t2 }, t: 1, isEnd: true };
  }
  if (t <= 0.16) {
    return { point: { ...t1 }, t: 0, isEnd: false };
  }

  const projX = s1.x + t * dx;
  return {
    point: {
      time: xToTime(projX, candles, interval, viewport, plot),
      price: t1.price + (t2.price - t1.price) * t,
    },
    t,
    isEnd: false,
  };
}

function pointToSegmentDistPx(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Find the closest visible Trend Line within snapRadiusPx of a screen point */
export function findNearbyTrendLine(
  screenX: number,
  screenY: number,
  drawings: DrawingObject[],
  candles: Candle[],
  interval: TimeframeId,
  viewport: ViewportState,
  priceRange: ComputedPriceRange,
  plot: PlotRect,
  snapRadiusPx = 42
): DrawingObject | null {
  const trendLines = drawings.filter(
    (d) => d.toolId === 'trend_line' && d.meta?.visible !== false && d.points.length >= 2
  );
  if (trendLines.length === 0) return null;

  let bestDist = snapRadiusPx;
  let bestTl: DrawingObject | null = null;

  for (let i = 0; i < trendLines.length; i++) {
    const tl = trendLines[i];
    const s1 = toScreen(tl.points[0], candles, interval, viewport, priceRange, plot);
    const s2 = toScreen(tl.points[1], candles, interval, viewport, priceRange, plot);
    const dist = pointToSegmentDistPx(screenX, screenY, s1.x, s1.y, s2.x, s2.y);
    if (dist <= bestDist) {
      bestDist = dist;
      bestTl = tl;
    }
  }

  return bestTl;
}

/** Snap a moved Fib Retracement magnetically onto a nearby Trend Line from start to end */
export function snapMovedFibToTrendLines(
  fib: DrawingObject,
  drawings: DrawingObject[],
  candles: Candle[],
  interval: TimeframeId,
  viewport: ViewportState,
  priceRange: ComputedPriceRange,
  plot: PlotRect,
  snapRadiusPx = 42,
  pointerScreen?: ScreenPoint
): { drawing: DrawingObject; matchedTrendLine: DrawingObject | null } {
  if (fib.toolId !== 'fib_retracement' || fib.points.length < 2) {
    return { drawing: fib, matchedTrendLine: null };
  }
  const trendLines = drawings.filter(
    (d) =>
      d.id !== fib.id &&
      d.toolId === 'trend_line' &&
      d.meta?.visible !== false &&
      d.points.length >= 2
  );
  if (trendLines.length === 0) {
    return { drawing: fib, matchedTrendLine: null };
  }

  const f0 = fib.points[0];
  const f1 = fib.points[1];
  const sF0 = toScreen(f0, candles, interval, viewport, priceRange, plot);
  const sF1 = toScreen(f1, candles, interval, viewport, priceRange, plot);
  const probes: ScreenPoint[] = [
    sF0,
    sF1,
    { x: (sF0.x + sF1.x) / 2, y: (sF0.y + sF1.y) / 2 },
    { x: sF0.x, y: sF1.y },
    { x: sF1.x, y: sF0.y },
  ];
  if (pointerScreen) {
    probes.push(pointerScreen);
  }

  let bestDist = snapRadiusPx;
  let bestTl: DrawingObject | null = null;

  for (let i = 0; i < trendLines.length; i++) {
    const tl = trendLines[i];
    const s1 = toScreen(tl.points[0], candles, interval, viewport, priceRange, plot);
    const s2 = toScreen(tl.points[1], candles, interval, viewport, priceRange, plot);

    for (let j = 0; j < probes.length; j++) {
      const dist = pointToSegmentDistPx(probes[j].x, probes[j].y, s1.x, s1.y, s2.x, s2.y);
      if (dist <= bestDist) {
        bestDist = dist;
        bestTl = tl;
      }
    }
  }

  if (!bestTl) {
    return { drawing: fib, matchedTrendLine: null };
  }

  return {
    drawing: {
      ...fib,
      points: [{ ...bestTl.points[0] }, { ...bestTl.points[1] }],
    },
    matchedTrendLine: bestTl,
  };
}

/** Check if a Rectangle box is attached to / touching a Trend Line on screen */
export function isRectangleAttachedToTrendLine(
  rect: DrawingObject,
  tl: DrawingObject,
  candles: Candle[],
  interval: TimeframeId,
  viewport: ViewportState,
  priceRange: ComputedPriceRange,
  plot: PlotRect,
  tolerancePx = 30
): boolean {
  if (rect.toolId !== 'rectangle' || rect.points.length < 2 || tl.points.length < 2) {
    return false;
  }

  const r0 = toScreen(rect.points[0], candles, interval, viewport, priceRange, plot);
  const r1 = toScreen(rect.points[1], candles, interval, viewport, priceRange, plot);
  const s0 = toScreen(tl.points[0], candles, interval, viewport, priceRange, plot);
  const s1 = toScreen(tl.points[1], candles, interval, viewport, priceRange, plot);

  const minX = Math.min(r0.x, r1.x);
  const maxX = Math.max(r0.x, r1.x);
  const minY = Math.min(r0.y, r1.y);
  const maxY = Math.max(r0.y, r1.y);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  const rectProbes: ScreenPoint[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
    { x: midX, y: minY },
    { x: midX, y: maxY },
    { x: minX, y: midY },
    { x: maxX, y: midY },
  ];

  for (let i = 0; i < rectProbes.length; i++) {
    if (pointToSegmentDistPx(rectProbes[i].x, rectProbes[i].y, s0.x, s0.y, s1.x, s1.y) <= tolerancePx) {
      return true;
    }
  }

  // Also check if any part of the Trend Line segment lies within tolerancePx of the rectangle box
  const expMinX = minX - tolerancePx;
  const expMaxX = maxX + tolerancePx;
  const expMinY = minY - tolerancePx;
  const expMaxY = maxY + tolerancePx;
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = s0.x + (s1.x - s0.x) * t;
    const y = s0.y + (s1.y - s0.y) * t;
    if (x >= expMinX && x <= expMaxX && y >= expMinY && y <= expMaxY) {
      return true;
    }
  }

  return false;
}

/** Reshape an attached Rectangle box on the right side of the Trend Line so upper line is at Fib 0.110 and lower line is at Trend Line End */
export function reshapeRectangleToFib0110(
  rect: DrawingObject,
  tl: DrawingObject,
  fib: DrawingObject,
  interval?: TimeframeId
): DrawingObject {
  if (rect.toolId !== 'rectangle' || tl.points.length < 2) return rect;
  const reverse = Boolean(fib.meta?.fibReverse);
  const tlStart = tl.points[0];
  const tlEnd = tl.points[1];
  const tlRightTime = Math.max(tlStart.time, tlEnd.time);
  const fallbackWidth = interval
    ? getIntervalDurationMs(interval) * 8
    : Math.max(Math.abs(tlEnd.time - tlStart.time) * 0.5, 1);
  const boxWidth = Math.max(
    rect.points.length >= 2 ? Math.abs(rect.points[1].time - rect.points[0].time) : 0,
    fallbackWidth
  );
  const priceDiff = tlEnd.price - tlStart.price;
  const price0110 = reverse
    ? tlStart.price + priceDiff * 0.11
    : tlEnd.price - priceDiff * 0.11;

  if (Math.abs(price0110 - tlEnd.price) > 1e-8) {
    return {
      ...rect,
      points: [
        { time: tlRightTime, price: price0110 },
        { time: tlRightTime + boxWidth, price: tlEnd.price },
      ],
    };
  }

  const origSpan = Math.max(Math.abs(rect.points[1].price - rect.points[0].price), 1e-6);
  return {
    ...rect,
    points: [
      { time: tlRightTime, price: tlEnd.price + origSpan },
      { time: tlRightTime + boxWidth, price: tlEnd.price },
    ],
  };
}

/** Find the Trend Line a Rectangle is attached to on screen */
export function findAttachedTrendLineForRectangle(
  rect: DrawingObject,
  drawings: DrawingObject[],
  candles: Candle[],
  interval: TimeframeId,
  viewport: ViewportState,
  priceRange: ComputedPriceRange,
  plot: PlotRect,
  tolerancePx = 34
): DrawingObject | null {
  if (rect.toolId !== 'rectangle' || rect.points.length < 2) return null;
  for (let i = 0; i < drawings.length; i++) {
    const d = drawings[i];
    if (
      d.toolId === 'trend_line' &&
      d.meta?.visible !== false &&
      d.points.length >= 2 &&
      isRectangleAttachedToTrendLine(rect, d, candles, interval, viewport, priceRange, plot, tolerancePx)
    ) {
      return d;
    }
  }
  return null;
}

/** Keep a created/resized Rectangle anchored on the right side of its touched Trend Line point (up, middle, or end) */
export function constrainRectangleToTrendLine(
  rect: DrawingObject,
  tl: DrawingObject,
  candles: Candle[],
  interval: TimeframeId,
  viewport: ViewportState,
  priceRange: ComputedPriceRange,
  plot: PlotRect,
  snapEndRadiusPx = 36,
  anchorPointOverride?: WorldPoint
): DrawingObject {
  if (rect.toolId !== 'rectangle' || rect.points.length < 2 || tl.points.length < 2) return rect;

  let p0 = { ...rect.points[0] };
  let p1 = { ...rect.points[1] };

  const anchor = anchorPointOverride
    ? anchorPointOverride
    : (() => {
        const leftBottomScreen = toScreen(
          { time: Math.min(p0.time, p1.time), price: Math.min(p0.price, p1.price) },
          candles,
          interval,
          viewport,
          priceRange,
          plot
        );
        return findTrendLineTouchPoint(
          leftBottomScreen.x,
          leftBottomScreen.y,
          tl,
          candles,
          interval,
          viewport,
          priceRange,
          plot
        ).point;
      })();

  // Never go below the anchored Trend Line touch/end price
  p0.price = Math.max(p0.price, anchor.price);
  p1.price = Math.max(p1.price, anchor.price);

  // Ensure box keeps non-zero height above anchor.price
  const minHeightPx = 12;
  const anchorY = priceToY(anchor.price, priceRange, plot);
  const minTopPrice = yToPrice(anchorY - minHeightPx, priceRange, plot);
  if (Math.abs(priceToY(p0.price, priceRange, plot) - priceToY(p1.price, priceRange, plot)) < minHeightPx) {
    if (p0.price >= p1.price) {
      p0.price = Math.max(p0.price, minTopPrice);
      p1.price = anchor.price;
    } else {
      p1.price = Math.max(p1.price, minTopPrice);
      p0.price = anchor.price;
    }
  }

  // Keep box on the right side of the touched Trend Line anchor
  const anchorX = timeToX(anchor.time, candles, interval, viewport, plot);
  const minRightTime = xToTime(anchorX + 16, candles, interval, viewport, plot);
  if (p0.time <= p1.time) {
    const x0 = timeToX(p0.time, candles, interval, viewport, plot);
    if (p0.time < anchor.time || Math.abs(x0 - anchorX) <= snapEndRadiusPx) {
      p0.time = anchor.time;
    }
    p1.time = Math.max(p1.time, Math.max(p0.time + 1, minRightTime));
  } else {
    const x1 = timeToX(p1.time, candles, interval, viewport, plot);
    if (p1.time < anchor.time || Math.abs(x1 - anchorX) <= snapEndRadiusPx) {
      p1.time = anchor.time;
    }
    p0.time = Math.max(p0.time, Math.max(p1.time + 1, minRightTime));
  }

  return { ...rect, points: [p0, p1] };
}

/** Reshape any Rectangle boxes attached to `tl` after `fib` attracts onto `tl` */
export function applyFibSnapToAttachedRectangles(
  drawings: DrawingObject[],
  fib: DrawingObject,
  tl: DrawingObject,
  candles: Candle[],
  interval: TimeframeId,
  viewport: ViewportState,
  priceRange: ComputedPriceRange,
  plot: PlotRect
): DrawingObject[] {
  let changed = false;
  const next = drawings.map((d) => {
    if (
      d.toolId === 'rectangle' &&
      d.meta?.visible !== false &&
      isRectangleAttachedToTrendLine(d, tl, candles, interval, viewport, priceRange, plot)
    ) {
      changed = true;
      return reshapeRectangleToFib0110(d, tl, fib, interval);
    }
    return d;
  });
  return changed ? next : drawings;
}

export function duplicateDrawing(
  drawing: DrawingObject,
  interval: TimeframeId,
  visiblePriceSpan?: number
): DrawingObject {
  const shiftTime = getIntervalDurationMs(interval) * 3;
  const shiftPrice =
    visiblePriceSpan && visiblePriceSpan > 0
      ? visiblePriceSpan * 0.035
      : drawing.points[0]?.price
        ? drawing.points[0].price * 0.0005
        : 0.5;
  return {
    ...drawing,
    id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    points: drawing.points.map((p) => ({
      time: p.time + shiftTime,
      price: p.price + shiftPrice,
    })),
    style: { ...drawing.style },
    meta: drawing.meta
      ? {
          ...drawing.meta,
          fibLevels: drawing.meta.fibLevels?.map((item) => ({ ...item })),
          targetPrice:
            drawing.meta.targetPrice !== undefined
              ? drawing.meta.targetPrice + shiftPrice
              : undefined,
          stopPrice:
            drawing.meta.stopPrice !== undefined ? drawing.meta.stopPrice + shiftPrice : undefined,
          createdAt: Date.now(),
        }
      : { createdAt: Date.now() },
  };
}

export function moveDrawingByDelta(
  drawing: DrawingObject,
  deltaTime: number,
  deltaPrice: number
): DrawingObject {
  return {
    ...drawing,
    points: drawing.points.map((p) => ({
      time: p.time + deltaTime,
      price: p.price + deltaPrice,
    })),
    meta: drawing.meta
      ? {
          ...drawing.meta,
          targetPrice:
            drawing.meta.targetPrice !== undefined
              ? drawing.meta.targetPrice + deltaPrice
              : undefined,
          stopPrice:
            drawing.meta.stopPrice !== undefined
              ? drawing.meta.stopPrice + deltaPrice
              : undefined,
        }
      : undefined,
  };
}

export function resizeDrawingHandle(
  drawing: DrawingObject,
  handleIndex: number,
  nextPoint: WorldPoint
): DrawingObject {
  if (handleIndex === 100) {
    return {
      ...drawing,
      meta: { ...drawing.meta, targetPrice: nextPoint.price },
    };
  }
  if (handleIndex === 101) {
    return {
      ...drawing,
      meta: { ...drawing.meta, stopPrice: nextPoint.price },
    };
  }
  if (drawing.toolId === 'rectangle' && drawing.points.length >= 2) {
    const p0 = drawing.points[0];
    const p1 = drawing.points[1];
    let nextPoints: WorldPoint[];
    switch (handleIndex) {
      case 0:
        nextPoints = [nextPoint, p1];
        break;
      case 1:
        nextPoints = [p0, nextPoint];
        break;
      case 2: // (p1.time, p0.price)
        nextPoints = [
          { time: p0.time, price: nextPoint.price },
          { time: nextPoint.time, price: p1.price },
        ];
        break;
      case 3: // (p0.time, p1.price)
        nextPoints = [
          { time: nextPoint.time, price: p0.price },
          { time: p1.time, price: nextPoint.price },
        ];
        break;
      case 4: // top edge (higher price)
        nextPoints =
          p0.price >= p1.price
            ? [{ ...p0, price: nextPoint.price }, p1]
            : [p0, { ...p1, price: nextPoint.price }];
        break;
      case 5: // bottom edge (lower price)
        nextPoints =
          p0.price < p1.price
            ? [{ ...p0, price: nextPoint.price }, p1]
            : [p0, { ...p1, price: nextPoint.price }];
        break;
      case 6: // left edge (earlier time)
        nextPoints =
          p0.time <= p1.time
            ? [{ ...p0, time: nextPoint.time }, p1]
            : [p0, { ...p1, time: nextPoint.time }];
        break;
      case 7: // right edge (later time)
        nextPoints =
          p0.time > p1.time
            ? [{ ...p0, time: nextPoint.time }, p1]
            : [p0, { ...p1, time: nextPoint.time }];
        break;
      default:
        nextPoints = drawing.points.map((p, idx) => (idx === handleIndex ? nextPoint : p));
    }
    return { ...drawing, points: nextPoints };
  }
  const nextPoints = drawing.points.map((p, idx) => (idx === handleIndex ? nextPoint : p));
  return { ...drawing, points: nextPoints };
}
