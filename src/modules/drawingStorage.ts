import {
  DrawingObject,
  FibLevelConfig,
  MarketSymbol,
  PriceAlert,
  ThemeMode,
  TimeframeId,
  ViewportState,
} from '../types/chart';
import { PRESET_FAVORITE_TOOL_IDS } from './drawingCatalogue';

export interface FibSettingsPreset {
  fibLevels: FibLevelConfig[];
  fibShowPrices: boolean;
  fibShowBackground: boolean;
  fibExtendRight: boolean;
  fibReverse: boolean;
}

export type FavoritesBarOrientation = 'landscape' | 'portrait';

const KEYS = {
  MARKET: 'lv_selected_market_v1',
  THEME: 'lv_theme_v1',
  TIMEFRAME_PREFIX: 'lv_timeframe_v1_',
  DRAWINGS_PREFIX: 'lv_drawings_v1_',
  VIEWPORT_PREFIX: 'lv_viewport_v1_',
  FAVORITES: 'lv_favorites_v1',
  SHOW_FAV_BAR: 'lv_show_favorites_bar_v1',
  FAV_BAR_POS: 'lv_fav_bar_pos_v1',
  FAV_BAR_ORIENTATION: 'lv_fav_bar_orientation_v1',
  PROP_BAR_POS: 'lv_prop_bar_pos_v1',
  ALERTS: 'lv_alerts_v1',
  FIB_PRESET: 'lv_fib_preset_v1',
};

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or restricted
  }
}

export function loadSelectedMarket(): MarketSymbol {
  const val = safeRead<string>(KEYS.MARKET, 'XAUUSD');
  return val === 'BTCUSD' ? 'BTCUSD' : 'XAUUSD';
}

export function saveSelectedMarket(market: MarketSymbol): void {
  safeWrite(KEYS.MARKET, market);
}

export function loadTheme(): ThemeMode {
  const val = safeRead<string>(KEYS.THEME, 'dark');
  return val === 'light' ? 'light' : 'dark';
}

export function saveTheme(theme: ThemeMode): void {
  safeWrite(KEYS.THEME, theme);
}

export function loadMarketTimeframe(market: MarketSymbol): TimeframeId {
  return safeRead<TimeframeId>(`${KEYS.TIMEFRAME_PREFIX}${market}`, '15m');
}

export function saveMarketTimeframe(market: MarketSymbol, tf: TimeframeId): void {
  safeWrite(`${KEYS.TIMEFRAME_PREFIX}${market}`, tf);
}

export function loadMarketDrawings(market: MarketSymbol): DrawingObject[] {
  const list = safeRead<DrawingObject[]>(`${KEYS.DRAWINGS_PREFIX}${market}`, []);
  return Array.isArray(list) ? list.filter((d) => d && d.market === market && Array.isArray(d.points)) : [];
}

export function saveMarketDrawings(market: MarketSymbol, drawings: DrawingObject[]): void {
  safeWrite(`${KEYS.DRAWINGS_PREFIX}${market}`, drawings);
}

export function loadMarketViewport(market: MarketSymbol): Partial<ViewportState> | null {
  return safeRead<Partial<ViewportState> | null>(`${KEYS.VIEWPORT_PREFIX}${market}`, null);
}

export function saveMarketViewport(market: MarketSymbol, viewport: ViewportState): void {
  safeWrite(`${KEYS.VIEWPORT_PREFIX}${market}`, {
    barSpacing: viewport.barSpacing,
    autoScaleY: viewport.autoScaleY,
  });
}

export function loadFavorites(): string[] {
  const stored = safeRead<string[] | null>(KEYS.FAVORITES, null);
  if (!stored || !Array.isArray(stored)) {
    return [...PRESET_FAVORITE_TOOL_IDS];
  }
  return stored;
}

export function saveFavorites(ids: string[]): void {
  safeWrite(KEYS.FAVORITES, ids);
}

export function loadShowFavoritesBar(): boolean {
  return safeRead<boolean>(KEYS.SHOW_FAV_BAR, false);
}

export function saveShowFavoritesBar(show: boolean): void {
  safeWrite(KEYS.SHOW_FAV_BAR, show);
}

export function loadFavoritesBarPosition(): { x: number; y: number } | null {
  return safeRead<{ x: number; y: number } | null>(KEYS.FAV_BAR_POS, null);
}

export function saveFavoritesBarPosition(pos: { x: number; y: number }): void {
  safeWrite(KEYS.FAV_BAR_POS, pos);
}

export function loadFavoritesBarOrientation(): FavoritesBarOrientation {
  const val = safeRead<string>(KEYS.FAV_BAR_ORIENTATION, 'landscape');
  return val === 'portrait' ? 'portrait' : 'landscape';
}

export function saveFavoritesBarOrientation(orientation: FavoritesBarOrientation): void {
  safeWrite(KEYS.FAV_BAR_ORIENTATION, orientation);
}

export function loadPropBarPosition(): { x: number; y: number } | null {
  return safeRead<{ x: number; y: number } | null>(KEYS.PROP_BAR_POS, null);
}

export function savePropBarPosition(pos: { x: number; y: number } | null): void {
  try {
    if (!pos) {
      localStorage.removeItem(KEYS.PROP_BAR_POS);
    } else {
      safeWrite(KEYS.PROP_BAR_POS, pos);
    }
  } catch {
    // ignore
  }
}

export function loadAlerts(): PriceAlert[] {
  const list = safeRead<PriceAlert[]>(KEYS.ALERTS, []);
  return Array.isArray(list) ? list : [];
}

export function saveAlerts(alerts: PriceAlert[]): void {
  safeWrite(KEYS.ALERTS, alerts);
}

export function loadFibSettingsPreset(): FibSettingsPreset | null {
  const stored = safeRead<Partial<FibSettingsPreset> | null>(KEYS.FIB_PRESET, null);
  if (!stored || !Array.isArray(stored.fibLevels) || stored.fibLevels.length === 0) {
    return null;
  }
  const cleanLevels = stored.fibLevels
    .filter((l) => l && typeof l.level === 'number' && Number.isFinite(l.level))
    .map((l) => ({
      level: l.level,
      enabled: Boolean(l.enabled),
      ...(typeof l.color === 'string' && l.color ? { color: l.color } : {}),
    }));
  if (cleanLevels.length === 0) return null;
  return {
    fibLevels: cleanLevels,
    fibShowPrices: stored.fibShowPrices !== false,
    fibShowBackground: stored.fibShowBackground !== false,
    fibExtendRight: Boolean(stored.fibExtendRight),
    fibReverse: Boolean(stored.fibReverse),
  };
}

export function saveFibSettingsPreset(preset: FibSettingsPreset): void {
  safeWrite(KEYS.FIB_PRESET, preset);
}
