import { ThemeMode } from '../types/chart';

export interface ChartThemePalette {
  mode: ThemeMode;
  background: string;
  backgroundSecondary: string;
  gridLine: string;
  axisBg: string;
  axisBorder: string;
  axisText: string;
  crosshairLine: string;
  crosshairLabelBg: string;
  crosshairLabelText: string;
  candleUp: string;
  candleUpWick: string;
  candleDown: string;
  candleDownWick: string;
  volumeUp: string;
  volumeDown: string;
  gold: string;
  goldBright: string;
  goldSoft: string;
  currentPriceLineUp: string;
  currentPriceLineDown: string;
  currentPriceText: string;
  replayLine: string;
  alertLine: string;
  textPrimary: string;
  textMuted: string;
  handleFill: string;
  handleStroke: string;
}

export const DARK_CHART_PALETTE: ChartThemePalette = {
  mode: 'dark',
  background: '#080808',
  backgroundSecondary: '#0E0E10',
  gridLine: 'rgba(255, 255, 255, 0.06)',
  axisBg: '#0B0B0D',
  axisBorder: 'rgba(255, 255, 255, 0.22)',
  axisText: '#A8A59E',
  crosshairLine: 'rgba(255, 255, 255, 0.45)',
  crosshairLabelBg: '#FFFFFF',
  crosshairLabelText: '#080808',
  candleUp: '#19B87D',
  candleUpWick: '#19B87D',
  candleDown: '#E54855',
  candleDownWick: '#E54855',
  volumeUp: 'rgba(25, 184, 125, 0.18)',
  volumeDown: 'rgba(229, 72, 85, 0.18)',
  gold: '#FFFFFF',
  goldBright: '#FFFFFF',
  goldSoft: 'rgba(255, 255, 255, 0.16)',
  currentPriceLineUp: '#19B87D',
  currentPriceLineDown: '#E54855',
  currentPriceText: '#FFFFFF',
  replayLine: '#FFFFFF',
  alertLine: '#FFFFFF',
  textPrimary: '#F5F5F7',
  textMuted: '#9A9892',
  handleFill: '#080808',
  handleStroke: '#FFFFFF',
};

export const LIGHT_CHART_PALETTE: ChartThemePalette = {
  mode: 'light',
  background: '#FAF8F3',
  backgroundSecondary: '#FFFFFF',
  gridLine: 'rgba(20, 19, 17, 0.07)',
  axisBg: '#F4F1E8',
  axisBorder: 'rgba(20, 19, 17, 0.22)',
  axisText: '#575248',
  crosshairLine: 'rgba(20, 19, 17, 0.48)',
  crosshairLabelBg: '#141311',
  crosshairLabelText: '#FFFFFF',
  candleUp: '#0F9D68',
  candleUpWick: '#0F9D68',
  candleDown: '#D63946',
  candleDownWick: '#D63946',
  volumeUp: 'rgba(15, 157, 104, 0.15)',
  volumeDown: 'rgba(214, 57, 70, 0.15)',
  gold: '#141311',
  goldBright: '#141311',
  goldSoft: 'rgba(20, 19, 17, 0.12)',
  currentPriceLineUp: '#0F9D68',
  currentPriceLineDown: '#D63946',
  currentPriceText: '#FFFFFF',
  replayLine: '#141311',
  alertLine: '#141311',
  textPrimary: '#141311',
  textMuted: '#625D52',
  handleFill: '#FFFFFF',
  handleStroke: '#141311',
};

export function getChartPalette(theme: ThemeMode): ChartThemePalette {
  return theme === 'dark' ? DARK_CHART_PALETTE : LIGHT_CHART_PALETTE;
}

export function applyThemeToDocument(theme: ThemeMode): void {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#080808');
  } else {
    root.classList.remove('dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#FAF8F3');
  }
}
