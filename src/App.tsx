import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import {
  AlertCondition,
  Candle,
  ConnectionStatus,
  DrawingObject,
  MarketSymbol,
  PriceAlert,
  ReplaySpeed,
  ReplayState,
  ThemeMode,
  TickerData,
  TimeframeId,
  ViewportState,
} from './types/chart';
import {
  applyTickToCandles,
  consumeInitialTickersPromise,
  deduplicateAndSortCandles,
  fetchCandles,
  getCachedCandlesEntry,
  getInitialCandlesSync,
  getInitialTickersSync,
  MarketDataClient,
  MAX_CHART_CANDLES,
  prefetchMarketsAndIntervals,
  updateCachedCandlesWithTick,
} from './modules/marketData';
import {
  loadMarketDrawings,
  loadMarketTimeframe,
  loadMarketViewport,
  loadSelectedMarket,
  loadTheme,
  saveMarketDrawings,
  saveMarketTimeframe,
  saveMarketViewport,
  saveSelectedMarket,
  saveTheme,
} from './modules/drawingStorage';
import {
  initFavoritesState,
  setFavoritesBarPosition,
  setShowFavoritesBar,
  toggleFavoriteTool,
} from './modules/favoritesManager';
import {
  AllMarketHistory,
  canRedo,
  canUndo,
  commitDrawingChange,
  commitFromSnapshot,
  createInitialHistory,
  redoMarketHistory,
  replacePresentWithoutCommit,
  undoMarketHistory,
} from './modules/undoRedoManager';
import { applyThemeToDocument } from './modules/themeManager';
import {
  createAlert,
  deleteAlert,
  dispatchAlertNotification,
  evaluateAlertsForPrice,
  initAlerts,
  updateAlert,
} from './modules/alertsManager';
import {
  DEFAULT_REPLAY_STATE,
  getReplayStepIntervalMs,
  stepReplayBackward,
  stepReplayForward,
} from './modules/barReplayManager';
import { duplicateDrawing } from './modules/drawingEngine';
import { formatPrice, MARKETS } from './modules/timeframeManager';
import { computePriceRange, createDefaultViewport } from './modules/zoomPanEngine';
import { downloadChartImage } from './modules/imageExport';

import { OpeningScreen } from './components/OpeningScreen';
import { TopToolbar } from './components/TopToolbar';
import { MarketSelectorModal } from './components/MarketSelectorModal';
import { IntervalMenuModal } from './components/IntervalMenuModal';
import { DrawingToolsPanel } from './components/DrawingToolsPanel';
import { FloatingFavoritesBar } from './components/FloatingFavoritesBar';
import { DrawingPropertiesBar } from './components/DrawingPropertiesBar';
import { ThreeDotsMenu } from './components/ThreeDotsMenu';
import { IndicatorsModal } from './components/IndicatorsModal';
import { AlertsModal } from './components/AlertsModal';
import { BarReplayControls } from './components/BarReplayControls';
import { ChartCanvas, ChartCanvasHandle } from './components/ChartCanvas';
import { usePWAInstall } from './hooks/usePWAInstall';

interface TriggeredToast {
  id: string;
  market: MarketSymbol;
  price: number;
  note: string;
}

const EMPTY_TICKERS: Partial<Record<MarketSymbol, TickerData>> = {};

export default function App() {
  const [showOpening, setShowOpening] = useState(true);

  // Persisted theme (Luxury Black & Gold dark mode by default)
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme());
  useEffect(() => {
    applyThemeToDocument(theme);
    saveTheme(theme);
  }, [theme]);

  // Persisted market & per-market timeframes
  const [market, setMarket] = useState<MarketSymbol>(() => loadSelectedMarket());
  const [timeframes, setTimeframes] = useState<Record<MarketSymbol, TimeframeId>>(() => ({
    XAUUSD: loadMarketTimeframe('XAUUSD'),
    BTCUSD: loadMarketTimeframe('BTCUSD'),
  }));
  const currentInterval = timeframes[market];

  // Synchronous preload hydration so Frame 1 already has real candles & tickers if ready
  const initialHydrationRef = useRef<ReturnType<typeof getInitialCandlesSync> | undefined>(undefined);
  if (initialHydrationRef.current === undefined) {
    initialHydrationRef.current = getInitialCandlesSync(market, currentInterval, 400);
  }
  const initialTickersRef = useRef<ReturnType<typeof getInitialTickersSync> | undefined>(undefined);
  if (initialTickersRef.current === undefined) {
    initialTickersRef.current = getInitialTickersSync();
  }

  // Real-time market data & connection status
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    () => initialTickersRef.current?.connectionStatus ?? initialHydrationRef.current?.connectionStatus ?? 'DISCONNECTED'
  );
  const [tickers, setTickers] = useState<Partial<Record<MarketSymbol, TickerData>>>(
    () => initialTickersRef.current?.tickers ?? {}
  );
  const candlesRef = useRef<Candle[]>(initialHydrationRef.current?.candles ?? []);
  const [candlesVersion, setCandlesVersion] = useState(() => (initialHydrationRef.current ? 1 : 0));
  const [isLoadingCandles, setIsLoadingCandles] = useState(() => !initialHydrationRef.current);
  const [dataError, setDataError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const loadingOlderRef = useRef(false);

  // Per-market viewports
  const [viewports, setViewports] = useState<Record<MarketSymbol, ViewportState>>(() => {
    const xauSaved = loadMarketViewport('XAUUSD');
    const btcSaved = loadMarketViewport('BTCUSD');
    const initialCount = initialHydrationRef.current?.candles.length ?? 300;
    return {
      XAUUSD: {
        ...createDefaultViewport(market === 'XAUUSD' ? initialCount : 300),
        ...xauSaved,
        ...(market === 'XAUUSD' && initialHydrationRef.current
          ? { rightOffset: Math.max(initialCount + 8, 20), autoScaleY: true }
          : {}),
      },
      BTCUSD: {
        ...createDefaultViewport(market === 'BTCUSD' ? initialCount : 300),
        ...btcSaved,
        ...(market === 'BTCUSD' && initialHydrationRef.current
          ? { rightOffset: Math.max(initialCount + 8, 20), autoScaleY: true }
          : {}),
      },
    };
  });
  const currentViewport = viewports[market];

  // Separate drawing history per market (Undo / Redo preserved across theme & market switches)
  const [history, setHistory] = useState<AllMarketHistory>(() =>
    createInitialHistory(loadMarketDrawings('XAUUSD'), loadMarketDrawings('BTCUSD'))
  );
  const currentDrawings = history[market].present;
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [activeToolId, setActiveToolId] = useState<string>('tool_cross');
  const [selectedVisualGlyph, setSelectedVisualGlyph] = useState<string>('🚀');

  // Persist drawings separately for XAUUSD and BTCUSD (debounced to prevent synchronous storage stalls)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveMarketDrawings('XAUUSD', history.XAUUSD.present);
    }, 220);
    return () => clearTimeout(timer);
  }, [history.XAUUSD.present]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveMarketDrawings('BTCUSD', history.BTCUSD.present);
    }, 220);
    return () => clearTimeout(timer);
  }, [history.BTCUSD.present]);

  // Favorites state (preloaded exact 11 tools)
  const [favoritesState, setFavoritesState] = useState(() => initFavoritesState());

  // Alerts state
  const [alerts, setAlerts] = useState<PriceAlert[]>(() => initAlerts());
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  const [triggeredToasts, setTriggeredToasts] = useState<TriggeredToast[]>([]);

  // Bar Replay state
  const [replay, setReplay] = useState<ReplayState>(DEFAULT_REPLAY_STATE);

  // Menus & Modals
  const [isMarketModalOpen, setIsMarketModalOpen] = useState(false);
  const [isIntervalModalOpen, setIsIntervalModalOpen] = useState(false);
  const [isDrawingPanelOpen, setIsDrawingPanelOpen] = useState(false);
  const [isThreeDotsOpen, setIsThreeDotsOpen] = useState(false);
  const [isIndicatorsOpen, setIsIndicatorsOpen] = useState(false);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isFreeCrosshair, setIsFreeCrosshair] = useState(false);
  const pwaInstall = usePWAInstall();

  const chartRef = useRef<ChartCanvasHandle | null>(null);
  const marketRef = useRef(market);
  const intervalRef = useRef(currentInterval);
  const replayRef = useRef(replay);
  const timeframesRef = useRef(timeframes);
  const loadedKeyRef = useRef<string | null>(
    initialHydrationRef.current ? `${market}:${currentInterval}` : null
  );
  marketRef.current = market;
  intervalRef.current = currentInterval;
  replayRef.current = replay;
  timeframesRef.current = timeframes;

  // Fetch genuine historical candles whenever market or timeframe changes (with instant cache hit + parallel pre-warming)
  useEffect(() => {
    const controller = new AbortController();
    const alternateMarket: MarketSymbol = market === 'XAUUSD' ? 'BTCUSD' : 'XAUUSD';
    const alternateInterval = timeframesRef.current[alternateMarket];

    setDataError(null);
    setReplay(DEFAULT_REPLAY_STATE);
    setSelectedDrawingId(null);

    const applyLoadedCandles = (candles: Candle[], status: ConnectionStatus) => {
      candlesRef.current = candles;
      loadedKeyRef.current = `${market}:${currentInterval}`;
      setCandlesVersion((v) => v + 1);
      setConnectionStatus((prev) => (prev === 'LIVE' ? 'LIVE' : status));
      setIsLoadingCandles(false);

      setViewports((prev) => ({
        ...prev,
        [market]: {
          ...prev[market],
          rightOffset: Math.max(candles.length + 8, 20),
          autoScaleY: true,
        },
      }));
    };

    const cached = retryNonce === 0 ? getCachedCandlesEntry(market, currentInterval) : null;
    if (cached && cached.candles.length > 0) {
      applyLoadedCandles(cached.candles, cached.connectionStatus);
      // Pre-warm alternate market and neighboring intervals in parallel immediately
      prefetchMarketsAndIntervals({
        activeMarket: market,
        activeInterval: currentInterval,
        alternateInterval,
        signal: controller.signal,
      });

      // If cache is older than 5s, silently refresh in background without showing a loading spinner
      if (Date.now() - cached.fetchedAt > 5_000) {
        fetchCandles({
          market,
          interval: currentInterval,
          limit: 400,
          signal: controller.signal,
        })
          .then(({ candles, connectionStatus: status }) => {
            if (controller.signal.aborted || candles.length === 0) return;
            applyLoadedCandles(candles, status);
          })
          .catch(() => {
            // Cached data remains displayed on silent background refresh failure
          });
      }

      return () => {
        controller.abort();
      };
    }

    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10_000);

    // Clear stale candles from previous market/interval so old prices never flash or merge with live ticks
    candlesRef.current = [];
    loadedKeyRef.current = null;
    setCandlesVersion((v) => v + 1);
    setIsLoadingCandles(true);

    // Kick off alternate-market prefetch in parallel right away alongside primary fetch
    prefetchMarketsAndIntervals({
      activeMarket: market,
      activeInterval: currentInterval,
      alternateInterval,
      signal: controller.signal,
    });

    fetchCandles({
      market,
      interval: currentInterval,
      limit: 400,
      signal: controller.signal,
    })
      .then(({ candles, connectionStatus: status }) => {
        clearTimeout(timeoutId);
        if (controller.signal.aborted) return;
        applyLoadedCandles(candles, status);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (controller.signal.aborted && !timedOut) return;
        setDataError(
          timedOut
            ? 'Market data request timed out. Please retry.'
            : err instanceof Error
              ? err.message
              : 'Unable to connect to market data feed.'
        );
        setIsLoadingCandles(false);
      });

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [market, currentInterval, retryNonce]);

  // Progressive historical data loading when scrolling/zooming left
  const handleRequestOlderCandles = useCallback(() => {
    if (loadingOlderRef.current || candlesRef.current.length === 0) return;
    const earliestTime = candlesRef.current[0].time;
    const targetMarket = marketRef.current;
    const targetInterval = intervalRef.current;
    loadingOlderRef.current = true;

    fetchCandles({
      market: targetMarket,
      interval: targetInterval,
      limit: 300,
      endTime: earliestTime - 1,
    })
      .then(({ candles: older }) => {
        if (
          older.length === 0 ||
          targetMarket !== marketRef.current ||
          targetInterval !== intervalRef.current
        ) {
          return;
        }
        const prevLen = candlesRef.current.length;
        if (prevLen >= MAX_CHART_CANDLES) return;
        let merged = deduplicateAndSortCandles([...older, ...candlesRef.current]);
        if (merged.length > MAX_CHART_CANDLES) {
          merged = merged.slice(merged.length - MAX_CHART_CANDLES);
        }
        const addedCount = merged.length - prevLen;
        if (addedCount > 0) {
          candlesRef.current = merged;
          // Shift rightOffset by exact number of prepended candles so chart never jumps!
          setViewports((prev) => ({
            ...prev,
            [targetMarket]: {
              ...prev[targetMarket],
              rightOffset: prev[targetMarket].rightOffset + addedCount,
            },
          }));
          setCandlesVersion((v) => v + 1);
        }
      })
      .catch(() => {
        // Silent retry on next scroll
      })
      .finally(() => {
        loadingOlderRef.current = false;
      });
  }, []);

  // Connect real-time high-frequency WebSocket feed (/ws) + consume preloaded ticker snapshot
  useEffect(() => {
    let disposed = false;
    void consumeInitialTickersPromise().then((preloaded) => {
      if (disposed || !preloaded?.tickers) return;
      setTickers((prev) => ({ ...preloaded.tickers, ...prev }));
      if (preloaded.connectionStatus) {
        setConnectionStatus((prev) => (prev === 'LIVE' ? 'LIVE' : preloaded.connectionStatus!));
      }
    });

    let pendingTickers: Partial<Record<MarketSymbol, TickerData>> = {};
    let tickerFlushTimer: number | null = null;

    const flushTickers = () => {
      tickerFlushTimer = null;
      const batch = pendingTickers;
      pendingTickers = {};
      const keys = Object.keys(batch) as MarketSymbol[];
      if (keys.length === 0) return;

      setTickers((prev) => {
        let changed = false;
        for (const sym of keys) {
          const next = batch[sym];
          const cur = prev[sym];
          if (
            !next ||
            !cur ||
            cur.price !== next.price ||
            cur.changePercent !== next.changePercent ||
            cur.change !== next.change
          ) {
            changed = true;
            break;
          }
        }
        return changed ? { ...prev, ...batch } : prev;
      });
    };

    const queueTickersBatch = (incoming: Partial<Record<MarketSymbol, TickerData>>) => {
      let hasAny = false;
      for (const k of Object.keys(incoming) as MarketSymbol[]) {
        const val = incoming[k];
        if (val) {
          pendingTickers[k] = val;
          hasAny = true;
        }
      }
      if (hasAny && tickerFlushTimer === null) {
        tickerFlushTimer = window.setTimeout(flushTickers, 150);
      }
    };

    const client = new MarketDataClient({
      onStatusChange: (status) => {
        setConnectionStatus((prev) => (prev === status ? prev : status));
      },
      onTickersUpdate: (incoming) => {
        queueTickersBatch(incoming);
        const activeMarket = marketRef.current;
        const activeTicker = incoming[activeMarket];
        if (
          activeTicker &&
          replayRef.current.mode === 'OFF' &&
          loadedKeyRef.current === `${activeMarket}:${intervalRef.current}` &&
          candlesRef.current.length > 0
        ) {
          const lastIdx = candlesRef.current.length - 1;
          const last = candlesRef.current[lastIdx];
          if (last.close !== activeTicker.price) {
            candlesRef.current[lastIdx] = {
              ...last,
              close: activeTicker.price,
              high: Math.max(last.high, activeTicker.price),
              low: Math.min(last.low, activeTicker.price),
            };
            chartRef.current?.requestRedraw();
          }
        }
      },
      onTick: (tick) => {
        pendingTickers[tick.market] = tick.ticker;
        if (tickerFlushTimer === null) {
          tickerFlushTimer = window.setTimeout(flushTickers, 150);
        }

        // Evaluate real-time price alerts against verified live tick
        const { updatedAlerts, newlyTriggered } = evaluateAlertsForPrice(
          alertsRef.current,
          tick.market,
          tick.price
        );
        if (updatedAlerts !== alertsRef.current) {
          alertsRef.current = updatedAlerts;
          setAlerts(updatedAlerts);
        }
        if (newlyTriggered.length > 0) {
          for (const alert of newlyTriggered) {
            dispatchAlertNotification(alert, tick.price);
            setTriggeredToasts((prev) => [
              { id: `${alert.id}_${Date.now()}`, market: alert.market, price: tick.price, note: alert.note },
              ...prev.slice(0, 3),
            ]);
          }
        }

        // Keep cached alternate market & intervals updated live in memory
        updateCachedCandlesWithTick(
          tick.market,
          tick.price,
          tick.volume,
          tick.timestamp,
          tick.market === marketRef.current ? intervalRef.current : undefined
        );

        // Update active chart live candle only if loaded dataset matches active market & interval
        if (
          tick.market === marketRef.current &&
          replayRef.current.mode === 'OFF' &&
          loadedKeyRef.current === `${tick.market}:${intervalRef.current}`
        ) {
          const { updated, newBarAdded } = applyTickToCandles(
            candlesRef.current,
            tick.price,
            tick.volume,
            tick.timestamp,
            intervalRef.current
          );
          if (updated) {
            if (newBarAdded) {
              const totalBars = candlesRef.current.length;
              setViewports((prev) => {
                const vp = prev[tick.market];
                const isNearHead = vp.rightOffset >= totalBars - 4;
                if (!isNearHead) return prev;
                return {
                  ...prev,
                  [tick.market]: { ...vp, rightOffset: Math.max(vp.rightOffset + 1, totalBars + 2) },
                };
              });
            }
            chartRef.current?.requestRedraw();
          }
        }
      },
    });

    client.connect();
    return () => {
      disposed = true;
      if (tickerFlushTimer !== null) {
        clearTimeout(tickerFlushTimer);
      }
      client.dispose();
    };
  }, []);

  // Bar Replay playback timer (0.1X .. 10X speeds)
  useEffect(() => {
    if (replay.mode !== 'PLAYING' || replay.cutIndex === null) return;
    const ms = getReplayStepIntervalMs(replay.speed);
    const timer = window.setInterval(() => {
      setReplay((prev) => {
        if (prev.mode !== 'PLAYING') return prev;
        return stepReplayForward(prev, candlesRef.current.length);
      });
    }, ms);
    return () => clearInterval(timer);
  }, [replay.mode, replay.speed, replay.cutIndex]);

  // Global keyboard shortcuts (Undo, Redo, Delete selected drawing)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        setHistory((h) => undoMarketHistory(h, marketRef.current));
      } else if (
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') ||
        ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        setHistory((h) => redoMarketHistory(h, marketRef.current));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId) {
        e.preventDefault();
        setHistory((h) =>
          commitDrawingChange(
            h,
            marketRef.current,
            h[marketRef.current].present.filter((d) => d.id !== selectedDrawingId)
          )
        );
        setSelectedDrawingId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedDrawingId]);

  // Sync browser fullscreen events cleanly
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && isFullScreen) {
        // Keep app fullscreen toggle controllable even if browser exits
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [isFullScreen]);

  // Handlers
  const handleSelectMarket = useCallback((nextMarket: MarketSymbol) => {
    setMarket(nextMarket);
    saveSelectedMarket(nextMarket);
  }, []);

  const handleSelectInterval = useCallback(
    (tf: TimeframeId) => {
      setTimeframes((prev) => ({ ...prev, [market]: tf }));
      saveMarketTimeframe(market, tf);
    },
    [market]
  );

  const handleViewportChange = useCallback(
    (next: ViewportState) => {
      setViewports((prev) => ({ ...prev, [market]: next }));
      saveMarketViewport(market, next);
    },
    [market]
  );

  const handleAddDrawing = useCallback(
    (drawing: DrawingObject, updatedExistingDrawings?: DrawingObject[]) => {
      setHistory((prev) => {
        const baseList = updatedExistingDrawings ?? prev[market].present;
        return commitDrawingChange(prev, market, [...baseList, drawing]);
      });
      setSelectedDrawingId(drawing.id);
    },
    [market]
  );

  const handleLiveUpdateDrawings = useCallback(
    (nextDrawings: DrawingObject[]) => {
      setHistory((prev) => replacePresentWithoutCommit(prev, market, nextDrawings));
    },
    [market]
  );

  const handleCommitDrawingDrag = useCallback(
    (beforeSnapshot: DrawingObject[], afterDrawings: DrawingObject[]) => {
      setHistory((prev) => commitFromSnapshot(prev, market, beforeSnapshot, afterDrawings));
    },
    [market]
  );

  const handleUpdateSelectedDrawing = useCallback(
    (patch: Partial<DrawingObject>) => {
      if (!selectedDrawingId) return;
      setHistory((prev) => {
        const next = prev[market].present.map((d) =>
          d.id === selectedDrawingId ? { ...d, ...patch } : d
        );
        return commitDrawingChange(prev, market, next);
      });
    },
    [market, selectedDrawingId]
  );

  const handleDuplicateSelectedDrawing = useCallback(() => {
    if (!selectedDrawingId) return;
    const found = currentDrawings.find((d) => d.id === selectedDrawingId);
    if (!found) return;
    const plotW = chartRef.current?.getPlotWidth() || 800;
    const range = computePriceRange(candlesRef.current, currentViewport, {
      x: 0,
      y: 0,
      width: plotW,
      height: 400,
    });
    const dup = duplicateDrawing(found, currentInterval, range.max - range.min);
    setHistory((prev) => commitDrawingChange(prev, market, [...prev[market].present, dup]));
    setSelectedDrawingId(dup.id);
  }, [currentDrawings, currentInterval, currentViewport, market, selectedDrawingId]);

  const handleDeleteDrawingById = useCallback(
    (id: string) => {
      setHistory((prev) =>
        commitDrawingChange(
          prev,
          market,
          prev[market].present.filter((d) => d.id !== id)
        )
      );
      setSelectedDrawingId((cur) => (cur === id ? null : cur));
    },
    [market]
  );

  const handleToggleFullScreen = useCallback(() => {
    setIsFullScreen((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.requestFullscreen?.().catch(() => {
          // App-level maximized layout still active even inside iframe
        });
      } else if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
      return next;
    });
  }, []);

  const handleDownloadImage = useCallback(() => {
    const canvases = chartRef.current?.getCanvases();
    if (!canvases?.baseCanvas || !canvases?.drawingCanvas) return;
    downloadChartImage({
      baseCanvas: canvases.baseCanvas,
      drawingCanvas: canvases.drawingCanvas,
      market,
      interval: currentInterval,
      theme,
    });
  }, [currentInterval, market, theme]);

  const selectedDrawing = useMemo(
    () => currentDrawings.find((d) => d.id === selectedDrawingId) ?? null,
    [currentDrawings, selectedDrawingId]
  );

  const activeAlertsCount = useMemo(
    () => alerts.filter((a) => a.market === market && a.active && !a.triggered).length,
    [alerts, market]
  );

  const handleOpeningComplete = useCallback(() => {
    setShowOpening(false);
  }, []);

  const handleCancelActiveTool = useCallback(() => {
    setActiveToolId('tool_cross');
  }, []);

  const handleSelectTool = useCallback((toolId: string, glyph?: string) => {
    setActiveToolId(toolId);
    if (glyph) setSelectedVisualGlyph(glyph);
    if (toolId !== 'tool_cross') {
      setIsFreeCrosshair(false);
    }
  }, []);

  const handleToggleFreeCrosshair = useCallback(() => {
    setIsFreeCrosshair((prev) => {
      const next = !prev;
      if (next) {
        setActiveToolId('tool_cross');
      }
      return next;
    });
  }, []);

  const handleSelectReplayIndex = useCallback(
    (cutIndex: number) => {
      // Do not start playback automatically (Req 24)
      setReplay((prev) => ({
        ...prev,
        mode: 'READY',
        cutIndex,
      }));
      setViewports((prev) => ({
        ...prev,
        [market]: {
          ...prev[market],
          rightOffset: Math.max(cutIndex + 10, 20),
        },
      }));
    },
    [market]
  );

  const handleRetryLoad = useCallback(() => {
    setRetryNonce((n) => n + 1);
  }, []);

  const handleSelectFavoriteTool = useCallback(
    (toolId: string) => handleSelectTool(toolId),
    [handleSelectTool]
  );

  const handleHideFavoritesBar = useCallback(() => {
    setFavoritesState((prev) => ({
      ...prev,
      showOnChart: setShowFavoritesBar(false),
    }));
  }, []);

  const handleFavoritesPositionChange = useCallback((pos: { x: number; y: number }) => {
    setFavoritesState((prev) => ({
      ...prev,
      position: setFavoritesBarPosition(pos),
    }));
  }, []);

  const handleDeleteSelectedDrawing = useCallback(() => {
    if (selectedDrawing) handleDeleteDrawingById(selectedDrawing.id);
  }, [handleDeleteDrawingById, selectedDrawing]);

  const handleDeselectDrawing = useCallback(() => {
    setSelectedDrawingId(null);
  }, []);

  const handleReplayPlay = useCallback(() => {
    setReplay((r) => ({ ...r, mode: 'PLAYING' }));
  }, []);

  const handleReplayPause = useCallback(() => {
    setReplay((r) => ({ ...r, mode: 'PAUSED' }));
  }, []);

  const handleReplayStepForward = useCallback(() => {
    setReplay((r) => stepReplayForward(r, candlesRef.current.length));
  }, []);

  const handleReplayStepBackward = useCallback(() => {
    setReplay((r) => stepReplayBackward(r));
  }, []);

  const handleReplayChangeSpeed = useCallback((speed: ReplaySpeed) => {
    setReplay((r) => ({ ...r, speed }));
  }, []);

  const handleReplayExit = useCallback(() => {
    setReplay(DEFAULT_REPLAY_STATE);
    setViewports((prev) => ({
      ...prev,
      [marketRef.current]: {
        ...prev[marketRef.current],
        rightOffset: Math.max(candlesRef.current.length + 8, 20),
        autoScaleY: true,
      },
    }));
  }, []);

  const handleOpenMarketModal = useCallback(() => setIsMarketModalOpen(true), []);
  const handleCloseMarketModal = useCallback(() => setIsMarketModalOpen(false), []);
  const handleOpenIntervalModal = useCallback(() => setIsIntervalModalOpen(true), []);
  const handleCloseIntervalModal = useCallback(() => setIsIntervalModalOpen(false), []);
  const handleToggleDrawingPanel = useCallback(() => setIsDrawingPanelOpen((v) => !v), []);
  const handleCloseDrawingPanel = useCallback(() => setIsDrawingPanelOpen(false), []);
  const handleToggleThreeDots = useCallback(() => setIsThreeDotsOpen((v) => !v), []);
  const handleCloseThreeDots = useCallback(() => setIsThreeDotsOpen(false), []);
  const handleOpenIndicators = useCallback(() => setIsIndicatorsOpen(true), []);
  const handleCloseIndicators = useCallback(() => setIsIndicatorsOpen(false), []);
  const handleOpenAlerts = useCallback(() => setIsAlertsOpen(true), []);
  const handleCloseAlerts = useCallback(() => setIsAlertsOpen(false), []);
  const handleUndo = useCallback(() => setHistory((h) => undoMarketHistory(h, marketRef.current)), []);
  const handleRedo = useCallback(() => setHistory((h) => redoMarketHistory(h, marketRef.current)), []);
  const handleToggleTheme = useCallback(
    () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    []
  );
  const handleToggleFavorite = useCallback(
    (toolId: string) =>
      setFavoritesState((prev) => ({
        ...prev,
        ids: toggleFavoriteTool(prev.ids, toolId),
      })),
    []
  );
  const handleToggleShowFavoritesOnChart = useCallback(
    () =>
      setFavoritesState((prev) => ({
        ...prev,
        showOnChart: setShowFavoritesBar(!prev.showOnChart),
      })),
    []
  );
  const handleStartReplay = useCallback(() => {
    setSelectedDrawingId(null);
    setActiveToolId('tool_cross');
    setReplay((prev) =>
      prev.mode === 'OFF' ? { ...DEFAULT_REPLAY_STATE, mode: 'SELECTING' } : DEFAULT_REPLAY_STATE
    );
  }, []);

  const tickersRef = useRef(tickers);
  tickersRef.current = tickers;

  const handleCreateAlert = useCallback(
    (params: {
      market: MarketSymbol;
      price: number;
      condition: AlertCondition;
      note: string;
    }) => {
      setAlerts((prev) =>
        createAlert(prev, {
          ...params,
          currentPrice: tickersRef.current[params.market]?.price,
        })
      );
    },
    []
  );

  const handleUpdateAlert = useCallback(
    (
      id: string,
      patch: Partial<Pick<PriceAlert, 'price' | 'condition' | 'note' | 'active' | 'triggered'>>
    ) => {
      setAlerts((prev) => updateAlert(prev, id, patch));
    },
    []
  );

  const handleDeleteAlert = useCallback((id: string) => {
    setAlerts((prev) => deleteAlert(prev, id));
  }, []);

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[#FAF8F3] dark:bg-[#080808] text-[#141311] dark:text-[#F5F5F7]">
      {showOpening && <OpeningScreen isReady={!isLoadingCandles} onComplete={handleOpeningComplete} />}

      {/* MAIN CHART VIEWPORT (Chart-First, Bottom Navigation Bar) */}
      <main className="relative flex-1 min-h-0 w-full overflow-hidden">
        <ChartCanvas
          ref={chartRef}
          market={market}
          interval={currentInterval}
          theme={theme}
          candlesRef={candlesRef}
          candlesVersion={candlesVersion}
          viewport={currentViewport}
          onViewportChange={handleViewportChange}
          drawings={currentDrawings}
          selectedDrawingId={selectedDrawingId}
          activeToolId={activeToolId}
          selectedVisualGlyph={selectedVisualGlyph}
          alerts={alerts}
          replay={replay}
          isFullScreen={isFullScreen}
          isFreeCrosshair={isFreeCrosshair}
          isLoading={isLoadingCandles}
          errorMessage={dataError}
          onSelectDrawing={setSelectedDrawingId}
          onAddDrawing={handleAddDrawing}
          onLiveUpdateDrawings={handleLiveUpdateDrawings}
          onCommitDrawingDrag={handleCommitDrawingDrag}
          onDeleteDrawingById={handleDeleteDrawingById}
          onCancelActiveTool={handleCancelActiveTool}
          onSelectReplayIndex={handleSelectReplayIndex}
          onExitFullScreen={handleToggleFullScreen}
          onDownloadImage={handleDownloadImage}
          onRequestOlderCandles={handleRequestOlderCandles}
          onRetryLoad={handleRetryLoad}
        />

        {/* Floating Draggable Favorites Toolbar on Right Side of Chart */}
        <FloatingFavoritesBar
          visible={favoritesState.showOnChart}
          favoriteIds={favoritesState.ids}
          activeToolId={activeToolId}
          initialPosition={favoritesState.position}
          onSelectTool={handleSelectFavoriteTool}
          onHide={handleHideFavoritesBar}
          onPositionChange={handleFavoritesPositionChange}
        />

        {/* Selected Drawing Properties Toolbar */}
        <DrawingPropertiesBar
          drawing={selectedDrawing}
          onUpdate={handleUpdateSelectedDrawing}
          onDuplicate={handleDuplicateSelectedDrawing}
          onDelete={handleDeleteSelectedDrawing}
          onClose={handleDeselectDrawing}
        />

        {/* Bar Replay Controls */}
        <BarReplayControls
          replay={replay}
          totalCandles={candlesRef.current.length}
          onPlay={handleReplayPlay}
          onPause={handleReplayPause}
          onStepForward={handleReplayStepForward}
          onStepBackward={handleReplayStepBackward}
          onChangeSpeed={handleReplayChangeSpeed}
          onExit={handleReplayExit}
        />
      </main>

      {/* BOTTOM NAVIGATION BAR (All symbol & chart controls moved to bottom; Dark/Light switch strictly between Undo and Redo) */}
      <TopToolbar
        market={market}
        ticker={tickers[market]}
        connectionStatus={connectionStatus}
        interval={currentInterval}
        theme={theme}
        canUndo={canUndo(history, market)}
        canRedo={canRedo(history, market)}
        isFullScreen={isFullScreen}
        isDrawingPanelOpen={isDrawingPanelOpen}
        isThreeDotsOpen={isThreeDotsOpen}
        isFreeCrosshair={isFreeCrosshair}
        onOpenMarketSelector={handleOpenMarketModal}
        onOpenTimeframeMenu={handleOpenIntervalModal}
        onToggleDrawingPanel={handleToggleDrawingPanel}
        onToggleThreeDots={handleToggleThreeDots}
        onToggleFreeCrosshair={handleToggleFreeCrosshair}
        onUndo={handleUndo}
        onToggleTheme={handleToggleTheme}
        onRedo={handleRedo}
        onToggleFullScreen={handleToggleFullScreen}
      />

      {/* MODALS & MENUS */}
      <MarketSelectorModal
        open={isMarketModalOpen}
        selectedMarket={market}
        tickers={isMarketModalOpen ? tickers : EMPTY_TICKERS}
        connectionStatus={connectionStatus}
        onSelect={handleSelectMarket}
        onClose={handleCloseMarketModal}
      />

      <IntervalMenuModal
        open={isIntervalModalOpen}
        selectedInterval={currentInterval}
        onSelectInterval={handleSelectInterval}
        onClose={handleCloseIntervalModal}
      />

      <DrawingToolsPanel
        open={isDrawingPanelOpen}
        activeToolId={activeToolId}
        favoriteIds={favoritesState.ids}
        showFavoritesOnChart={favoritesState.showOnChart}
        selectedVisualGlyph={selectedVisualGlyph}
        onSelectTool={handleSelectTool}
        onToggleFavorite={handleToggleFavorite}
        onToggleShowFavoritesOnChart={handleToggleShowFavoritesOnChart}
        onClose={handleCloseDrawingPanel}
      />

      <ThreeDotsMenu
        open={isThreeDotsOpen}
        activeAlertsCount={activeAlertsCount}
        isReplayActive={replay.mode !== 'OFF'}
        canInstallApp={pwaInstall.isInstallable}
        isInstalledApp={pwaInstall.isInstalled}
        isIOS={pwaInstall.isIOS}
        onInstallApp={pwaInstall.install}
        onOpenIndicators={handleOpenIndicators}
        onOpenAlerts={handleOpenAlerts}
        onStartReplay={handleStartReplay}
        onClose={handleCloseThreeDots}
      />

      <IndicatorsModal
        open={isIndicatorsOpen}
        onClose={handleCloseIndicators}
      />

      <AlertsModal
        open={isAlertsOpen}
        market={market}
        currentPrice={isAlertsOpen ? tickers[market]?.price : undefined}
        connectionStatus={connectionStatus}
        alerts={alerts}
        onCreateAlert={handleCreateAlert}
        onUpdateAlert={handleUpdateAlert}
        onDeleteAlert={handleDeleteAlert}
        onClose={handleCloseAlerts}
      />

      {/* Triggered Price Alert Notification Toasts */}
      {triggeredToasts.length > 0 && (
        <div className="fixed top-3 right-3 z-50 flex flex-col gap-2 max-w-xs">
          {triggeredToasts.map((toast) => (
            <div
              key={toast.id}
              className="flex items-start gap-2.5 rounded-lg border border-[#FFFFFF]/70 bg-[#101012]/95 p-3 text-[#F5F5F7] shadow-2xl backdrop-blur-md"
            >
              <BellRing className="w-4 h-4 text-[#FFFFFF] shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold tracking-[0.12em] text-[#FFFFFF]">
                  PRICE ALERT TRIGGERED · {toast.market}
                </div>
                <div className="mt-0.5 font-mono-num text-xs text-[#F5F5F7]">
                  REACHED {formatPrice(toast.price, MARKETS[toast.market].decimals)}
                  {toast.note ? ` · ${toast.note}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setTriggeredToasts((prev) => prev.filter((item) => item.id !== toast.id))
                }
                aria-label="Dismiss alert toast"
                className="text-[#9A9892] hover:text-[#FFFFFF] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
