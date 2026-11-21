import { MarketSymbol, ThemeMode, TimeframeId } from '../types/chart';
import { getChartPalette } from './themeManager';

export interface ExportChartOptions {
  baseCanvas: HTMLCanvasElement;
  drawingCanvas: HTMLCanvasElement;
  market: MarketSymbol;
  interval: TimeframeId;
  theme: ThemeMode;
}

/**
 * Exports a crisp, clean PNG of the chart with minimal small top branding
 * showing LEADERS VIEW and the active market symbol (XAUUSD / BTCUSD).
 */
export function downloadChartImage(options: ExportChartOptions): boolean {
  const { baseCanvas, drawingCanvas, market, interval, theme } = options;
  if (!baseCanvas || !drawingCanvas) return false;

  const width = baseCanvas.width;
  const height = baseCanvas.height;
  const scale =
    baseCanvas.clientWidth > 0
      ? width / baseCanvas.clientWidth
      : Math.min(window.devicePixelRatio || 1, 2);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) return false;

  const palette = getChartPalette(theme);

  // Clean full-bleed chart & drawing composite
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(baseCanvas, 0, 0);
  ctx.drawImage(drawingCanvas, 0, 0);

  // Subtle small top-left label: LEADERS VIEW  BTCUSD / XAUUSD
  const padX = Math.round(12 * scale);
  const padY = Math.round(12 * scale);
  const fontSize = Math.max(10, Math.round(11 * scale));

  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", sans-serif`;
  ctx.fillStyle = palette.textPrimary;
  ctx.globalAlpha = 0.85;
  ctx.fillText('LEADERS VIEW', padX, padY);

  const brandWidth = ctx.measureText('LEADERS VIEW').width;
  const gap = Math.round(8 * scale);
  ctx.font = `600 ${fontSize}px "JetBrains Mono", monospace`;
  ctx.fillStyle = palette.textMuted;
  ctx.globalAlpha = 0.9;
  ctx.fillText(market, padX + brandWidth + gap, padY);
  ctx.restore();

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
