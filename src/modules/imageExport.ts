import { MarketSymbol, ThemeMode, TimeframeId } from '../types/chart';
import { getChartPalette } from './themeManager';
import { MARKETS } from './timeframeManager';

export interface ExportChartOptions {
  baseCanvas: HTMLCanvasElement;
  drawingCanvas: HTMLCanvasElement;
  market: MarketSymbol;
  interval: TimeframeId;
  theme: ThemeMode;
  lastPrice?: number;
}

/**
 * Exports a crisp high-resolution composite PNG of the visible chart,
 * candlesticks, axes, current price line, drawings, and LEADERS VIEW branding.
 */
export function downloadChartImage(options: ExportChartOptions): boolean {
  const { baseCanvas, drawingCanvas, market, interval, theme, lastPrice } = options;
  if (!baseCanvas || !drawingCanvas) return false;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const headerH = Math.round(44 * dpr);
  const width = baseCanvas.width;
  const height = baseCanvas.height + headerH;

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) return false;

  const palette = getChartPalette(theme);

  // Fill background
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);

  // Header strip with LEADERS VIEW branding & market label
  ctx.fillStyle = palette.axisBg;
  ctx.fillRect(0, 0, width, headerH);
  ctx.strokeStyle = palette.axisBorder;
  ctx.lineWidth = Math.max(1, dpr);
  ctx.beginPath();
  ctx.moveTo(0, headerH - 0.5);
  ctx.lineTo(width, headerH - 0.5);
  ctx.stroke();

  const padX = 16 * dpr;
  ctx.fillStyle = palette.gold;
  ctx.font = `700 ${Math.round(14 * dpr)}px "Cinzel", Georgia, serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('LEADERS VIEW', padX, headerH / 2);

  const meta = MARKETS[market];
  const pricePart = lastPrice !== undefined ? `  ·  ${lastPrice.toFixed(meta.decimals)}` : '';
  ctx.fillStyle = palette.textPrimary;
  ctx.font = `600 ${Math.round(12 * dpr)}px "JetBrains Mono", monospace`;
  ctx.fillText(
    `${market}  ·  ${meta.description}  ·  ${interval.toUpperCase()}${pricePart}`,
    padX + 148 * dpr,
    headerH / 2
  );

  ctx.fillStyle = palette.textMuted;
  ctx.textAlign = 'right';
  ctx.font = `500 ${Math.round(11 * dpr)}px "JetBrains Mono", monospace`;
  ctx.fillText(new Date().toUTCString().replace('GMT', 'UTC'), width - padX, headerH / 2);

  // Composite chart & drawing layers
  ctx.drawImage(baseCanvas, 0, headerH);
  ctx.drawImage(drawingCanvas, 0, headerH);

  // Trigger clean download
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `LEADERS-VIEW_${market}_${interval}_${timestamp}.png`;

  const link = document.createElement('a');
  link.download = filename;
  link.href = out.toDataURL('image/png', 1.0);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return true;
}
