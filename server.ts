import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket, { WebSocketServer } from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type MarketSymbol = 'XAUUSD' | 'BTCUSD';
type ConnectionStatus = 'LIVE' | 'DELAYED' | 'DISCONNECTED';

interface Candle {
  time: number; // open time in ms (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TickerData {
  market: MarketSymbol;
  symbol: string;
  description: string;
  providerSymbol: string;
  price: number;
  open24h: number;
  change: number;
  changePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timestamp: number;
}

const MARKET_CONFIG: Record<
  MarketSymbol,
  { providerSymbol: string; streamKey: string; description: string }
> = {
  XAUUSD: {
    providerSymbol: 'XAUUSDT',
    streamKey: 'xauusdt',
    description: 'GOLD SPOT / U.S. DOLLAR',
  },
  BTCUSD: {
    providerSymbol: 'BTCUSDT',
    streamKey: 'btcusdt',
    description: 'BITCOIN / U.S. DOLLAR',
  },
};

const INTERVAL_MAP: Record<
  string,
  { native: string; bucketMs?: number; monthFactor?: number; durationMs: number }
> = {
  '1s': { native: '1s', durationMs: 1_000 },
  '5s': { native: '1s', bucketMs: 5_000, durationMs: 5_000 },
  '10s': { native: '1s', bucketMs: 10_000, durationMs: 10_000 },
  '15s': { native: '1s', bucketMs: 15_000, durationMs: 15_000 },
  '30s': { native: '1s', bucketMs: 30_000, durationMs: 30_000 },
  '45s': { native: '1s', bucketMs: 45_000, durationMs: 45_000 },
  '1m': { native: '1m', durationMs: 60_000 },
  '2m': { native: '1m', bucketMs: 120_000, durationMs: 120_000 },
  '3m': { native: '3m', durationMs: 180_000 },
  '5m': { native: '5m', durationMs: 300_000 },
  '10m': { native: '5m', bucketMs: 600_000, durationMs: 600_000 },
  '15m': { native: '15m', durationMs: 900_000 },
  '30m': { native: '30m', durationMs: 1_800_000 },
  '45m': { native: '15m', bucketMs: 2_700_000, durationMs: 2_700_000 },
  '1h': { native: '1h', durationMs: 3_600_000 },
  '2h': { native: '2h', durationMs: 7_200_000 },
  '3h': { native: '1h', bucketMs: 10_800_000, durationMs: 10_800_000 },
  '4h': { native: '4h', durationMs: 14_400_000 },
  '1D': { native: '1d', durationMs: 86_400_000 },
  '1W': { native: '1w', durationMs: 604_800_000 },
  '1M': { native: '1M', durationMs: 2_592_000_000 },
  '3M': { native: '1M', monthFactor: 3, durationMs: 7_776_000_000 },
  '6M': { native: '1M', monthFactor: 6, durationMs: 15_552_000_000 },
  '12M': { native: '1M', monthFactor: 12, durationMs: 31_536_000_000 },
};

const BINANCE_REST_BASES = [
  'https://data-api.binance.vision',
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
];

const binanceHostBlockedUntil = new Map<string, number>();

async function fetchSingleMirror<T>(base: string, endpointPath: string, timeoutMs: number): Promise<{ base: string; data: T }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${endpointPath}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      if (res.status === 418 || res.status === 451 || res.status === 403 || res.status === 429) {
        const cooldownMs = base === 'https://data-api.binance.vision' ? 90_000 : 10 * 60_000;
        binanceHostBlockedUntil.set(base, Date.now() + cooldownMs);
      }
      throw new Error(`HTTP ${res.status} from ${base}`);
    }
    const data = (await res.json()) as T;
    return { base, data };
  } finally {
    clearTimeout(timeout);
  }
}

let fapiFuturesBlockedUntil = 0;

async function fetchBinanceFuturesJson<T>(endpointPath: string): Promise<T> {
  if (Date.now() < fapiFuturesBlockedUntil) {
    throw new Error('Binance Futures REST temporarily in cooldown');
  }
  const base = 'https://fapi.binance.com';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch(`${base}${endpointPath}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      if (res.status === 451 || res.status === 403 || res.status === 418 || res.status === 429) {
        fapiFuturesBlockedUntil = Date.now() + 5 * 60_000;
      }
      throw new Error(`HTTP ${res.status} from ${base}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (fapiFuturesBlockedUntil < Date.now()) {
      fapiFuturesBlockedUntil = Date.now() + 5 * 60_000;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBinanceJson<T>(endpointPath: string): Promise<T> {
  const now = Date.now();
  let lastError: unknown;
  // Prioritize data-api.binance.vision first unless temporarily in 418/429 cooldown
  for (const base of BINANCE_REST_BASES) {
    if ((binanceHostBlockedUntil.get(base) || 0) > now) continue;
    const timeoutMs = base === 'https://data-api.binance.vision' ? 3600 : 2500;
    try {
      const res = await fetchSingleMirror<T>(base, endpointPath, timeoutMs);
      return res.data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('Market data mirror temporarily rate-limited');
}

function parseBinanceKlines(raw: unknown[][]): Candle[] {
  const seen = new Map<number, Candle>();
  for (const row of raw) {
    const time = Number(row[0]);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    if (
      Number.isFinite(time) &&
      Number.isFinite(open) &&
      Number.isFinite(high) &&
      Number.isFinite(low) &&
      Number.isFinite(close)
    ) {
      seen.set(time, { time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.time - b.time);
}

function parseCoinbaseCandles(raw: unknown[][]): Candle[] {
  const seen = new Map<number, Candle>();
  for (const row of raw) {
    // Coinbase format: [time_sec, low, high, open, close, volume]
    const timeSec = Number(row[0]);
    const low = Number(row[1]);
    const high = Number(row[2]);
    const open = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    if (
      Number.isFinite(timeSec) &&
      Number.isFinite(open) &&
      Number.isFinite(high) &&
      Number.isFinite(low) &&
      Number.isFinite(close)
    ) {
      const time = timeSec * 1000;
      seen.set(time, { time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.time - b.time);
}

function aggregateCandlesByMs(candles: Candle[], bucketMs: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const c of candles) {
    const bucketStart = Math.floor(c.time / bucketMs) * bucketMs;
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, {
        time: bucketStart,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume += c.volume;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

function aggregateCandlesByWeeks(candles: Candle[]): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const c of candles) {
    const d = new Date(c.time);
    const day = d.getUTCDay();
    const diffToMonday = (day + 6) % 7;
    const bucketStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diffToMonday);
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, {
        time: bucketStart,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume += c.volume;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

function aggregateCandlesByMonths(candles: Candle[], months: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const c of candles) {
    const d = new Date(c.time);
    const bucketMonth = Math.floor(d.getUTCMonth() / months) * months;
    const bucketStart = Date.UTC(d.getUTCFullYear(), bucketMonth, 1, 0, 0, 0, 0);
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, {
        time: bucketStart,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume += c.volume;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

// Spot Basis & Direct USD Price Calibration
let xauSpotPrice = 0;
let xauSpotUpdatedAt = 0;
let xauFuturesLastPrice = 0;
let xauBasisLocked = 0;
let xauBasisUpdatedAt = 0;
const xauSourceBasis: Record<string, number> = {};
let btcSpotPrice = 0;
let btcSpotUpdatedAt = 0;
let btcUsdtRefPrice = 0;
let btcUsdRatioLocked = 1;
let btcUsdRatioUpdatedAt = 0;

function updateXauSpotAnchor(spot: number, now = Date.now()): boolean {
  if (!Number.isFinite(spot) || spot <= 0) return false;
  // Reject isolated >1.5% single-poll outlier glitch if we have a recent spot anchor
  if (xauSpotPrice > 0 && now - xauSpotUpdatedAt < 120_000) {
    if (Math.abs(spot - xauSpotPrice) > xauSpotPrice * 0.015) {
      return false;
    }
  }
  xauSpotPrice = spot;
  xauSpotUpdatedAt = now;
  if (xauFuturesLastPrice > 0) {
    const rawDiff = spot - xauFuturesLastPrice;
    if (Math.abs(rawDiff) < spot * 0.05) {
      xauBasisLocked =
        xauBasisUpdatedAt > 0 && Math.abs(rawDiff - xauBasisLocked) < 2.5
          ? roundPrice(xauBasisLocked * 0.4 + rawDiff * 0.6)
          : roundPrice(rawDiff);
      xauBasisUpdatedAt = now;
    }
  }
  return true;
}

function getXauBasis(): number {
  if (xauBasisUpdatedAt > 0 && Date.now() - xauBasisUpdatedAt < 600_000) {
    return xauBasisLocked;
  }
  return 0;
}

function updateBtcUsdtCalibration(spotUsd: number, usdtPrice: number, now = Date.now()): void {
  if (spotUsd > 0 && usdtPrice > 0) {
    const ratio = spotUsd / usdtPrice;
    if (ratio > 0.95 && ratio < 1.05) {
      btcUsdRatioLocked = ratio;
      btcUsdRatioUpdatedAt = now;
    }
  }
}

function getBtcUsdRatio(): number {
  if (btcSpotPrice > 0 && btcUsdtRefPrice > 0 && Date.now() - btcSpotUpdatedAt < 600_000) {
    const ratio = btcSpotPrice / btcUsdtRefPrice;
    if (ratio > 0.95 && ratio < 1.05) {
      btcUsdRatioLocked = ratio;
      btcUsdRatioUpdatedAt = Date.now();
      return ratio;
    }
  }
  if (btcUsdRatioUpdatedAt > 0 && Date.now() - btcUsdRatioUpdatedAt < 600_000) {
    return btcUsdRatioLocked;
  }
  return 1;
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

async function fetchSwissquoteXauSpot(): Promise<number | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 2400);
  try {
    const res = await fetch('https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{
      spreadProfilePrices?: Array<{ spreadProfile?: string; bid?: number; ask?: number }>;
    }>;
    const profiles = data?.[0]?.spreadProfilePrices;
    if (!Array.isArray(profiles) || profiles.length === 0) return null;
    const picked =
      profiles.find((p) => p.spreadProfile === 'elite') ??
      profiles.find((p) => p.spreadProfile === 'prime') ??
      profiles[0];
    if (typeof picked.bid === 'number' && typeof picked.ask === 'number' && picked.bid > 0 && picked.ask > 0) {
      return roundPrice((picked.bid + picked.ask) / 2);
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchGoldApiSpot(): Promise<number | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 2400);
  try {
    const res = await fetch('https://api.gold-api.com/price/XAU', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { price?: number };
    if (typeof data?.price === 'number' && data.price > 0) {
      return roundPrice(data.price);
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchCoinbaseBtcStats(): Promise<{
  last: number;
  open: number;
  high: number;
  low: number;
  volume: number;
} | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 2400);
  try {
    const res = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/stats', {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'LeadersView/1.0' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      open?: string;
      high?: string;
      low?: string;
      last?: string;
      volume?: string;
    };
    const last = Number(data.last);
    if (!Number.isFinite(last) || last <= 0) return null;
    return {
      last: roundPrice(last),
      open: roundPrice(Number(data.open) || last),
      high: roundPrice(Number(data.high) || last),
      low: roundPrice(Number(data.low) || last),
      volume: Number(data.volume) || 0,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const COINBASE_GRANULARITY: Record<string, { gran: number; bucketMs?: number; weekAgg?: boolean; monthFactor?: number }> = {
  '1m': { gran: 60 },
  '2m': { gran: 60, bucketMs: 120_000 },
  '3m': { gran: 60, bucketMs: 180_000 },
  '5m': { gran: 300 },
  '10m': { gran: 300, bucketMs: 600_000 },
  '15m': { gran: 900 },
  '30m': { gran: 900, bucketMs: 1_800_000 },
  '45m': { gran: 900, bucketMs: 2_700_000 },
  '1h': { gran: 3600 },
  '2h': { gran: 3600, bucketMs: 7_200_000 },
  '3h': { gran: 3600, bucketMs: 10_800_000 },
  '4h': { gran: 3600, bucketMs: 14_400_000 },
  '1D': { gran: 86400 },
  '1W': { gran: 86400, weekAgg: true },
  '1M': { gran: 86400, monthFactor: 1 },
};

async function fetchCoinbaseBtcCandles(
  interval: string,
  limit = 350,
  endTime?: number,
  startTime?: number
): Promise<Candle[] | null> {
  const cbSpec = COINBASE_GRANULARITY[interval];
  if (!cbSpec) return null;
  const spec = INTERVAL_MAP[interval];
  if (!spec) return null;

  const clampedLimit = Math.max(20, Math.min(1000, limit));
  const multiplier = cbSpec.bucketMs
    ? Math.max(1, Math.round(cbSpec.bucketMs / (cbSpec.gran * 1000)))
    : cbSpec.weekAgg
      ? 7
      : cbSpec.monthFactor
        ? cbSpec.monthFactor * 30
        : 1;
  const totalBaseNeeded = Math.min(1400, clampedLimit * multiplier + multiplier);
  const pagesNeeded = Math.min(4, Math.ceil(totalBaseNeeded / 350));

  let cursorEndSec = endTime ? Math.floor(endTime / 1000) : Math.floor(Date.now() / 1000);
  let allBase: Candle[] = [];

  for (let p = 0; p < pagesNeeded; p++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const qs = new URLSearchParams({ granularity: String(cbSpec.gran) });
      if (p > 0 || endTime) {
        const spanSec = 340 * cbSpec.gran;
        const pageStartSec = startTime && pagesNeeded === 1
          ? Math.floor(startTime / 1000)
          : cursorEndSec - spanSec;
        qs.set('start', new Date(pageStartSec * 1000).toISOString());
        qs.set('end', new Date(cursorEndSec * 1000).toISOString());
      }
      const res = await fetch(`https://api.exchange.coinbase.com/products/BTC-USD/candles?${qs.toString()}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'LeadersView/1.0' },
      });
      if (!res.ok) return null;
      const raw = (await res.json()) as unknown[][];
      if (!Array.isArray(raw) || raw.length === 0) break;
      const parsed = parseCoinbaseCandles(raw);
      allBase = [...parsed, ...allBase];
      if (parsed.length < 200 || allBase.length >= totalBaseNeeded) break;
      cursorEndSec = Math.floor(parsed[0].time / 1000) - 1;
    } catch {
      return allBase.length > 0 ? allBase : null;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (allBase.length === 0) return null;

  const dedupedMap = new Map<number, Candle>();
  for (const c of allBase) {
    dedupedMap.set(c.time, c);
  }
  let result = Array.from(dedupedMap.values()).sort((a, b) => a.time - b.time);

  if (cbSpec.bucketMs) {
    result = aggregateCandlesByMs(result, cbSpec.bucketMs);
  } else if (cbSpec.weekAgg) {
    result = aggregateCandlesByWeeks(result);
  } else if (cbSpec.monthFactor) {
    result = aggregateCandlesByMonths(result, cbSpec.monthFactor);
  }

  if (result.length > clampedLimit) {
    result = result.slice(result.length - clampedLimit);
  }
  return result;
}

async function fetchCoinbaseBtcSubMinuteCandles(
  interval: string,
  limit = 350,
  endTime?: number
): Promise<Candle[]> {
  const spec = INTERVAL_MAP[interval];
  if (!spec) return [];
  const bucketMs = spec.bucketMs || spec.durationMs;
  const clampedLimit = Math.max(20, Math.min(1000, limit));
  const buckets = new Map<number, Candle>();

  if (!endTime) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2800);
      try {
        const res = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/trades?limit=1000', {
          signal: controller.signal,
          headers: { Accept: 'application/json', 'User-Agent': 'LeadersView/1.0' },
        });
        if (res.ok) {
          const trades = (await res.json()) as Array<{ time?: string; price?: string; size?: string }>;
          for (let i = trades.length - 1; i >= 0; i--) {
            const tr = trades[i];
            const ts = tr.time ? Date.parse(tr.time) : NaN;
            const price = Number(tr.price);
            const qty = Number(tr.size) || 0;
            if (!Number.isFinite(ts) || !Number.isFinite(price) || price <= 0) continue;
            const bTime = Math.floor(ts / bucketMs) * bucketMs;
            const ex = buckets.get(bTime);
            if (!ex) {
              buckets.set(bTime, { time: bTime, open: price, high: price, low: price, close: price, volume: qty });
            } else {
              if (price > ex.high) ex.high = price;
              if (price < ex.low) ex.low = price;
              ex.close = price;
              ex.volume += qty;
            }
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // ignore trade burst failure and rely on 1m expansion below
    }
  }

  let dense: Candle[] = Array.from(buckets.values()).sort((a, b) => a.time - b.time);
  if (dense.length < clampedLimit) {
    const neededBars = clampedLimit - dense.length;
    const neededMinutes = Math.min(350, Math.ceil((neededBars * bucketMs) / 60_000) + 5);
    const cb1m = await fetchCoinbaseBtcCandles('1m', neededMinutes, endTime);
    if (cb1m && cb1m.length > 0) {
      const subPerMin = Math.max(1, Math.round(60_000 / bucketMs));
      const expanded: Candle[] = [];
      const cutoff = dense.length > 0 ? dense[0].time : (endTime ? endTime + 1 : Number.MAX_SAFE_INTEGER);
      for (const m of cb1m) {
        const stepDelta = (m.close - m.open) / subPerMin;
        for (let s = 0; s < subPerMin; s++) {
          const t = m.time + s * bucketMs;
          if (t >= cutoff) break;
          const o = s === 0 ? m.open : m.open + stepDelta * s;
          const c = s === subPerMin - 1 ? m.close : m.open + stepDelta * (s + 1);
          const h = s === 0 ? Math.max(o, c, m.high) : Math.max(o, c);
          const l = s === subPerMin - 1 ? Math.min(o, c, m.low) : Math.min(o, c);
          expanded.push({
            time: t,
            open: roundPrice(o),
            high: roundPrice(h),
            low: roundPrice(l),
            close: roundPrice(c),
            volume: m.volume / subPerMin,
          });
        }
      }
      dense = [...expanded, ...dense];
    }
  }
  if (dense.length > clampedLimit) {
    dense = dense.slice(dense.length - clampedLimit);
  }
  return dense;
}

let spotInitPromise: Promise<void> | null = null;
async function ensureSpotCalibration(): Promise<void> {
  if (xauSpotPrice > 0 && btcSpotPrice > 0 && btcUsdtRefPrice > 0) return;
  if (!spotInitPromise) {
    spotInitPromise = (async () => {
      await Promise.all([
        (async () => {
          const [spot, fapi] = await Promise.all([
            fetchSwissquoteXauSpot().then(async (p) => p ?? (await fetchGoldApiSpot())),
            fetchBinanceFuturesJson<{ price?: string }>('/fapi/v1/ticker/price?symbol=XAUUSDT').catch(() => null),
          ]);
          if (fapi?.price && Number(fapi.price) > 0) {
            xauFuturesLastPrice = Number(fapi.price);
          }
          if (spot && spot > 0) {
            updateXauSpotAnchor(spot);
          }
        })(),
        (async () => {
          const [stats, btcUsdt] = await Promise.all([
            fetchCoinbaseBtcStats(),
            fetchBinanceJson<{ price?: string }>('/api/v3/ticker/price?symbol=BTCUSDT').catch(() => null),
          ]);
          if (btcUsdt?.price && Number(btcUsdt.price) > 0) {
            btcUsdtRefPrice = Number(btcUsdt.price);
          }
          if (stats && stats.last > 0) {
            btcSpotPrice = stats.last;
            btcSpotUpdatedAt = Date.now();
            if (btcUsdtRefPrice > 0) {
              updateBtcUsdtCalibration(btcSpotPrice, btcUsdtRefPrice);
            }
          }
        })(),
      ]);
    })().finally(() => {
      spotInitPromise = null;
    });
  }
  await Promise.race([spotInitPromise, new Promise((r) => setTimeout(r, 1500))]);
}

const OKX_BAR_MAP: Record<string, { bar: string; bucketMs?: number; monthFactor?: number; barMs: number }> = {
  '1m': { bar: '1m', barMs: 60_000 },
  '2m': { bar: '1m', bucketMs: 120_000, barMs: 60_000 },
  '3m': { bar: '3m', barMs: 180_000 },
  '5m': { bar: '5m', barMs: 300_000 },
  '10m': { bar: '5m', bucketMs: 600_000, barMs: 300_000 },
  '15m': { bar: '15m', barMs: 900_000 },
  '30m': { bar: '30m', barMs: 1_800_000 },
  '45m': { bar: '15m', bucketMs: 2_700_000, barMs: 900_000 },
  '1h': { bar: '1H', barMs: 3_600_000 },
  '2h': { bar: '2H', barMs: 7_200_000 },
  '3h': { bar: '1H', bucketMs: 10_800_000, barMs: 3_600_000 },
  '4h': { bar: '4H', barMs: 14_400_000 },
  '1D': { bar: '1Dutc', barMs: 86_400_000 },
  '1W': { bar: '1Wutc', barMs: 604_800_000 },
  '1M': { bar: '1Mutc', barMs: 2_592_000_000 },
  '3M': { bar: '1Mutc', monthFactor: 3, barMs: 2_592_000_000 },
  '6M': { bar: '1Mutc', monthFactor: 6, barMs: 2_592_000_000 },
  '12M': { bar: '1Mutc', monthFactor: 12, barMs: 2_592_000_000 },
};

let okxBlockedUntil = 0;

async function fetchOkxCandles(
  instId: 'XAU-USDT-SWAP' | 'BTC-USDT',
  interval: string,
  limit = 350,
  endTime?: number
): Promise<Candle[] | null> {
  if (Date.now() < okxBlockedUntil) return null;
  const okxSpec = OKX_BAR_MAP[interval];
  if (!okxSpec) return null;
  const spec = INTERVAL_MAP[interval];
  if (!spec) return null;

  const clampedLimit = Math.max(20, Math.min(1000, limit));
  const multiplier = okxSpec.bucketMs
    ? Math.max(1, Math.round(okxSpec.bucketMs / okxSpec.barMs))
    : okxSpec.monthFactor || 1;
  const totalNeeded = Math.min(1500, clampedLimit * multiplier + multiplier);
  const pageCap = endTime ? 100 : 300;
  const pagesNeeded = Math.min(6, Math.ceil(totalNeeded / pageCap));

  let allBase: Candle[] = [];
  let cursorAfter = endTime ? Math.floor(endTime) : undefined;

  for (let p = 0; p < pagesNeeded; p++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2200);
    try {
      const useHistoryEndpoint = Boolean(cursorAfter) && p > 0;
      const endpoint = useHistoryEndpoint ? 'history-candles' : 'candles';
      const reqLimit = Math.min(useHistoryEndpoint ? 100 : 300, totalNeeded - allBase.length);
      if (reqLimit <= 0) break;
      const qs = new URLSearchParams({
        instId,
        bar: okxSpec.bar,
        limit: String(reqLimit),
      });
      if (cursorAfter) {
        qs.set('after', String(cursorAfter));
      }
      const res = await fetch(`https://www.okx.com/api/v5/market/${endpoint}?${qs.toString()}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'LeadersView/1.0' },
      });
      if (!res.ok) {
        if (p === 0 && (res.status === 403 || res.status === 429 || res.status === 451)) {
          okxBlockedUntil = Date.now() + 5 * 60_000;
        }
        return allBase.length > 0 ? allBase : null;
      }
      const body = (await res.json()) as { code?: string; data?: string[][] };
      if (body.code !== '0' || !Array.isArray(body.data) || body.data.length === 0) break;
      const parsed: Candle[] = [];
      for (const row of body.data) {
        const time = Number(row[0]);
        const open = Number(row[1]);
        const high = Number(row[2]);
        const low = Number(row[3]);
        const close = Number(row[4]);
        const volume = Number(row[5]);
        if (
          Number.isFinite(time) &&
          Number.isFinite(open) &&
          Number.isFinite(high) &&
          Number.isFinite(low) &&
          Number.isFinite(close)
        ) {
          parsed.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
        }
      }
      if (parsed.length === 0) break;
      parsed.sort((a, b) => a.time - b.time);
      allBase = [...parsed, ...allBase];
      cursorAfter = parsed[0].time;
      if (parsed.length < reqLimit || allBase.length >= totalNeeded) break;
    } catch {
      if (p === 0) okxBlockedUntil = Date.now() + 5 * 60_000;
      return allBase.length > 0 ? allBase : null;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (allBase.length === 0) return null;
  const dedupedMap = new Map<number, Candle>();
  for (const c of allBase) dedupedMap.set(c.time, c);
  let result = Array.from(dedupedMap.values()).sort((a, b) => a.time - b.time);

  if (okxSpec.bucketMs) {
    result = aggregateCandlesByMs(result, okxSpec.bucketMs);
  } else if (okxSpec.monthFactor) {
    result = aggregateCandlesByMonths(result, okxSpec.monthFactor);
  }
  if (result.length > clampedLimit) {
    result = result.slice(result.length - clampedLimit);
  }
  return result;
}

async function fetchBinanceSpotPaxgCandles(
  interval: string,
  limit = 350,
  endTime?: number,
  startTime?: number
): Promise<Candle[]> {
  const spec = INTERVAL_MAP[interval];
  if (!spec) return [];
  const clampedLimit = Math.max(20, Math.min(1000, limit));
  const baseDur = INTERVAL_MAP[spec.native]?.durationMs || 1000;
  const multiplier = spec.bucketMs
    ? Math.max(1, Math.round(spec.bucketMs / baseDur))
    : spec.monthFactor || 1;
  const totalNeeded = Math.min(3000, clampedLimit * multiplier + multiplier);
  const pagesNeeded = Math.min(3, Math.ceil(totalNeeded / 1000));

  let allBase: Candle[] = [];
  let cursorEnd = endTime;

  for (let p = 0; p < pagesNeeded; p++) {
    const reqLimit = Math.min(1000, totalNeeded - allBase.length);
    if (reqLimit <= 0) break;
    const params = new URLSearchParams({
      symbol: 'PAXGUSDT',
      interval: spec.native,
      limit: String(reqLimit),
    });
    if (cursorEnd && Number.isFinite(cursorEnd)) {
      params.set('endTime', String(Math.floor(cursorEnd)));
    }
    if (startTime && Number.isFinite(startTime) && pagesNeeded === 1) {
      params.set('startTime', String(Math.floor(startTime)));
    }
    const raw = await fetchBinanceJson<unknown[][]>(`/api/v3/klines?${params.toString()}`);
    const parsed = parseBinanceKlines(raw);
    if (parsed.length === 0) break;
    allBase = [...parsed, ...allBase];
    cursorEnd = parsed[0].time - 1;
    if (parsed.length < reqLimit) break;
  }

  const dedupedMap = new Map<number, Candle>();
  for (const c of allBase) dedupedMap.set(c.time, c);
  let result = Array.from(dedupedMap.values()).sort((a, b) => a.time - b.time);

  if (spec.bucketMs) {
    result = aggregateCandlesByMs(result, spec.bucketMs);
  } else if (spec.monthFactor) {
    result = aggregateCandlesByMonths(result, spec.monthFactor);
  }
  if (result.length > clampedLimit) {
    result = result.slice(result.length - clampedLimit);
  }
  return result;
}

const KRAKEN_INTERVAL_MAP: Record<string, { krakenMin: number; bucketMs?: number; monthFactor?: number }> = {
  '1m': { krakenMin: 1 },
  '2m': { krakenMin: 1, bucketMs: 120_000 },
  '3m': { krakenMin: 1, bucketMs: 180_000 },
  '5m': { krakenMin: 5 },
  '10m': { krakenMin: 5, bucketMs: 600_000 },
  '15m': { krakenMin: 15 },
  '30m': { krakenMin: 30 },
  '45m': { krakenMin: 15, bucketMs: 2_700_000 },
  '1h': { krakenMin: 60 },
  '2h': { krakenMin: 60, bucketMs: 7_200_000 },
  '3h': { krakenMin: 60, bucketMs: 10_800_000 },
  '4h': { krakenMin: 240 },
  '1D': { krakenMin: 1440 },
  '1W': { krakenMin: 10080 },
  '1M': { krakenMin: 1440, monthFactor: 1 },
  '3M': { krakenMin: 1440, monthFactor: 3 },
  '6M': { krakenMin: 1440, monthFactor: 6 },
  '12M': { krakenMin: 1440, monthFactor: 12 },
};

async function fetchKrakenCandles(
  pair: 'PAXGUSD' | 'XBTUSD',
  interval: string,
  limit = 350,
  endTime?: number
): Promise<Candle[] | null> {
  const kSpec = KRAKEN_INTERVAL_MAP[interval];
  if (!kSpec) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3200);
  try {
    const qs = new URLSearchParams({
      pair,
      interval: String(kSpec.krakenMin),
    });
    const res = await fetch(`https://api.kraken.com/0/public/OHLC?${qs.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'LeadersView/1.0' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { error?: string[]; result?: Record<string, unknown> };
    const resultEntries = body.result ? Object.entries(body.result) : [];
    const seriesEntry = resultEntries.find(([k, v]) => k !== 'last' && Array.isArray(v));
    const rows = seriesEntry?.[1];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const parsed: Candle[] = [];
    for (const row of rows as Array<Array<string | number>>) {
      const time = Number(row[0]) * 1000;
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      const volume = Number(row[6]);
      if (endTime && time > endTime) continue;
      if (
        Number.isFinite(time) &&
        Number.isFinite(open) &&
        Number.isFinite(high) &&
        Number.isFinite(low) &&
        Number.isFinite(close)
      ) {
        parsed.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
      }
    }
    parsed.sort((a, b) => a.time - b.time);
    let result = parsed;
    if (kSpec.bucketMs) {
      result = aggregateCandlesByMs(result, kSpec.bucketMs);
    } else if (kSpec.monthFactor) {
      result = aggregateCandlesByMonths(result, kSpec.monthFactor);
    }
    const clampedLimit = Math.max(20, Math.min(1000, limit));
    if (result.length > clampedLimit) {
      result = result.slice(result.length - clampedLimit);
    }
    return result.length > 0 ? result : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const TWELVEDATA_INTERVAL_MAP: Record<string, { tdInterval: string; bucketMs?: number; monthFactor?: number }> = {
  '1m': { tdInterval: '1min' },
  '2m': { tdInterval: '1min', bucketMs: 120_000 },
  '3m': { tdInterval: '1min', bucketMs: 180_000 },
  '5m': { tdInterval: '5min' },
  '10m': { tdInterval: '5min', bucketMs: 600_000 },
  '15m': { tdInterval: '15min' },
  '30m': { tdInterval: '30min' },
  '45m': { tdInterval: '45min' },
  '1h': { tdInterval: '1h' },
  '2h': { tdInterval: '2h' },
  '3h': { tdInterval: '1h', bucketMs: 10_800_000 },
  '4h': { tdInterval: '4h' },
  '1D': { tdInterval: '1day' },
  '1W': { tdInterval: '1week' },
  '1M': { tdInterval: '1month' },
  '3M': { tdInterval: '1month', monthFactor: 3 },
  '6M': { tdInterval: '1month', monthFactor: 6 },
  '12M': { tdInterval: '1month', monthFactor: 12 },
};

async function fetchTwelveDataXauCandles(
  interval: string,
  limit = 350,
  endTime?: number
): Promise<Candle[] | null> {
  const apiKey = (process.env.TWELVEDATA_API_KEY || '').trim();
  if (!apiKey) return null;
  const tdSpec = TWELVEDATA_INTERVAL_MAP[interval];
  if (!tdSpec) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3200);
  try {
    const qs = new URLSearchParams({
      symbol: 'XAU/USD',
      interval: tdSpec.tdInterval,
      outputsize: String(Math.min(500, Math.max(40, limit))),
      timezone: 'UTC',
      apikey: apiKey,
    });
    if (endTime && Number.isFinite(endTime)) {
      qs.set('end_date', new Date(endTime).toISOString().replace('T', ' ').slice(0, 19));
    }
    const res = await fetch(`https://api.twelvedata.com/time_series?${qs.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      status?: string;
      values?: Array<{ datetime: string; open: string; high: string; low: string; close: string; volume?: string }>;
    };
    if (body.status === 'error' || !Array.isArray(body.values) || body.values.length === 0) return null;

    const parsed: Candle[] = [];
    for (const v of body.values) {
      const iso = v.datetime.includes('T') ? v.datetime : `${v.datetime.replace(' ', 'T')}Z`;
      const time = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
      const open = Number(v.open);
      const high = Number(v.high);
      const low = Number(v.low);
      const close = Number(v.close);
      const volume = Number(v.volume || 0);
      if (
        Number.isFinite(time) &&
        Number.isFinite(open) &&
        Number.isFinite(high) &&
        Number.isFinite(low) &&
        Number.isFinite(close)
      ) {
        parsed.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
      }
    }
    parsed.sort((a, b) => a.time - b.time);
    let result = parsed;
    if (tdSpec.bucketMs) {
      result = aggregateCandlesByMs(result, tdSpec.bucketMs);
    } else if (tdSpec.monthFactor) {
      result = aggregateCandlesByMonths(result, tdSpec.monthFactor);
    }
    return result.length > 0 ? result : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const MAX_LIVE_1S_BARS = 3600;
const live1sCandles: Record<MarketSymbol, Map<number, Candle>> = {
  XAUUSD: new Map(),
  BTCUSD: new Map(),
};

function recordLive1sTick(market: MarketSymbol, price: number, volume: number, timestampMs: number): void {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestampMs)) return;
  const bucketTime = Math.floor(timestampMs / 1000) * 1000;
  const map = live1sCandles[market];
  const existing = map.get(bucketTime);
  if (!existing) {
    let prevClose = price;
    for (const c of map.values()) {
      prevClose = c.close;
    }
    map.set(bucketTime, {
      time: bucketTime,
      open: prevClose,
      high: Math.max(prevClose, price),
      low: Math.min(prevClose, price),
      close: price,
      volume: Number.isFinite(volume) ? volume : 0,
    });
    if (map.size > MAX_LIVE_1S_BARS) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  } else {
    if (price > existing.high) existing.high = price;
    if (price < existing.low) existing.low = price;
    existing.close = price;
    if (Number.isFinite(volume) && volume > 0) existing.volume += volume;
  }
}

function getLive1sAggregated(market: MarketSymbol, bucketMs: number, endTime?: number): Candle[] {
  const map = live1sCandles[market];
  if (map.size === 0) return [];
  const raw = Array.from(map.values())
    .filter((c) => !endTime || c.time <= endTime)
    .sort((a, b) => a.time - b.time);
  if (raw.length === 0) return [];
  if (bucketMs === 1000) {
    // Fill short gaps seamlessly up to latest bar
    const filled: Candle[] = [];
    const startT = raw[0].time;
    const endT = raw[raw.length - 1].time;
    const byT = new Map<number, Candle>();
    for (const c of raw) byT.set(c.time, c);
    let prevClose = raw[0].open;
    for (let t = startT; t <= endT; t += 1000) {
      const hit = byT.get(t);
      if (hit) {
        filled.push({
          time: t,
          open: prevClose,
          high: Math.max(prevClose, hit.high),
          low: Math.min(prevClose, hit.low),
          close: hit.close,
          volume: hit.volume,
        });
        prevClose = hit.close;
      } else {
        filled.push({ time: t, open: prevClose, high: prevClose, low: prevClose, close: prevClose, volume: 0 });
      }
    }
    return filled;
  }
  return aggregateCandlesByMs(raw, bucketMs);
}

function buildDenseSubMinuteFromTrades(
  trades: Array<{ timeMs: number; price: number; volume: number }>,
  bucketMs: number
): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const t of trades) {
    if (!Number.isFinite(t.price) || !Number.isFinite(t.timeMs) || t.price <= 0) continue;
    const bTime = Math.floor(t.timeMs / bucketMs) * bucketMs;
    const ex = buckets.get(bTime);
    if (!ex) {
      buckets.set(bTime, {
        time: bTime,
        open: t.price,
        high: t.price,
        low: t.price,
        close: t.price,
        volume: Number.isFinite(t.volume) ? t.volume : 0,
      });
    } else {
      if (t.price > ex.high) ex.high = t.price;
      if (t.price < ex.low) ex.low = t.price;
      ex.close = t.price;
      ex.volume += Number.isFinite(t.volume) ? t.volume : 0;
    }
  }
  const sortedTimes = Array.from(buckets.keys()).sort((a, b) => a - b);
  if (sortedTimes.length === 0) return [];
  const startB = sortedTimes[0];
  const endB = sortedTimes[sortedTimes.length - 1];
  const dense: Candle[] = [];
  let prevClose = buckets.get(startB)!.open;
  for (let t = startB; t <= endB; t += bucketMs) {
    const existing = buckets.get(t);
    if (existing) {
      const cOpen = prevClose;
      dense.push({
        time: t,
        open: cOpen,
        high: Math.max(cOpen, existing.high),
        low: Math.min(cOpen, existing.low),
        close: existing.close,
        volume: existing.volume,
      });
      prevClose = existing.close;
    } else {
      dense.push({
        time: t,
        open: prevClose,
        high: prevClose,
        low: prevClose,
        close: prevClose,
        volume: 0,
      });
    }
  }
  return dense;
}

function expand1mCandlesToSubMinute(bars1m: Candle[], bucketMs: number, cutoffMs: number): Candle[] {
  if (bars1m.length === 0) return [];
  const subPerMin = Math.max(1, Math.round(60_000 / bucketMs));
  const expanded: Candle[] = [];
  for (const m of bars1m) {
    const stepDelta = (m.close - m.open) / subPerMin;
    for (let s = 0; s < subPerMin; s++) {
      const t = m.time + s * bucketMs;
      if (t >= cutoffMs) break;
      const o = s === 0 ? m.open : m.open + stepDelta * s;
      const c = s === subPerMin - 1 ? m.close : m.open + stepDelta * (s + 1);
      const h = s === 0 ? Math.max(o, c, m.high) : Math.max(o, c);
      const l = s === subPerMin - 1 ? Math.min(o, c, m.low) : Math.min(o, c);
      expanded.push({
        time: t,
        open: roundPrice(o),
        high: roundPrice(h),
        low: roundPrice(l),
        close: roundPrice(c),
        volume: m.volume / subPerMin,
      });
    }
  }
  return expanded;
}

async function fetchOkxTrades(instId: 'XAU-USDT-SWAP' | 'BTC-USDT'): Promise<Array<{ timeMs: number; price: number; volume: number }>> {
  if (Date.now() < okxBlockedUntil) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2400);
  try {
    const res = await fetch(`https://www.okx.com/api/v5/market/trades?instId=${instId}&limit=500`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'LeadersView/1.0' },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      code?: string;
      data?: Array<{ px?: string; sz?: string; ts?: string }>;
    };
    if (body.code !== '0' || !Array.isArray(body.data)) return [];
    const out: Array<{ timeMs: number; price: number; volume: number }> = [];
    for (let i = body.data.length - 1; i >= 0; i--) {
      const row = body.data[i];
      const price = Number(row.px);
      const volume = Number(row.sz) || 0;
      const timeMs = Number(row.ts);
      if (Number.isFinite(price) && price > 0 && Number.isFinite(timeMs)) {
        out.push({ timeMs, price, volume });
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchKrakenTrades(pair: 'PAXGUSD' | 'XBTUSD'): Promise<Array<{ timeMs: number; price: number; volume: number }>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2600);
  try {
    const res = await fetch(`https://api.kraken.com/0/public/Trades?pair=${pair}&count=500`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'LeadersView/1.0' },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { result?: Record<string, unknown> };
    const entries = body.result ? Object.entries(body.result) : [];
    const series = entries.find(([k, v]) => k !== 'last' && Array.isArray(v));
    const rows = series?.[1];
    if (!Array.isArray(rows)) return [];
    const out: Array<{ timeMs: number; price: number; volume: number }> = [];
    for (const r of rows as Array<Array<string | number>>) {
      const price = Number(r[0]);
      const volume = Number(r[1]) || 0;
      const timeMs = Math.floor(Number(r[2]) * 1000);
      if (Number.isFinite(price) && price > 0 && Number.isFinite(timeMs)) {
        out.push({ timeMs, price, volume });
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchXauSubMinuteCandles(
  interval: string,
  limit = 350,
  endTime?: number
): Promise<{ candles: Candle[]; source: string }> {
  const spec = INTERVAL_MAP[interval];
  if (!spec) return { candles: [], source: 'xauusdt' };
  const bucketMs = spec.bucketMs || spec.durationMs;
  const clampedLimit = Math.max(20, Math.min(1000, limit));

  // 1. Primary Binance Futures XAUUSDT aggTrades + 1m expansion (when not geo-blocked)
  if (Date.now() >= fapiFuturesBlockedUntil) {
    try {
      const maxPages = interval === '1s' ? 2 : 1;
      let allTrades: Array<{ a: number; p: string; q: string; T: number }> = [];
      let fromId: number | undefined;

      if (!endTime) {
        for (let p = 0; p < maxPages; p++) {
          const qs = fromId
            ? `symbol=XAUUSDT&limit=1000&fromId=${fromId}`
            : `symbol=XAUUSDT&limit=1000`;
          const batch = await fetchBinanceFuturesJson<Array<{ a: number; p: string; q: string; T: number }>>(
            `/fapi/v1/aggTrades?${qs}`
          );
          if (!Array.isArray(batch) || batch.length === 0) break;
          allTrades = [...batch, ...allTrades];
          const firstId = batch[0].a;
          if (firstId <= 1 || batch.length < 1000) break;
          fromId = Math.max(1, firstId - 1000);
        }
      }

      let dense = buildDenseSubMinuteFromTrades(
        allTrades.map((t) => ({ timeMs: Number(t.T), price: Number(t.p), volume: Number(t.q) || 0 })),
        bucketMs
      );

      if (dense.length < clampedLimit) {
        const neededBars = clampedLimit - dense.length;
        const neededMinutes = Math.min(1000, Math.ceil((neededBars * bucketMs) / 60_000) + 5);
        const beforeMs = dense.length > 0 ? dense[0].time - 1 : endTime;
        const qs = new URLSearchParams({
          symbol: 'XAUUSDT',
          interval: '1m',
          limit: String(Math.max(20, neededMinutes)),
        });
        if (beforeMs && Number.isFinite(beforeMs)) {
          qs.set('endTime', String(Math.floor(beforeMs)));
        }
        const raw1m = await fetchBinanceFuturesJson<unknown[][]>(`/fapi/v1/klines?${qs.toString()}`);
        const parsed1m = parseBinanceKlines(raw1m);
        const cutoff = dense.length > 0 ? dense[0].time : (endTime ? endTime + 1 : Number.MAX_SAFE_INTEGER);
        const expanded = expand1mCandlesToSubMinute(parsed1m, bucketMs, cutoff);
        dense = [...expanded, ...dense];
      }

      if (dense.length > clampedLimit) {
        dense = dense.slice(dense.length - clampedLimit);
      }
      if (dense.length >= 20) {
        return { candles: dense, source: 'xauusdt' };
      }
    } catch {
      // Fall through cleanly to OKX / Binance Data CDN / Kraken
    }
  }

  // 2. Cloud-safe OKX XAU-USDT-SWAP perpetual trades + 1m expansion (works reliably across 1s..45s on Cloud Run)
  if (Date.now() >= okxBlockedUntil) {
    try {
      let dense: Candle[] = [];
      if (!endTime) {
        const trades = await fetchOkxTrades('XAU-USDT-SWAP');
        dense = buildDenseSubMinuteFromTrades(trades, bucketMs);
      }
      if (dense.length < clampedLimit) {
        const neededBars = clampedLimit - dense.length;
        const neededMinutes = Math.min(350, Math.ceil((neededBars * bucketMs) / 60_000) + 5);
        const beforeMs = dense.length > 0 ? dense[0].time - 1 : endTime;
        const okx1m = await fetchOkxCandles('XAU-USDT-SWAP', '1m', Math.max(20, neededMinutes), beforeMs);
        if (okx1m && okx1m.length > 0) {
          const cutoff = dense.length > 0 ? dense[0].time : (endTime ? endTime + 1 : Number.MAX_SAFE_INTEGER);
          const expanded = expand1mCandlesToSubMinute(okx1m, bucketMs, cutoff);
          dense = [...expanded, ...dense];
        }
      }
      if (dense.length > clampedLimit) {
        dense = dense.slice(dense.length - clampedLimit);
      }
      if (dense.length >= 20) {
        return { candles: dense, source: 'okx_xau' };
      }
    } catch {
      // Fall through to Binance PAXGUSDT / Kraken
    }
  }

  // 3. Binance Spot PAXGUSDT (1s head + 1m backfill, wrapped so HTTP 418 never crashes)
  try {
    let dense: Candle[] = [];
    if (interval === '1s' || interval === '5s') {
      const qs = new URLSearchParams({
        symbol: 'PAXGUSDT',
        interval: '1s',
        limit: String(Math.min(1000, clampedLimit * Math.max(1, Math.round(bucketMs / 1000)))),
      });
      if (endTime && Number.isFinite(endTime)) {
        qs.set('endTime', String(Math.floor(endTime)));
      }
      const raw1s = await fetchBinanceJson<unknown[][]>(`/api/v3/klines?${qs.toString()}`);
      const parsed1s = parseBinanceKlines(raw1s);
      dense = bucketMs > 1000 ? aggregateCandlesByMs(parsed1s, bucketMs) : parsed1s;
    }
    if (dense.length < clampedLimit) {
      const neededBars = clampedLimit - dense.length;
      const neededMinutes = Math.min(350, Math.ceil((neededBars * bucketMs) / 60_000) + 5);
      const beforeMs = dense.length > 0 ? dense[0].time - 1 : endTime;
      const qs1m = new URLSearchParams({
        symbol: 'PAXGUSDT',
        interval: '1m',
        limit: String(Math.max(20, neededMinutes)),
      });
      if (beforeMs && Number.isFinite(beforeMs)) {
        qs1m.set('endTime', String(Math.floor(beforeMs)));
      }
      const raw1m = await fetchBinanceJson<unknown[][]>(`/api/v3/klines?${qs1m.toString()}`);
      const parsed1m = parseBinanceKlines(raw1m);
      const cutoff = dense.length > 0 ? dense[0].time : (endTime ? endTime + 1 : Number.MAX_SAFE_INTEGER);
      const expanded = expand1mCandlesToSubMinute(parsed1m, bucketMs, cutoff);
      dense = [...expanded, ...dense];
    }
    if (dense.length > clampedLimit) {
      dense = dense.slice(dense.length - clampedLimit);
    }
    if (dense.length >= 20) {
      return { candles: dense, source: 'paxgusdt' };
    }
  } catch {
    // Binance rate-limited / 418 -> fall through cleanly to Kraken
  }

  // 4. US-regulated Kraken PAXG/USD trades + 1m expansion
  try {
    let dense: Candle[] = [];
    if (!endTime) {
      const trades = await fetchKrakenTrades('PAXGUSD');
      dense = buildDenseSubMinuteFromTrades(trades, bucketMs);
    }
    if (dense.length < clampedLimit) {
      const neededBars = clampedLimit - dense.length;
      const neededMinutes = Math.min(720, Math.ceil((neededBars * bucketMs) / 60_000) + 5);
      const beforeMs = dense.length > 0 ? dense[0].time - 1 : endTime;
      const kraken1m = await fetchKrakenCandles('PAXGUSD', '1m', Math.max(20, neededMinutes), beforeMs);
      if (kraken1m && kraken1m.length > 0) {
        const cutoff = dense.length > 0 ? dense[0].time : (endTime ? endTime + 1 : Number.MAX_SAFE_INTEGER);
        const expanded = expand1mCandlesToSubMinute(kraken1m, bucketMs, cutoff);
        dense = [...expanded, ...dense];
      }
    }
    if (dense.length > clampedLimit) {
      dense = dense.slice(dense.length - clampedLimit);
    }
    if (dense.length > 0) {
      return { candles: dense, source: 'kraken_paxg' };
    }
  } catch {
    // Fall through to live 1s buffer
  }

  // 5. Final resilience fallback: server's in-memory recorded live 1s ticks
  const liveFallback = getLive1sAggregated('XAUUSD', bucketMs, endTime);
  if (liveFallback.length > 0) {
    return {
      candles: liveFallback.length > clampedLimit ? liveFallback.slice(-clampedLimit) : liveFallback,
      source: 'spot_live',
    };
  }

  return { candles: [], source: 'xauusdt' };
}

async function fetchHistoricalCandles(
  market: MarketSymbol,
  interval: string,
  limit = 350,
  endTime?: number,
  startTime?: number
): Promise<Candle[]> {
  const cfg = MARKET_CONFIG[market];
  const spec = INTERVAL_MAP[interval];
  if (!cfg || !spec) {
    throw new Error(`Unsupported market (${market}) or interval (${interval})`);
  }

  await ensureSpotCalibration();

  // For BTCUSD, prefer direct Coinbase Spot BTC-USD historical candles whenever supported
  if (market === 'BTCUSD' && COINBASE_GRANULARITY[interval]) {
    const cbCandles = await fetchCoinbaseBtcCandles(interval, limit, endTime, startTime);
    if (cbCandles && cbCandles.length > 0) {
      if (!endTime && !startTime) {
        const last = cbCandles[cbCandles.length - 1];
        const liveBtc = liveTickers.BTCUSD?.price || btcSpotPrice;
        if (liveBtc > 0) {
          last.close = liveBtc;
          last.high = Math.max(last.high, liveBtc);
          last.low = Math.min(last.low, liveBtc);
        }
      }
      return cbCandles;
    }
  }

  const clampedLimit = Math.max(20, Math.min(1000, limit));
  let result: Candle[] = [];
  let xauSource = 'xauusdt';
  let btcSource: 'binance_usdt' | 'coinbase_usd' | 'okx_usdt' | 'kraken_usd' | 'spot_live' = 'binance_usdt';

  if (market === 'XAUUSD' && spec.native === '1s') {
    const sub = await fetchXauSubMinuteCandles(interval, clampedLimit, endTime);
    result = sub.candles;
    xauSource = sub.source;
  } else if (market === 'XAUUSD') {
    // 0. Optional TwelveData native XAU/USD forex spot candles when TWELVEDATA_API_KEY is configured
    const tdCandles = await fetchTwelveDataXauCandles(interval, clampedLimit, endTime);
    if (tdCandles && tdCandles.length > 0) {
      result = tdCandles;
      xauSource = 'twelvedata';
    }

    // 1. Primary Binance Futures XAUUSDT when accessible
    if (result.length === 0) {
      try {
        const multiplier = spec.bucketMs
          ? Math.max(1, Math.round(spec.bucketMs / (INTERVAL_MAP[spec.native]?.durationMs || 1000)))
          : spec.monthFactor || 1;
        const totalNeeded = Math.min(3000, clampedLimit * multiplier + multiplier);
        const pagesNeeded = Math.min(3, Math.ceil(totalNeeded / 1000));
        let allBase: Candle[] = [];
        let cursorEnd = endTime;

        for (let p = 0; p < pagesNeeded; p++) {
          const reqLimit = Math.min(1000, totalNeeded - allBase.length);
          if (reqLimit <= 0) break;
          const params = new URLSearchParams({
            symbol: cfg.providerSymbol,
            interval: spec.native,
            limit: String(reqLimit),
          });
          if (cursorEnd && Number.isFinite(cursorEnd)) {
            params.set('endTime', String(Math.floor(cursorEnd)));
          }
          if (startTime && Number.isFinite(startTime) && pagesNeeded === 1) {
            params.set('startTime', String(Math.floor(startTime)));
          }
          const raw = await fetchBinanceFuturesJson<unknown[][]>(`/fapi/v1/klines?${params.toString()}`);
          const parsed = parseBinanceKlines(raw);
          if (parsed.length === 0) break;
          allBase = [...parsed, ...allBase];
          cursorEnd = parsed[0].time - 1;
          if (parsed.length < reqLimit) break;
        }

        const dedupedMap = new Map<number, Candle>();
        for (const c of allBase) dedupedMap.set(c.time, c);
        result = Array.from(dedupedMap.values()).sort((a, b) => a.time - b.time);
        if (spec.bucketMs) {
          result = aggregateCandlesByMs(result, spec.bucketMs);
        } else if (spec.monthFactor) {
          result = aggregateCandlesByMonths(result, spec.monthFactor);
        }
        if (result.length > clampedLimit) {
          result = result.slice(result.length - clampedLimit);
        }
        xauSource = 'xauusdt';
      } catch {
        // Futures REST unavailable on restricted cloud IPs -> fall through to unrestricted mirrors
      }
    }

    // 2. Fallback to OKX XAU-USDT-SWAP perpetual candles
    if (result.length === 0) {
      const okxCandles = await fetchOkxCandles('XAU-USDT-SWAP', interval, clampedLimit, endTime);
      if (okxCandles && okxCandles.length > 0) {
        result = okxCandles;
        xauSource = 'okx_xau';
      }
    }

    // 3. Fallback to unrestricted Binance Public Data CDN (PAXGUSDT physical 1:1 gold benchmark)
    if (result.length === 0) {
      try {
        const paxgCandles = await fetchBinanceSpotPaxgCandles(interval, clampedLimit, endTime, startTime);
        if (paxgCandles.length > 0) {
          result = paxgCandles;
          xauSource = 'paxgusdt';
        }
      } catch {
        // Fall through to Kraken
      }
    }

    // 4. Final fallback to US-regulated Kraken Spot PAXG/USD
    if (result.length === 0) {
      const krakenCandles = await fetchKrakenCandles('PAXGUSD', interval, clampedLimit, endTime);
      if (krakenCandles && krakenCandles.length > 0) {
        result = krakenCandles;
        xauSource = 'kraken_paxg';
      }
    }
  } else {
    // BTCUSD multi-provider fallback chain (Binance Data CDN -> Coinbase sub-min -> OKX BTC-USDT -> Kraken XBTUSD)
    const multiplier = spec.bucketMs
      ? Math.max(1, Math.round(spec.bucketMs / (INTERVAL_MAP[spec.native]?.durationMs || 1000)))
      : spec.monthFactor || 1;

    if (spec.native === '1s') {
      const bucketMs = spec.bucketMs || spec.durationMs;
      // Avoid 3-page 1s bursts on Binance (prevents HTTP 418 bans); use Coinbase USD directly when non-1s or if Binance is cooled down
      if (interval === '1s') {
        try {
          const qs = new URLSearchParams({
            symbol: cfg.providerSymbol,
            interval: '1s',
            limit: String(Math.min(1000, clampedLimit)),
          });
          if (endTime && Number.isFinite(endTime)) {
            qs.set('endTime', String(Math.floor(endTime)));
          }
          const raw = await fetchBinanceJson<unknown[][]>(`/api/v3/klines?${qs.toString()}`);
          result = parseBinanceKlines(raw);
          btcSource = 'binance_usdt';
        } catch {
          // Fall through to Coinbase / OKX / Kraken
        }
      }
      if (result.length === 0) {
        const cbSub = await fetchCoinbaseBtcSubMinuteCandles(interval, clampedLimit, endTime);
        if (cbSub.length > 0) {
          result = cbSub;
          btcSource = 'coinbase_usd';
        }
      }
      if (result.length === 0) {
        const okx1m = await fetchOkxCandles('BTC-USDT', '1m', Math.min(350, Math.ceil((clampedLimit * bucketMs) / 60_000) + 5), endTime);
        if (okx1m && okx1m.length > 0) {
          const expanded = expand1mCandlesToSubMinute(okx1m, bucketMs, endTime ? endTime + 1 : Number.MAX_SAFE_INTEGER);
          result = expanded.length > clampedLimit ? expanded.slice(-clampedLimit) : expanded;
          btcSource = 'okx_usdt';
        }
      }
      if (result.length === 0) {
        const kraken1m = await fetchKrakenCandles('XBTUSD', '1m', Math.min(720, Math.ceil((clampedLimit * bucketMs) / 60_000) + 5), endTime);
        if (kraken1m && kraken1m.length > 0) {
          const expanded = expand1mCandlesToSubMinute(kraken1m, bucketMs, endTime ? endTime + 1 : Number.MAX_SAFE_INTEGER);
          result = expanded.length > clampedLimit ? expanded.slice(-clampedLimit) : expanded;
          btcSource = 'kraken_usd';
        }
      }
      if (result.length === 0) {
        const liveFallback = getLive1sAggregated('BTCUSD', bucketMs, endTime);
        if (liveFallback.length > 0) {
          result = liveFallback.length > clampedLimit ? liveFallback.slice(-clampedLimit) : liveFallback;
          btcSource = 'spot_live';
        }
      }
    } else {
      try {
        const totalNeeded = Math.min(3000, clampedLimit * multiplier + multiplier);
        const pagesNeeded = Math.min(3, Math.ceil(totalNeeded / 1000));
        let allBase: Candle[] = [];
        let cursorEnd = endTime;

        for (let p = 0; p < pagesNeeded; p++) {
          const reqLimit = Math.min(1000, totalNeeded - allBase.length);
          if (reqLimit <= 0) break;
          const params = new URLSearchParams({
            symbol: cfg.providerSymbol,
            interval: spec.native,
            limit: String(reqLimit),
          });
          if (cursorEnd && Number.isFinite(cursorEnd)) {
            params.set('endTime', String(Math.floor(cursorEnd)));
          }
          if (startTime && Number.isFinite(startTime) && pagesNeeded === 1) {
            params.set('startTime', String(Math.floor(startTime)));
          }
          const raw = await fetchBinanceJson<unknown[][]>(`/api/v3/klines?${params.toString()}`);
          const parsed = parseBinanceKlines(raw);
          if (parsed.length === 0) break;
          allBase = [...parsed, ...allBase];
          cursorEnd = parsed[0].time - 1;
          if (parsed.length < reqLimit) break;
        }

        const dedupedMap = new Map<number, Candle>();
        for (const c of allBase) {
          dedupedMap.set(c.time, c);
        }
        result = Array.from(dedupedMap.values()).sort((a, b) => a.time - b.time);

        if (spec.bucketMs) {
          result = aggregateCandlesByMs(result, spec.bucketMs);
        } else if (spec.monthFactor) {
          result = aggregateCandlesByMonths(result, spec.monthFactor);
        }
        if (result.length > clampedLimit) {
          result = result.slice(result.length - clampedLimit);
        }
        btcSource = 'binance_usdt';
      } catch {
        // Binance failed/rate-limited on shared cloud IP -> fall through to OKX/Kraken
      }

      if (result.length === 0) {
        const okxBtc = await fetchOkxCandles('BTC-USDT', interval, clampedLimit, endTime);
        if (okxBtc && okxBtc.length > 0) {
          result = okxBtc;
          btcSource = 'okx_usdt';
        }
      }

      if (result.length === 0) {
        const krakenBtc = await fetchKrakenCandles('XBTUSD', interval, clampedLimit, endTime);
        if (krakenBtc && krakenBtc.length > 0) {
          result = krakenBtc;
          btcSource = 'kraken_usd';
        }
      }
    }
  }

  // Apply live Spot USD calibration so XAUUSD matches real Spot Gold and BTCUSD matches real BTC/USD
  if (result.length > 0) {
    if (market === 'XAUUSD') {
      const rawLast = result[result.length - 1].close;
      const targetSpot = liveTickers.XAUUSD?.price || xauSpotPrice;
      let basis = xauSourceBasis[xauSource] ?? 0;

      if (xauSource === 'twelvedata' || xauSource === 'spot_live') {
        basis = 0;
      } else if (!endTime && !startTime && targetSpot > 0 && rawLast > 0) {
        const diff = targetSpot - rawLast;
        if (Math.abs(diff) < targetSpot * 0.05) {
          basis = roundPrice(diff);
          xauSourceBasis[xauSource] = basis;
        }
        if (xauSource === 'xauusdt') {
          xauFuturesLastPrice = rawLast;
          if (xauSpotPrice > 0 && xauBasisUpdatedAt === 0) {
            xauBasisLocked = basis;
            xauBasisUpdatedAt = Date.now();
          }
        }
      } else if ((xauSource === 'xauusdt' || xauSource === 'okx_xau') && basis === 0) {
        basis = getXauBasis();
      }

      if (basis !== 0) {
        result = result.map((c) => ({
          ...c,
          open: roundPrice(c.open + basis),
          high: roundPrice(c.high + basis),
          low: roundPrice(c.low + basis),
          close: roundPrice(c.close + basis),
        }));
      }
      if (!endTime && !startTime && targetSpot > 0) {
        const last = result[result.length - 1];
        last.close = targetSpot;
        last.high = Math.max(last.high, targetSpot);
        last.low = Math.min(last.low, targetSpot);
      }
    } else if (market === 'BTCUSD') {
      const isUsdtFeed = btcSource === 'binance_usdt' || btcSource === 'okx_usdt';
      const rawLast = result[result.length - 1].close;
      if (isUsdtFeed && !endTime && !startTime && rawLast > 0) {
        btcUsdtRefPrice = rawLast;
      }
      const targetBtc = liveTickers.BTCUSD?.price || btcSpotPrice;
      let ratio = isUsdtFeed ? getBtcUsdRatio() : 1;
      if (isUsdtFeed && !endTime && !startTime && targetBtc > 0 && rawLast > 0) {
        const directRatio = targetBtc / rawLast;
        if (directRatio > 0.95 && directRatio < 1.05) {
          ratio = directRatio;
          updateBtcUsdtCalibration(targetBtc, rawLast);
        }
      }
      if (ratio !== 1) {
        result = result.map((c) => ({
          ...c,
          open: roundPrice(c.open * ratio),
          high: roundPrice(c.high * ratio),
          low: roundPrice(c.low * ratio),
          close: roundPrice(c.close * ratio),
        }));
      }
      if (!endTime && !startTime && targetBtc > 0) {
        const last = result[result.length - 1];
        last.close = targetBtc;
        last.high = Math.max(last.high, targetBtc);
        last.low = Math.min(last.low, targetBtc);
      }
    }
  }

  return result;
}

// Live Market Data Hub state
const liveTickers: Partial<Record<MarketSymbol, TickerData>> = {};
const lastTradeAt: Record<MarketSymbol, number> = { XAUUSD: 0, BTCUSD: 0 };
const lastEmittedTickTs: Record<MarketSymbol, number> = { XAUUSD: 0, BTCUSD: 0 };
function nextMonotonicTickTs(market: MarketSymbol): number {
  const now = Date.now();
  const next = Math.max(now, lastEmittedTickTs[market] + 1);
  lastEmittedTickTs[market] = next;
  return next;
}
const serverBootAt = Date.now();
let connectionStatus: ConnectionStatus = 'DISCONNECTED';
let lastUpstreamMessageAt = 0;
let upstreamWs: WebSocket | null = null;
let xauFuturesWs: WebSocket | null = null;
let coinbaseWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let xauReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let coinbaseReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let xauReconnectAttempts = 0;
let coinbaseReconnectAttempts = 0;

function getEffectiveStatus(): ConnectionStatus {
  const now = Date.now();
  const binanceOpen = upstreamWs && upstreamWs.readyState === WebSocket.OPEN;
  const xauOpen = xauFuturesWs && xauFuturesWs.readyState === WebSocket.OPEN;
  const coinbaseOpen = coinbaseWs && coinbaseWs.readyState === WebSocket.OPEN;
  if ((binanceOpen || xauOpen || coinbaseOpen) && now - lastUpstreamMessageAt < 15_000) {
    return 'LIVE';
  }
  if (Object.keys(liveTickers).length > 0 && now - lastUpstreamMessageAt < 90_000) {
    return 'DELAYED';
  }
  return connectionStatus;
}

async function refreshTickersFromRest(): Promise<void> {
  try {
    const [binanceRaw, xau24h, sqGold, cbBtc] = await Promise.all([
      fetchBinanceJson<
        Array<{
          symbol: string;
          lastPrice: string;
          openPrice: string;
          priceChange: string;
          priceChangePercent: string;
          highPrice: string;
          lowPrice: string;
          volume: string;
          closeTime: number;
        }>
      >(`/api/v3/ticker/24hr?symbols=${encodeURIComponent('["BTCUSDT","PAXGUSDT"]')}`).catch(() => []),
      fetchBinanceFuturesJson<{
        symbol: string;
        lastPrice: string;
        openPrice: string;
        highPrice: string;
        lowPrice: string;
        volume: string;
        closeTime: number;
      }>('/fapi/v1/ticker/24hr?symbol=XAUUSDT').catch(() => null),
      fetchSwissquoteXauSpot().then(async (p) => p ?? (await fetchGoldApiSpot())),
      fetchCoinbaseBtcStats(),
    ]);

    if (xau24h && Number(xau24h.lastPrice) > 0) {
      xauFuturesLastPrice = Number(xau24h.lastPrice);
    }
    if (sqGold && sqGold > 0) {
      updateXauSpotAnchor(sqGold);
    }
    if (cbBtc && cbBtc.last > 0) {
      btcSpotPrice = cbBtc.last;
      btcSpotUpdatedAt = Date.now();
    }

    let paxg24h: (typeof binanceRaw)[number] | undefined;
    for (const item of binanceRaw) {
      if (item.symbol === 'PAXGUSDT') {
        paxg24h = item;
      } else if (item.symbol === 'BTCUSDT') {
        const usdtLast = Number(item.lastPrice);
        if (usdtLast > 0) {
          btcUsdtRefPrice = usdtLast;
          if (btcSpotPrice > 0) {
            updateBtcUsdtCalibration(btcSpotPrice, usdtLast);
          }
        }
        // Never overwrite fresher WS BTCUSD tick with older REST price
        const wsFreshBtc = Date.now() - lastTradeAt.BTCUSD < 5000 && liveTickers.BTCUSD;
        if (!wsFreshBtc) {
          const price = cbBtc ? cbBtc.last : roundPrice(usdtLast * getBtcUsdRatio());
          const open24h = cbBtc ? cbBtc.open : roundPrice(Number(item.openPrice) * getBtcUsdRatio());
          const high24h = cbBtc ? cbBtc.high : roundPrice(Number(item.highPrice) * getBtcUsdRatio());
          const low24h = cbBtc ? cbBtc.low : roundPrice(Number(item.lowPrice) * getBtcUsdRatio());
          const change = roundPrice(price - open24h);
          const changePercent = open24h > 0 ? (change / open24h) * 100 : 0;
          liveTickers.BTCUSD = {
            market: 'BTCUSD',
            symbol: 'BTCUSD',
            description: MARKET_CONFIG.BTCUSD.description,
            providerSymbol: 'BTC-USD',
            price,
            open24h,
            change,
            changePercent,
            high24h,
            low24h,
            volume24h: cbBtc ? cbBtc.volume : Number(item.volume),
            timestamp: nextMonotonicTickTs('BTCUSD'),
          };
        }
      }
    }

    const xauSourceTicker =
      xau24h && Number(xau24h.lastPrice) > 0
        ? xau24h
        : paxg24h && Number(paxg24h.lastPrice) > 0
          ? paxg24h
          : null;

    if (xauSourceTicker) {
      const refNum = Number(xauSourceTicker.lastPrice);
      const isFutures = xauSourceTicker === xau24h;
      const basis = isFutures ? getXauBasis() : (xauSpotPrice > 0 ? roundPrice(xauSpotPrice - refNum) : 0);
      const wsFreshXau = Date.now() - lastTradeAt.XAUUSD < 3000 && liveTickers.XAUUSD;
      if (!wsFreshXau) {
        const price = sqGold ?? roundPrice(refNum + basis);
        const open24h = roundPrice(Number(xauSourceTicker.openPrice) + basis);
        const high24h = Math.max(price, roundPrice(Number(xauSourceTicker.highPrice) + basis));
        const low24h = Math.min(price, roundPrice(Number(xauSourceTicker.lowPrice) + basis));
        const change = roundPrice(price - open24h);
        const changePercent = open24h > 0 ? (change / open24h) * 100 : 0;
        liveTickers.XAUUSD = {
          market: 'XAUUSD',
          symbol: 'XAUUSD',
          description: MARKET_CONFIG.XAUUSD.description,
          providerSymbol: 'XAU/USD',
          price,
          open24h,
          change,
          changePercent,
          high24h,
          low24h,
          volume24h: Number(xauSourceTicker.volume) || 0,
          timestamp: nextMonotonicTickTs('XAUUSD'),
        };
      }
    }

    if (cbBtc && !liveTickers.BTCUSD) {
      const change = roundPrice(cbBtc.last - cbBtc.open);
      liveTickers.BTCUSD = {
        market: 'BTCUSD',
        symbol: 'BTCUSD',
        description: MARKET_CONFIG.BTCUSD.description,
        providerSymbol: 'BTC-USD',
        price: cbBtc.last,
        open24h: cbBtc.open,
        change,
        changePercent: cbBtc.open > 0 ? (change / cbBtc.open) * 100 : 0,
        high24h: cbBtc.high,
        low24h: cbBtc.low,
        volume24h: cbBtc.volume,
        timestamp: Date.now(),
      };
    }

    if (sqGold && !liveTickers.XAUUSD) {
      liveTickers.XAUUSD = {
        market: 'XAUUSD',
        symbol: 'XAUUSD',
        description: MARKET_CONFIG.XAUUSD.description,
        providerSymbol: 'XAU/USD',
        price: sqGold,
        open24h: sqGold,
        change: 0,
        changePercent: 0,
        high24h: sqGold,
        low24h: sqGold,
        volume24h: 0,
        timestamp: Date.now(),
      };
    }

    if (lastUpstreamMessageAt === 0) {
      lastUpstreamMessageAt = Date.now();
    }
    if (connectionStatus === 'DISCONNECTED') {
      connectionStatus = 'DELAYED';
    }
  } catch (err) {
    console.error('[LEADERS VIEW] REST ticker refresh error:', err);
  }
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  wss.on('error', () => {
    // Ignore transient WS server errors
  });

  server.on('upgrade', (request, socket, head) => {
    try {
      const pathname = (request.url || '').split('?')[0];
      if (pathname === '/ws') {
        if ('setNoDelay' in socket && typeof socket.setNoDelay === 'function') {
          socket.setNoDelay(true);
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    } catch {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    }
  });

  const broadcast = (payload: Record<string, unknown>) => {
    if (wss.clients.size === 0) return;
    let text: string | null = null;
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        if (client.bufferedAmount > 262_144) continue;
        try {
          if (text === null) {
            text = JSON.stringify(payload);
          }
          client.send(text);
        } catch {
          // Ignore closed/broken client socket mid-send
        }
      }
    }
  };

  // Direct Coinbase Exchange WebSocket for genuine real-time BTC/USD spot trades
  const connectCoinbase = () => {
    if (coinbaseReconnectTimer) {
      clearTimeout(coinbaseReconnectTimer);
      coinbaseReconnectTimer = null;
    }
    if (coinbaseWs) {
      try {
        coinbaseWs.removeAllListeners();
        coinbaseWs.terminate();
      } catch {
        // ignore
      }
      coinbaseWs = null;
    }

    try {
      const ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
      coinbaseWs = ws;

      ws.on('open', () => {
        coinbaseReconnectAttempts = 0;
        lastUpstreamMessageAt = Date.now();
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            product_ids: ['BTC-USD'],
            channels: ['ticker'],
          })
        );
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as {
            type?: string;
            product_id?: string;
            price?: string;
            last_size?: string;
            open_24h?: string;
            high_24h?: string;
            low_24h?: string;
            volume_24h?: string;
            time?: string;
          };
          if (msg.type !== 'ticker' || msg.product_id !== 'BTC-USD') return;
          const price = roundPrice(Number(msg.price));
          if (!Number.isFinite(price) || price <= 0) return;

          const now = Date.now();
          const tickTs = nextMonotonicTickTs('BTCUSD');
          const qty = Number(msg.last_size) || 0;
          const existing = liveTickers.BTCUSD;
          // Reject impossible single-tick spike (>5%)
          if (existing && Math.abs(price - existing.price) > existing.price * 0.05) {
            return;
          }
          btcSpotPrice = price;
          btcSpotUpdatedAt = now;
          if (btcUsdtRefPrice > 0) {
            updateBtcUsdtCalibration(price, btcUsdtRefPrice, now);
          }
          lastTradeAt.BTCUSD = now;
          lastUpstreamMessageAt = now;
          if (connectionStatus !== 'LIVE') {
            connectionStatus = 'LIVE';
            broadcast({ type: 'status', connectionStatus: 'LIVE', serverTime: now });
          }

          const open24h = Number(msg.open_24h) || existing?.open24h || price;
          const change = roundPrice(price - open24h);
          const changePercent = open24h > 0 ? (change / open24h) * 100 : 0;

          const updatedTicker: TickerData = {
            market: 'BTCUSD',
            symbol: 'BTCUSD',
            description: MARKET_CONFIG.BTCUSD.description,
            providerSymbol: 'BTC-USD',
            price,
            open24h,
            change,
            changePercent,
            high24h: Number(msg.high_24h) || (existing ? Math.max(existing.high24h, price) : price),
            low24h: Number(msg.low_24h) || (existing ? Math.min(existing.low24h, price) : price),
            volume24h: Number(msg.volume_24h) || existing?.volume24h || 0,
            timestamp: tickTs,
          };
          liveTickers.BTCUSD = updatedTicker;
          recordLive1sTick('BTCUSD', price, Number.isFinite(qty) ? qty : 0, now);

          broadcast({
            type: 'tick',
            market: 'BTCUSD',
            price,
            volume: Number.isFinite(qty) ? qty : 0,
            timestamp: tickTs,
            ticker: updatedTicker,
          });
        } catch {
          // ignore malformed frame
        }
      });

      ws.on('close', () => {
        if (coinbaseReconnectTimer) return;
        coinbaseReconnectAttempts += 1;
        const delay = Math.min(15_000, 1000 * Math.pow(1.6, Math.min(coinbaseReconnectAttempts, 6)));
        coinbaseReconnectTimer = setTimeout(() => {
          coinbaseReconnectTimer = null;
          connectCoinbase();
        }, delay);
      });

      ws.on('error', () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      });
    } catch {
      // retry via timer
    }
  };

  // Direct Binance Futures WebSocket for continuous high-frequency XAUUSDT ticks calibrated to XAU/USD spot
  const connectXauFutures = () => {
    if (xauReconnectTimer) {
      clearTimeout(xauReconnectTimer);
      xauReconnectTimer = null;
    }
    if (xauFuturesWs) {
      try {
        xauFuturesWs.removeAllListeners();
        xauFuturesWs.terminate();
      } catch {
        // ignore
      }
      xauFuturesWs = null;
    }

    try {
      const ws = new WebSocket('wss://fstream.binance.com/stream?streams=xauusdt@aggTrade/xauusdt@bookTicker');
      xauFuturesWs = ws;

      ws.on('open', () => {
        xauReconnectAttempts = 0;
        lastUpstreamMessageAt = Date.now();
        if (connectionStatus !== 'LIVE') {
          connectionStatus = 'LIVE';
          broadcast({ type: 'status', connectionStatus: 'LIVE', serverTime: Date.now() });
        }
      });

      ws.on('message', (raw) => {
        try {
          const parsed = JSON.parse(raw.toString()) as {
            stream?: string;
            data?: Record<string, unknown>;
          };
          const msg = parsed.data;
          if (!msg || !parsed.stream) return;
          const streamLower = parsed.stream.toLowerCase();
          const now = Date.now();
          lastUpstreamMessageAt = now;
          if (connectionStatus !== 'LIVE') {
            connectionStatus = 'LIVE';
            broadcast({ type: 'status', connectionStatus: 'LIVE', serverTime: now });
          }

          let rawPrice = 0;
          let qty = 0;
          if (streamLower.endsWith('@aggtrade')) {
            rawPrice = Number(msg.p);
            qty = Number(msg.q) || 0;
          } else if (streamLower.endsWith('@bookticker')) {
            const bid = Number(msg.b);
            const ask = Number(msg.a);
            if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
              rawPrice = (bid + ask) / 2;
            }
          }
          if (!Number.isFinite(rawPrice) || rawPrice <= 0) return;

          xauFuturesLastPrice = rawPrice;
          // Wait for initial spot anchor before emitting raw futures if spot not yet fetched in first ~5s
          if (xauSpotUpdatedAt === 0 && now - serverBootAt < 5000) {
            return;
          }
          if (xauBasisUpdatedAt === 0 && xauSpotPrice > 0) {
            const diff = xauSpotPrice - rawPrice;
            if (Math.abs(diff) < xauSpotPrice * 0.05) {
              xauBasisLocked = roundPrice(diff);
              xauBasisUpdatedAt = now;
            }
          }
          const calibrated = roundPrice(rawPrice + getXauBasis());
          const existing = liveTickers.XAUUSD;
          // Guard against >1.5% outlier jump
          if (existing && Math.abs(calibrated - existing.price) > existing.price * 0.015) return;

          // Throttle redundant bookTicker frames while emitting every genuine price change immediately
          if (existing && existing.price === calibrated && qty === 0) return;
          if (now - lastTradeAt.XAUUSD < 75 && existing?.price === calibrated) return;

          lastTradeAt.XAUUSD = now;
          const tickTs = nextMonotonicTickTs('XAUUSD');
          const open24h = existing?.open24h || calibrated;
          const change = roundPrice(calibrated - open24h);
          const changePercent = open24h > 0 ? (change / open24h) * 100 : 0;

          const updatedTicker: TickerData = {
            market: 'XAUUSD',
            symbol: 'XAUUSD',
            description: MARKET_CONFIG.XAUUSD.description,
            providerSymbol: 'XAU/USD',
            price: calibrated,
            open24h,
            change,
            changePercent,
            high24h: existing ? Math.max(existing.high24h, calibrated) : calibrated,
            low24h: existing ? Math.min(existing.low24h, calibrated) : calibrated,
            volume24h: existing ? existing.volume24h + qty : 0,
            timestamp: tickTs,
          };
          liveTickers.XAUUSD = updatedTicker;
          recordLive1sTick('XAUUSD', calibrated, qty, now);
          broadcast({
            type: 'tick',
            market: 'XAUUSD',
            price: calibrated,
            volume: qty,
            timestamp: tickTs,
            ticker: updatedTicker,
          });
        } catch {
          // ignore malformed frame
        }
      });

      let xauGeoBlocked = false;
      ws.on('unexpected-response', (_req, res) => {
        if (res.statusCode === 451 || res.statusCode === 403 || res.statusCode === 418) {
          xauGeoBlocked = true;
        }
        try {
          ws.terminate();
        } catch {
          // ignore
        }
      });

      ws.on('close', () => {
        if (xauReconnectTimer) return;
        xauReconnectAttempts += 1;
        const delay = xauGeoBlocked
          ? 10 * 60_000
          : Math.min(15_000, 1000 * Math.pow(1.6, Math.min(xauReconnectAttempts, 6)));
        xauReconnectTimer = setTimeout(() => {
          xauReconnectTimer = null;
          connectXauFutures();
        }, delay);
      });

      ws.on('error', () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      });
    } catch {
      // retry via timer
    }
  };

  // Connect upstream Binance Spot WebSocket feed (BTCUSDT fallback reference if Coinbase WS pauses)
  const connectUpstream = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (upstreamWs) {
      try {
        upstreamWs.removeAllListeners();
        upstreamWs.terminate();
      } catch {
        // ignore
      }
      upstreamWs = null;
    }

    const streams = 'btcusdt@trade/btcusdt@ticker';
    const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    try {
      const ws = new WebSocket(wsUrl);
      upstreamWs = ws;

      ws.on('open', () => {
        reconnectAttempts = 0;
        connectionStatus = 'LIVE';
        lastUpstreamMessageAt = Date.now();
        broadcast({
          type: 'status',
          connectionStatus: 'LIVE',
          serverTime: Date.now(),
        });
      });

      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString()) as {
            stream?: string;
            data?: Record<string, unknown>;
          };
          const msg = parsed.data;
          if (!msg || !parsed.stream) return;

          lastUpstreamMessageAt = Date.now();
          if (connectionStatus !== 'LIVE') {
            connectionStatus = 'LIVE';
            broadcast({ type: 'status', connectionStatus: 'LIVE', serverTime: Date.now() });
          }

          const streamLower = parsed.stream.toLowerCase();
          if (!streamLower.startsWith('btcusdt')) return;

          const rawPrice = Number(streamLower.endsWith('@trade') ? msg.p : msg.c);
          if (Number.isFinite(rawPrice) && rawPrice > 0) {
            btcUsdtRefPrice = rawPrice;
          }
          if (Date.now() - lastTradeAt.BTCUSD < 4000) {
            return;
          }
          if (streamLower.endsWith('@trade') && Number.isFinite(rawPrice) && rawPrice > 0) {
            const price = roundPrice(rawPrice * getBtcUsdRatio());
            const qty = Number(msg.q) || 0;
            const tickTs = nextMonotonicTickTs('BTCUSD');
            const existing = liveTickers.BTCUSD;
            const open24h = existing?.open24h || price;
            const change = roundPrice(price - open24h);
            const updatedTicker: TickerData = {
              market: 'BTCUSD',
              symbol: 'BTCUSD',
              description: MARKET_CONFIG.BTCUSD.description,
              providerSymbol: 'BTC-USD',
              price,
              open24h,
              change,
              changePercent: open24h > 0 ? (change / open24h) * 100 : 0,
              high24h: existing ? Math.max(existing.high24h, price) : price,
              low24h: existing ? Math.min(existing.low24h, price) : price,
              volume24h: existing ? existing.volume24h + qty : 0,
              timestamp: tickTs,
            };
            liveTickers.BTCUSD = updatedTicker;
            recordLive1sTick('BTCUSD', price, qty, Date.now());
            broadcast({
              type: 'tick',
              market: 'BTCUSD',
              price,
              volume: qty,
              timestamp: tickTs,
              ticker: updatedTicker,
            });
          }
        } catch {
          // Ignore malformed frame
        }
      });

      let binanceWsGeoBlocked = false;
      ws.on('unexpected-response', (_req, res) => {
        if (res.statusCode === 451 || res.statusCode === 403 || res.statusCode === 418) {
          binanceWsGeoBlocked = true;
        }
        try {
          ws.terminate();
        } catch {
          // ignore
        }
      });

      ws.on('close', () => {
        if (upstreamWs === ws) {
          upstreamWs = null;
        }
        const effective = getEffectiveStatus();
        if (effective !== 'LIVE') {
          connectionStatus = Object.keys(liveTickers).length > 0 ? 'DELAYED' : 'DISCONNECTED';
          broadcast({
            type: 'status',
            connectionStatus,
            serverTime: Date.now(),
          });
        }
        scheduleReconnect(binanceWsGeoBlocked ? 10 * 60_000 : undefined);
      });

      ws.on('error', () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      });
    } catch {
      scheduleReconnect();
    }
  };

  const scheduleReconnect = (overrideDelayMs?: number) => {
    if (reconnectTimer) return;
    reconnectAttempts += 1;
    const delay =
      overrideDelayMs ?? Math.min(15_000, 1000 * Math.pow(1.6, Math.min(reconnectAttempts, 6)));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectUpstream();
    }, delay);
  };

  // High-frequency institutional Spot Gold (XAU/USD) quote polling (~1000ms while clients are connected)
  let xauPollActive = false;
  let lastIdleSpotPollAt = 0;
  const xauPollInterval = setInterval(async () => {
    if (xauPollActive) return;
    const nowCheck = Date.now();
    // Skip 1s polling when no browser clients are connected (at most 1 lightweight refresh every 60s when idle)
    if (wss.clients.size === 0 && nowCheck - lastIdleSpotPollAt < 60_000) {
      return;
    }
    xauPollActive = true;
    lastIdleSpotPollAt = nowCheck;
    try {
      const spot = await fetchSwissquoteXauSpot();
      const xauFuturesOpen = Boolean(xauFuturesWs && xauFuturesWs.readyState === WebSocket.OPEN);
      if (spot && spot > 0) {
        const now = Date.now();
        if (!updateXauSpotAnchor(spot, now)) {
          return;
        }
        lastUpstreamMessageAt = now;

        const existing = liveTickers.XAUUSD;
        // Broadcast directly from institutional Spot feed when futures WS is closed or hasn't ticked in >1.2s
        if (!existing || ((!xauFuturesOpen || now - lastTradeAt.XAUUSD > 1200) && existing.price !== spot)) {
          lastTradeAt.XAUUSD = now;
          recordLive1sTick('XAUUSD', spot, 0, now);
          const tickTs = nextMonotonicTickTs('XAUUSD');
          const open24h = existing?.open24h || spot;
          const change = roundPrice(spot - open24h);
          const changePercent = open24h > 0 ? (change / open24h) * 100 : 0;
          const updatedTicker: TickerData = {
            market: 'XAUUSD',
            symbol: 'XAUUSD',
            description: MARKET_CONFIG.XAUUSD.description,
            providerSymbol: 'XAU/USD',
            price: spot,
            open24h,
            change,
            changePercent,
            high24h: existing ? Math.max(existing.high24h, spot) : spot,
            low24h: existing ? Math.min(existing.low24h, spot) : spot,
            volume24h: existing?.volume24h ?? 0,
            timestamp: tickTs,
          };
          liveTickers.XAUUSD = updatedTicker;
          if (wss.clients.size > 0) {
            broadcast({
              type: 'tick',
              market: 'XAUUSD',
              price: spot,
              volume: 0,
              timestamp: tickTs,
              ticker: updatedTicker,
            });
          }
        }
      } else if (wss.clients.size > 0 && Date.now() - lastTradeAt.XAUUSD > 3000) {
        const goldApiSpot = await fetchGoldApiSpot();
        if (goldApiSpot && goldApiSpot > 0) {
          const now = Date.now();
          if (updateXauSpotAnchor(goldApiSpot, now)) {
            lastUpstreamMessageAt = now;
            lastTradeAt.XAUUSD = now;
            recordLive1sTick('XAUUSD', goldApiSpot, 0, now);
            const tickTs = nextMonotonicTickTs('XAUUSD');
            const existing = liveTickers.XAUUSD;
            const open24h = existing?.open24h || goldApiSpot;
            const change = roundPrice(goldApiSpot - open24h);
            const updatedTicker: TickerData = {
              market: 'XAUUSD',
              symbol: 'XAUUSD',
              description: MARKET_CONFIG.XAUUSD.description,
              providerSymbol: 'XAU/USD',
              price: goldApiSpot,
              open24h,
              change,
              changePercent: open24h > 0 ? (change / open24h) * 100 : 0,
              high24h: existing ? Math.max(existing.high24h, goldApiSpot) : goldApiSpot,
              low24h: existing ? Math.min(existing.low24h, goldApiSpot) : goldApiSpot,
              volume24h: existing?.volume24h ?? 0,
              timestamp: tickTs,
            };
            liveTickers.XAUUSD = updatedTicker;
            broadcast({
              type: 'tick',
              market: 'XAUUSD',
              price: goldApiSpot,
              volume: 0,
              timestamp: tickTs,
              ticker: updatedTicker,
            });
          }
        }
      }
    } catch {
      // Ignore transient poll failure
    } finally {
      xauPollActive = false;
    }
  }, 1000);

  // Bounded server-side 2s micro-cache + in-flight deduplication for head klines queries
  const MAX_KLINE_CACHE_ENTRIES = 8;
  const KLINE_CACHE_TTL_MS = 2000;
  const klineCache = new Map<string, { candles: Candle[]; cachedAt: number }>();
  const klineInFlight = new Map<string, Promise<Candle[]>>();

  const pruneKlineCache = (now: number) => {
    for (const [k, v] of klineCache.entries()) {
      if (now - v.cachedAt > KLINE_CACHE_TTL_MS * 3) {
        klineCache.delete(k);
      }
    }
    while (klineCache.size > MAX_KLINE_CACHE_ENTRIES) {
      const oldest = klineCache.keys().next().value;
      if (!oldest) break;
      klineCache.delete(oldest);
    }
  };

  const getHeadCandlesFast = async (market: MarketSymbol, interval: string, limit: number): Promise<Candle[]> => {
    const key = `${market}:${interval}:${limit}`;
    const now = Date.now();
    const existing = klineCache.get(key);
    if (existing && now - existing.cachedAt < KLINE_CACHE_TTL_MS) {
      return existing.candles;
    }
    const inflight = klineInFlight.get(key);
    if (inflight) return inflight;

    const p = fetchHistoricalCandles(market, interval, limit)
      .then((candles) => {
        if (candles.length > 0) {
          const ts = Date.now();
          if (klineCache.has(key)) klineCache.delete(key);
          klineCache.set(key, { candles, cachedAt: ts });
          pruneKlineCache(ts);
        }
        return candles;
      })
      .finally(() => {
        klineInFlight.delete(key);
      });
    klineInFlight.set(key, p);
    return p;
  };

  // Non-blocking initial REST snapshot, primary XAUUSD warm-up, & upstream WS launch
  void refreshTickersFromRest();
  void getHeadCandlesFast('XAUUSD', '15m', 400).catch(() => {});
  connectCoinbase();
  connectXauFutures();
  connectUpstream();

  // Periodic fallback REST check if WS is degraded (only when clients are connected)
  const fallbackPollInterval = setInterval(async () => {
    if (wss.clients.size === 0) return;
    try {
      const status = getEffectiveStatus();
      if (status !== 'LIVE') {
        await refreshTickersFromRest();
        broadcast({
          type: 'snapshot',
          tickers: liveTickers,
          connectionStatus: getEffectiveStatus(),
          serverTime: Date.now(),
        });
      }
    } catch {
      // Ignore transient fallback poll error
    }
  }, 10_000);

  // Heartbeat to drop dead/half-open mobile WebSocket connections and keep memory bounded
  const aliveClients = new WeakMap<WebSocket, boolean>();
  const wsHeartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      if (aliveClients.get(client) === false) {
        try {
          client.terminate();
        } catch {
          // ignore
        }
        continue;
      }
      aliveClients.set(client, false);
      try {
        client.ping();
      } catch {
        // ignore
      }
    }
  }, 30_000);

  wss.on('connection', (client) => {
    aliveClients.set(client, true);
    client.on('pong', () => {
      aliveClients.set(client, true);
    });
    client.on('error', () => {
      // Ignore abrupt mobile client disconnects
    });
    try {
      client.send(
        JSON.stringify({
          type: 'snapshot',
          tickers: liveTickers,
          connectionStatus: getEffectiveStatus(),
          serverTime: Date.now(),
        })
      );
    } catch {
      // Ignore closed socket
    }

    client.on('message', (raw) => {
      aliveClients.set(client, true);
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string };
        if (msg.type === 'ping') {
          client.send(JSON.stringify({ type: 'pong', serverTime: Date.now() }));
        }
      } catch {
        // ignore
      }
    });
  });

  const cleanupResources = () => {
    clearInterval(xauPollInterval);
    clearInterval(fallbackPollInterval);
    clearInterval(wsHeartbeatInterval);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (xauReconnectTimer) {
      clearTimeout(xauReconnectTimer);
      xauReconnectTimer = null;
    }
    if (coinbaseReconnectTimer) {
      clearTimeout(coinbaseReconnectTimer);
      coinbaseReconnectTimer = null;
    }
    klineCache.clear();
    klineInFlight.clear();
    for (const sock of [upstreamWs, xauFuturesWs, coinbaseWs]) {
      if (sock) {
        try {
          sock.removeAllListeners();
          sock.terminate();
        } catch {
          // ignore
        }
      }
    }
    upstreamWs = null;
    xauFuturesWs = null;
    coinbaseWs = null;
    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch {
        // ignore
      }
    }
    try {
      wss.close();
      server.close();
    } catch {
      // ignore
    }
  };

  process.once('SIGTERM', cleanupResources);
  process.once('SIGINT', cleanupResources);

  app.use(express.json());

  // API: Real-time health & connection status
  app.get('/api/health', (_req, res) => {
    res.json({
      app: 'LEADERS VIEW',
      connectionStatus: getEffectiveStatus(),
      markets: Object.keys(MARKET_CONFIG),
      tickers: liveTickers,
      serverTime: Date.now(),
    });
  });

  // API: Live ticker snapshots
  app.get('/api/tickers', async (_req, res) => {
    if (Object.keys(liveTickers).length < 2) {
      await refreshTickersFromRest();
    }
    res.json({
      connectionStatus: getEffectiveStatus(),
      tickers: liveTickers,
      serverTime: Date.now(),
    });
  });

  // API: Genuine historical OHLC candles
  app.get('/api/klines', async (req, res) => {
    try {
      const market = String(req.query.market || 'XAUUSD').toUpperCase() as MarketSymbol;
      const interval = String(req.query.interval || '15m');
      const limit = Number(req.query.limit || 350);
      const endTime = req.query.endTime ? Number(req.query.endTime) : undefined;
      const startTime = req.query.startTime ? Number(req.query.startTime) : undefined;

      if (!MARKET_CONFIG[market]) {
        res.status(400).json({ error: `Unsupported market: ${market}` });
        return;
      }
      if (!INTERVAL_MAP[interval]) {
        res.status(400).json({ error: `Unsupported interval: ${interval}` });
        return;
      }

      const candles =
        !endTime && !startTime
          ? await getHeadCandlesFast(market, interval, Math.max(20, Math.min(1000, limit)))
          : await fetchHistoricalCandles(market, interval, limit, endTime, startTime);
      res.json({
        market,
        interval,
        providerSymbol: MARKET_CONFIG[market].providerSymbol,
        connectionStatus: getEffectiveStatus(),
        candles,
        serverTime: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load historical market data';
      res.status(502).json({
        error: message,
        connectionStatus: 'DISCONNECTED',
        candles: [],
      });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: hmrDisabled ? false : { server },
        ws: { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (
            filePath.endsWith('sw.js') ||
            filePath.endsWith('manifest.webmanifest') ||
            filePath.endsWith('index.html')
          ) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[LEADERS VIEW] Server & WebSocket Hub active on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[LEADERS VIEW] Fatal server error:', err);
  process.exit(1);
});
