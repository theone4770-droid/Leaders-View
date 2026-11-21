import { DateRangeId, MarketMeta, MarketSymbol, TimeframeId } from '../types/chart';

export const MARKETS: Record<MarketSymbol, MarketMeta> = {
  XAUUSD: {
    symbol: 'XAUUSD',
    description: 'GOLD SPOT / U.S. DOLLAR',
    decimals: 2,
    minTick: 0.01,
    providerLabel: 'XAU/USD SPOT FEED',
  },
  BTCUSD: {
    symbol: 'BTCUSD',
    description: 'BITCOIN / U.S. DOLLAR',
    decimals: 2,
    minTick: 0.01,
    providerLabel: 'BTC/USD SPOT FEED',
  },
};

export interface IntervalOption {
  id: TimeframeId;
  label: string;
  shortLabel: string;
  durationMs: number;
  section: 'SECONDS' | 'MINUTES' | 'HOURS' | 'HIGHER TIMEFRAMES';
}

export interface DateRangeOption {
  id: DateRangeId;
  label: string;
  targetInterval: TimeframeId;
  getStartTime: (nowMs: number) => number;
}

export const INTERVAL_SECTIONS: Array<{
  title: 'SECONDS' | 'MINUTES' | 'HOURS' | 'HIGHER TIMEFRAMES';
  items: IntervalOption[];
}> = [
  {
    title: 'SECONDS',
    items: [
      { id: '1s', label: '1 SECOND', shortLabel: '1s', durationMs: 1_000, section: 'SECONDS' },
      { id: '5s', label: '5 SECONDS', shortLabel: '5s', durationMs: 5_000, section: 'SECONDS' },
      { id: '10s', label: '10 SECONDS', shortLabel: '10s', durationMs: 10_000, section: 'SECONDS' },
      { id: '15s', label: '15 SECONDS', shortLabel: '15s', durationMs: 15_000, section: 'SECONDS' },
      { id: '30s', label: '30 SECONDS', shortLabel: '30s', durationMs: 30_000, section: 'SECONDS' },
      { id: '45s', label: '45 SECONDS', shortLabel: '45s', durationMs: 45_000, section: 'SECONDS' },
    ],
  },
  {
    title: 'MINUTES',
    items: [
      { id: '1m', label: '1 MINUTE', shortLabel: '1m', durationMs: 60_000, section: 'MINUTES' },
      { id: '2m', label: '2 MINUTES', shortLabel: '2m', durationMs: 120_000, section: 'MINUTES' },
      { id: '3m', label: '3 MINUTES', shortLabel: '3m', durationMs: 180_000, section: 'MINUTES' },
      { id: '5m', label: '5 MINUTES', shortLabel: '5m', durationMs: 300_000, section: 'MINUTES' },
      { id: '10m', label: '10 MINUTES', shortLabel: '10m', durationMs: 600_000, section: 'MINUTES' },
      { id: '15m', label: '15 MINUTES', shortLabel: '15m', durationMs: 900_000, section: 'MINUTES' },
      { id: '30m', label: '30 MINUTES', shortLabel: '30m', durationMs: 1_800_000, section: 'MINUTES' },
      { id: '45m', label: '45 MINUTES', shortLabel: '45m', durationMs: 2_700_000, section: 'MINUTES' },
    ],
  },
  {
    title: 'HOURS',
    items: [
      { id: '1h', label: '1 HOUR', shortLabel: '1H', durationMs: 3_600_000, section: 'HOURS' },
      { id: '2h', label: '2 HOURS', shortLabel: '2H', durationMs: 7_200_000, section: 'HOURS' },
      { id: '3h', label: '3 HOURS', shortLabel: '3H', durationMs: 10_800_000, section: 'HOURS' },
      { id: '4h', label: '4 HOURS', shortLabel: '4H', durationMs: 14_400_000, section: 'HOURS' },
    ],
  },
  {
    title: 'HIGHER TIMEFRAMES',
    items: [
      { id: '1D', label: '1 DAY', shortLabel: '1D', durationMs: 86_400_000, section: 'HIGHER TIMEFRAMES' },
      { id: '1W', label: '1 WEEK', shortLabel: '1W', durationMs: 604_800_000, section: 'HIGHER TIMEFRAMES' },
      { id: '1M', label: '1 MONTH', shortLabel: '1M', durationMs: 2_592_000_000, section: 'HIGHER TIMEFRAMES' },
      { id: '3M', label: '3 MONTHS', shortLabel: '3M', durationMs: 7_776_000_000, section: 'HIGHER TIMEFRAMES' },
      { id: '6M', label: '6 MONTHS', shortLabel: '6M', durationMs: 15_552_000_000, section: 'HIGHER TIMEFRAMES' },
      { id: '12M', label: '12 MONTHS', shortLabel: '12M', durationMs: 31_536_000_000, section: 'HIGHER TIMEFRAMES' },
    ],
  },
];

export const ALL_INTERVALS: IntervalOption[] = INTERVAL_SECTIONS.flatMap((s) => s.items);

export const INTERVAL_BY_ID: Record<TimeframeId, IntervalOption> = ALL_INTERVALS.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<TimeframeId, IntervalOption>
);

export const DATE_RANGES: DateRangeOption[] = [
  {
    id: '1D',
    label: '1 DAY',
    targetInterval: '5m',
    getStartTime: (now) => now - 86_400_000,
  },
  {
    id: '5D',
    label: '5 DAYS',
    targetInterval: '30m',
    getStartTime: (now) => now - 5 * 86_400_000,
  },
  {
    id: '1M',
    label: '1 MONTH',
    targetInterval: '2h',
    getStartTime: (now) => now - 30 * 86_400_000,
  },
  {
    id: '3M',
    label: '3 MONTHS',
    targetInterval: '4h',
    getStartTime: (now) => now - 90 * 86_400_000,
  },
  {
    id: '6M',
    label: '6 MONTHS',
    targetInterval: '1D',
    getStartTime: (now) => now - 180 * 86_400_000,
  },
  {
    id: 'YTD',
    label: 'YTD',
    targetInterval: '1D',
    getStartTime: (now) => {
      const d = new Date(now);
      return Date.UTC(d.getUTCFullYear(), 0, 1, 0, 0, 0, 0);
    },
  },
  {
    id: '1Y',
    label: '1 YEAR',
    targetInterval: '1D',
    getStartTime: (now) => now - 365 * 86_400_000,
  },
  {
    id: '3Y',
    label: '3 YEARS',
    targetInterval: '1W',
    getStartTime: (now) => now - 3 * 365 * 86_400_000,
  },
  {
    id: '5Y',
    label: '5 YEARS',
    targetInterval: '1W',
    getStartTime: (now) => now - 5 * 365 * 86_400_000,
  },
];

export function getIntervalDurationMs(interval: TimeframeId): number {
  return INTERVAL_BY_ID[interval]?.durationMs ?? 900_000;
}

export function getBucketStartTime(timestampMs: number, interval: TimeframeId): number {
  const d = new Date(timestampMs);
  if (interval === '1M') {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
  }
  if (interval === '3M') {
    const m = Math.floor(d.getUTCMonth() / 3) * 3;
    return Date.UTC(d.getUTCFullYear(), m, 1, 0, 0, 0, 0);
  }
  if (interval === '6M') {
    const m = Math.floor(d.getUTCMonth() / 6) * 6;
    return Date.UTC(d.getUTCFullYear(), m, 1, 0, 0, 0, 0);
  }
  if (interval === '12M') {
    return Date.UTC(d.getUTCFullYear(), 0, 1, 0, 0, 0, 0);
  }
  if (interval === '1W') {
    // Weeks begin Monday 00:00 UTC
    const day = d.getUTCDay();
    const diffToMonday = (day + 6) % 7;
    const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diffToMonday);
    return monday;
  }
  const dur = getIntervalDurationMs(interval);
  return Math.floor(timestampMs / dur) * dur;
}

export function getBucketEndTime(timestampMs: number, interval: TimeframeId): number {
  const d = new Date(timestampMs);
  if (interval === '1M') {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  }
  if (interval === '3M') {
    const m = Math.floor(d.getUTCMonth() / 3) * 3;
    return Date.UTC(d.getUTCFullYear(), m + 3, 1, 0, 0, 0, 0);
  }
  if (interval === '6M') {
    const m = Math.floor(d.getUTCMonth() / 6) * 6;
    return Date.UTC(d.getUTCFullYear(), m + 6, 1, 0, 0, 0, 0);
  }
  if (interval === '12M') {
    return Date.UTC(d.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0);
  }
  return getBucketStartTime(timestampMs, interval) + getIntervalDurationMs(interval);
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

const NY_MARKET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  hour12: false,
});

/**
 * Returns true when the given market is actively trading:
 * - BTCUSD: 24/7 crypto market (always open)
 * - XAUUSD: Spot Gold trades Sunday 18:00 through Friday 17:00 America/New_York
 *           with the daily 17:00-18:00 America/New_York rollover break.
 */
export function isMarketOpen(market: MarketSymbol, nowMs: number = Date.now()): boolean {
  if (market === 'BTCUSD') return true;
  const parts = NY_MARKET_FMT.formatToParts(new Date(nowMs));
  let weekday = '';
  let hour = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.type === 'weekday') weekday = p.value;
    else if (p.type === 'hour') hour = Number(p.value) % 24;
  }
  if (weekday === 'Sat') return false;
  if (weekday === 'Sun') return hour >= 18;
  if (weekday === 'Fri') return hour < 17;
  // Mon - Thu daily 1h rollover pause 17:00 - 17:59 ET
  return hour !== 17;
}

let cachedCountdownKey = '';
let cachedCountdownValue = '';

export function getCandleCountdownText(nowMs: number, interval: TimeframeId): string {
  const secBucket = Math.floor(nowMs / 1000);
  const key = `${interval}:${secBucket}`;
  if (key === cachedCountdownKey) {
    return cachedCountdownValue;
  }

  const endMs = getBucketEndTime(nowMs, interval);
  const remainingSec = Math.max(0, Math.floor((endMs - nowMs) / 1000));

  let result: string;
  if (remainingSec >= 86_400) {
    const days = Math.floor(remainingSec / 86_400);
    const hrs = Math.floor((remainingSec % 86_400) / 3600);
    const mins = Math.floor((remainingSec % 3600) / 60);
    result = `${days}d ${pad2(hrs)}:${pad2(mins)}`;
  } else if (remainingSec >= 3_600) {
    const hrs = Math.floor(remainingSec / 3600);
    const mins = Math.floor((remainingSec % 3600) / 60);
    const secs = remainingSec % 60;
    result = `${pad2(hrs)}:${pad2(mins)}:${pad2(secs)}`;
  } else {
    const mins = Math.floor(remainingSec / 60);
    const secs = remainingSec % 60;
    result = `${pad2(mins)}:${pad2(secs)}`;
  }

  cachedCountdownKey = key;
  cachedCountdownValue = result;
  return result;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatAxisTime(timestampMs: number, interval: TimeframeId): string {
  const d = new Date(timestampMs);
  const dur = getIntervalDurationMs(interval);

  if (dur < 60_000) {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
  if (dur < 86_400_000) {
    if (d.getHours() === 0 && d.getMinutes() === 0) {
      return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
    }
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  if (dur < 2_592_000_000) {
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  }
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatCrosshairTime(timestampMs: number, interval: TimeframeId): string {
  const d = new Date(timestampMs);
  const dateStr = `${pad2(d.getDate())} ${MONTHS_SHORT[d.getMonth()]} '${String(d.getFullYear()).slice(-2)}`;
  const dur = getIntervalDurationMs(interval);
  if (dur < 60_000) {
    return `${dateStr} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
  // Always display 24-hour clock format (00:00..23:59) across all timeframes
  return `${dateStr} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const PRICE_FORMATTERS = new Map<number, Intl.NumberFormat>();

export function formatPrice(price: number, decimals = 2): string {
  if (!Number.isFinite(price)) return '—';
  let fmt = PRICE_FORMATTERS.get(decimals);
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    PRICE_FORMATTERS.set(decimals, fmt);
  }
  return fmt.format(price);
}
