import { Candle, ConnectionStatus, MarketSymbol, TickerData, TimeframeId } from '../types/chart';
import { getBucketStartTime } from './timeframeManager';

export interface MarketTickEvent {
  market: MarketSymbol;
  price: number;
  volume: number;
  timestamp: number;
  ticker: TickerData;
}

export interface MarketStreamCallbacks {
  onStatusChange: (status: ConnectionStatus) => void;
  onTickersUpdate: (tickers: Partial<Record<MarketSymbol, TickerData>>) => void;
  onTick: (tick: MarketTickEvent) => void;
}

export class MarketDataClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private reconnectAttempts = 0;
  private disposed = false;
  private callbacks: MarketStreamCallbacks;
  private lastTickTimestamp: Record<MarketSymbol, number> = { XAUUSD: 0, BTCUSD: 0 };

  constructor(callbacks: MarketStreamCallbacks) {
    this.callbacks = callbacks;
  }

  public connect(): void {
    if (this.disposed) return;
    this.cleanupSocket();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.startPing();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            connectionStatus?: ConnectionStatus;
            tickers?: Partial<Record<MarketSymbol, TickerData>>;
            market?: MarketSymbol;
            price?: number;
            volume?: number;
            timestamp?: number;
            ticker?: TickerData;
          };

          if (msg.type === 'snapshot') {
            if (msg.connectionStatus) {
              this.callbacks.onStatusChange(msg.connectionStatus);
            }
            if (msg.tickers) {
              this.callbacks.onTickersUpdate(msg.tickers);
            }
          } else if (msg.type === 'status' && msg.connectionStatus) {
            this.callbacks.onStatusChange(msg.connectionStatus);
          } else if (msg.type === 'ticker' && msg.market && msg.ticker) {
            this.callbacks.onTickersUpdate({ [msg.market]: msg.ticker });
          } else if (
            msg.type === 'tick' &&
            msg.market &&
            typeof msg.price === 'number' &&
            typeof msg.timestamp === 'number' &&
            msg.ticker
          ) {
            // Out-of-order protection
            if (msg.timestamp < this.lastTickTimestamp[msg.market]) {
              return;
            }
            this.lastTickTimestamp[msg.market] = msg.timestamp;
            this.callbacks.onTick({
              market: msg.market,
              price: msg.price,
              volume: msg.volume ?? 0,
              timestamp: msg.timestamp,
              ticker: msg.ticker,
            });
          }
        } catch {
          // Ignore malformed message
        }
      };

      ws.onclose = () => {
        this.stopPing();
        if (!this.disposed) {
          this.callbacks.onStatusChange('DISCONNECTED');
          this.scheduleReconnect();
        }
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      };
    } catch {
      this.callbacks.onStatusChange('DISCONNECTED');
      this.scheduleReconnect();
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 20_000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(12_000, 800 * Math.pow(1.5, Math.min(this.reconnectAttempts, 6)));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private cleanupSocket(): void {
    this.stopPing();
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  public dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupSocket();
  }
}

interface PreloadedKlinesPayload {
  candles?: Candle[];
  connectionStatus?: ConnectionStatus;
  error?: string;
}

interface PreloadedKlinesCache {
  url: string;
  resolved?: PreloadedKlinesPayload | null;
  promise: Promise<PreloadedKlinesPayload | null>;
}

interface PreloadedTickersPayload {
  connectionStatus?: ConnectionStatus;
  tickers?: Partial<Record<MarketSymbol, TickerData>>;
}

interface PreloadedTickersCache {
  resolved?: PreloadedTickersPayload | null;
  promise: Promise<PreloadedTickersPayload | null>;
}

declare global {
  interface Window {
    __LV_INITIAL_KLINES__?: PreloadedKlinesCache;
    __LV_INITIAL_TICKERS__?: PreloadedTickersCache;
  }
}

export interface CachedCandlesEntry {
  candles: Candle[];
  connectionStatus: ConnectionStatus;
  fetchedAt: number;
}

const CANDLE_CACHE = new Map<string, CachedCandlesEntry>();
const IN_FLIGHT_KLINES = new Map<string, Promise<{ candles: Candle[]; connectionStatus: ConnectionStatus }>>();
const MAX_CACHE_ENTRIES = 18;

function getCacheKey(market: MarketSymbol, interval: TimeframeId): string {
  return `${market}:${interval}`;
}

export function getCachedCandlesEntry(
  market: MarketSymbol,
  interval: TimeframeId
): CachedCandlesEntry | null {
  return CANDLE_CACHE.get(getCacheKey(market, interval)) ?? null;
}

export function setCachedCandlesEntry(
  market: MarketSymbol,
  interval: TimeframeId,
  candles: Candle[],
  connectionStatus: ConnectionStatus
): void {
  if (candles.length === 0) return;
  const key = getCacheKey(market, interval);
  // Refresh insertion order for simple LRU eviction
  if (CANDLE_CACHE.has(key)) {
    CANDLE_CACHE.delete(key);
  } else if (CANDLE_CACHE.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = CANDLE_CACHE.keys().next().value;
    if (oldestKey) CANDLE_CACHE.delete(oldestKey);
  }
  CANDLE_CACHE.set(key, {
    candles,
    connectionStatus,
    fetchedAt: Date.now(),
  });
}

/** Synchronously check if index.html's parallel klines fetch already resolved before React mounted */
export function getInitialCandlesSync(
  market: MarketSymbol,
  interval: TimeframeId,
  limit = 400
): CachedCandlesEntry | null {
  const existing = getCachedCandlesEntry(market, interval);
  if (existing) return existing;

  if (typeof window === 'undefined' || !window.__LV_INITIAL_KLINES__) return null;
  const expectedUrl = `/api/klines?market=${encodeURIComponent(market)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const preload = window.__LV_INITIAL_KLINES__;
  if (preload.url === expectedUrl && preload.resolved && Array.isArray(preload.resolved.candles) && preload.resolved.candles.length > 0) {
    window.__LV_INITIAL_KLINES__ = undefined;
    const candles = deduplicateAndSortCandles(preload.resolved.candles);
    const connectionStatus = preload.resolved.connectionStatus ?? 'DELAYED';
    setCachedCandlesEntry(market, interval, candles, connectionStatus);
    return { candles, connectionStatus, fetchedAt: Date.now() };
  }
  return null;
}

export function getInitialTickersSync(): PreloadedTickersPayload | null {
  if (typeof window === 'undefined' || !window.__LV_INITIAL_TICKERS__) return null;
  const resolved = window.__LV_INITIAL_TICKERS__.resolved;
  if (resolved && resolved.tickers) {
    window.__LV_INITIAL_TICKERS__ = undefined;
    return resolved;
  }
  return null;
}

export async function consumeInitialTickersPromise(): Promise<PreloadedTickersPayload | null> {
  if (typeof window === 'undefined' || !window.__LV_INITIAL_TICKERS__) return null;
  const entry = window.__LV_INITIAL_TICKERS__;
  window.__LV_INITIAL_TICKERS__ = undefined;
  return entry.resolved ?? (await entry.promise);
}

/** Keep all cached timeframes for a market synchronized on live WebSocket ticks */
export function updateCachedCandlesWithTick(
  market: MarketSymbol,
  price: number,
  volume: number,
  timestampMs: number,
  skipInterval?: TimeframeId
): void {
  const prefix = `${market}:`;
  for (const [key, entry] of CANDLE_CACHE.entries()) {
    if (!key.startsWith(prefix)) continue;
    const tf = key.slice(prefix.length) as TimeframeId;
    if (skipInterval && tf === skipInterval) continue;
    applyTickToCandles(entry.candles, price, volume, timestampMs, tf);
    entry.fetchedAt = Date.now();
  }
}

export async function fetchCandles(params: {
  market: MarketSymbol;
  interval: TimeframeId;
  limit?: number;
  endTime?: number;
  startTime?: number;
  signal?: AbortSignal;
}): Promise<{ candles: Candle[]; connectionStatus: ConnectionStatus; error?: string }> {
  const limit = params.limit ?? 350;
  const qs = new URLSearchParams({
    market: params.market,
    interval: params.interval,
    limit: String(limit),
  });
  if (params.endTime) qs.set('endTime', String(Math.floor(params.endTime)));
  if (params.startTime) qs.set('startTime', String(Math.floor(params.startTime)));

  const url = `/api/klines?${qs.toString()}`;
  const isHeadQuery = !params.endTime && !params.startTime;

  // 1. Consume parallel preload kicked off in index.html before React finished mounting
  if (isHeadQuery && typeof window !== 'undefined' && window.__LV_INITIAL_KLINES__) {
    const cached = window.__LV_INITIAL_KLINES__;
    if (cached.url === url) {
      window.__LV_INITIAL_KLINES__ = undefined;
      const preloaded = cached.resolved ?? (await cached.promise);
      if (params.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      if (preloaded && Array.isArray(preloaded.candles) && preloaded.candles.length > 0) {
        const candles = deduplicateAndSortCandles(preloaded.candles);
        const connectionStatus = preloaded.connectionStatus ?? 'DELAYED';
        setCachedCandlesEntry(params.market, params.interval, candles, connectionStatus);
        return { candles, connectionStatus };
      }
    }
  }

  // 2. Deduplicate identical in-flight head queries (e.g., prefetch + user switch overlap)
  if (isHeadQuery) {
    const cacheKey = getCacheKey(params.market, params.interval);
    const inFlight = IN_FLIGHT_KLINES.get(cacheKey);
    if (inFlight) {
      const result = await inFlight;
      if (params.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      return result;
    }

    const requestPromise = (async () => {
      const res = await fetch(url);
      const data = (await res.json()) as {
        candles?: Candle[];
        connectionStatus?: ConnectionStatus;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `Market data error (${res.status})`);
      }
      const candles = deduplicateAndSortCandles(data.candles ?? []);
      const connectionStatus = data.connectionStatus ?? 'DELAYED';
      setCachedCandlesEntry(params.market, params.interval, candles, connectionStatus);
      return { candles, connectionStatus };
    })().finally(() => {
      IN_FLIGHT_KLINES.delete(cacheKey);
    });

    IN_FLIGHT_KLINES.set(cacheKey, requestPromise);
    const result = await requestPromise;
    if (params.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    return result;
  }

  const res = await fetch(url, { signal: params.signal });
  const data = (await res.json()) as {
    candles?: Candle[];
    connectionStatus?: ConnectionStatus;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Market data error (${res.status})`);
  }
  return {
    candles: deduplicateAndSortCandles(data.candles ?? []),
    connectionStatus: data.connectionStatus ?? 'DELAYED',
  };
}

/** Aggressively pre-warm alternate market & popular timeframes in parallel */
export function prefetchMarketsAndIntervals(params: {
  activeMarket: MarketSymbol;
  activeInterval: TimeframeId;
  alternateInterval: TimeframeId;
  signal?: AbortSignal;
}): void {
  const altMarket: MarketSymbol = params.activeMarket === 'XAUUSD' ? 'BTCUSD' : 'XAUUSD';
  const commonIntervals: TimeframeId[] = ['1m', '5m', '15m', '1h', '4h', '1D'];

  const targets: Array<{ market: MarketSymbol; interval: TimeframeId }> = [
    { market: altMarket, interval: params.alternateInterval },
  ];

  for (const tf of commonIntervals) {
    if (tf !== params.activeInterval) {
      targets.push({ market: params.activeMarket, interval: tf });
    }
  }

  // Launch priority alternate-market prefetch + staggered timeframe pre-warm without blocking UI
  const warmTarget = (target: { market: MarketSymbol; interval: TimeframeId }) => {
    if (params.signal?.aborted) return;
    const existing = getCachedCandlesEntry(target.market, target.interval);
    if (existing && Date.now() - existing.fetchedAt < 30_000) return;
    void fetchCandles({
      market: target.market,
      interval: target.interval,
      limit: 400,
      signal: params.signal,
    }).catch(() => {
      // Background prefetch failures are silent
    });
  };

  // Batch in parallel (2 at a time) so active chart + WS remain highest priority
  const firstBatch = targets.slice(0, 2);
  const restBatch = targets.slice(2);
  firstBatch.forEach(warmTarget);

  if (restBatch.length > 0) {
    const timer = window.setTimeout(() => {
      restBatch.forEach(warmTarget);
    }, 180);
    params.signal?.addEventListener('abort', () => clearTimeout(timer), { once: true });
  }
}

export function deduplicateAndSortCandles(candles: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of candles) {
    if (
      Number.isFinite(c.time) &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close)
    ) {
      byTime.set(c.time, c);
    }
  }
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

/** Merge a verified real-time trade tick into the active candle list without duplicating or corrupting OHLC */
export function applyTickToCandles(
  candles: Candle[],
  price: number,
  volume: number,
  timestampMs: number,
  interval: TimeframeId
): { updated: boolean; newBarAdded: boolean } {
  if (candles.length === 0 || !Number.isFinite(price) || price <= 0) {
    return { updated: false, newBarAdded: false };
  }

  const bucketTime = getBucketStartTime(timestampMs, interval);
  const last = candles[candles.length - 1];

  if (bucketTime < last.time) {
    // Out-of-order historical tick; ignore for live candle head
    return { updated: false, newBarAdded: false };
  }

  if (bucketTime === last.time) {
    last.close = price;
    if (price > last.high) last.high = price;
    if (price < last.low) last.low = price;
    last.volume += volume;
    return { updated: true, newBarAdded: false };
  }

  // New candle bucket opened
  candles.push({
    time: bucketTime,
    open: last.close,
    high: Math.max(last.close, price),
    low: Math.min(last.close, price),
    close: price,
    volume,
  });
  return { updated: true, newBarAdded: true };
}
