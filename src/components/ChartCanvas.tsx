import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Check, Download, Minus, Plus, RotateCcw, X } from 'lucide-react';
import {
  Candle,
  CrosshairData,
  DrawingObject,
  MarketSymbol,
  PriceAlert,
  ReplayState,
  ThemeMode,
  TimeframeId,
  ViewportState,
  WorldPoint,
} from '../types/chart';
import { renderBaseChart } from '../modules/chartEngine';
import {
  applyFibSnapToAttachedRectangles,
  constrainRectangleToTrendLine,
  findAttachedTrendLineForRectangle,
  findNearbyTrendLine,
  findTrendLineTouchPoint,
  hitTestDrawings,
  LaserTrailPoint,
  moveDrawingByDelta,
  renderDrawingsLayer,
  resizeDrawingHandle,
  snapMovedFibToTrendLines,
  snapMovedRectangleToTrendLines,
  snapPointToCandle,
  snapPointToCandleBody,
  snapPointToTrendLines,
} from '../modules/drawingEngine';
import { loadFibSettingsPreset } from '../modules/drawingStorage';
import { TOOL_BY_ID } from '../modules/drawingCatalogue';
import { getInitialChartDpr, PerformanceMonitor } from '../modules/performanceMonitor';
import { formatPrice, isMarketOpen, MARKETS } from '../modules/timeframeManager';
import {
  ComputedPriceRange,
  computePriceRange,
  getPlotRect,
  panViewport,
  PRICE_AXIS_WIDTH,
  priceToY,
  timeToX,
  xToIndex,
  xToTime,
  yToPrice,
  zoomHorizontalAt,
  zoomVerticalAt,
} from '../modules/zoomPanEngine';

const SHIFT_ANGLE_TOOLS = new Set([
  'trend_line',
  'trend_arrow',
  'shape_arrow',
  'arrow_marker',
  'ray',
  'extended_line',
  'info_line',
  'trend_angle',
  'callout',
  'parallel_channel',
  'flat_top_bottom',
  'disjoint_channel',
  'fib_channel',
]);

export interface ChartCanvasHandle {
  getCanvases: () => {
    baseCanvas: HTMLCanvasElement | null;
    drawingCanvas: HTMLCanvasElement | null;
  };
  requestRedraw: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetScale: () => void;
  getPlotWidth: () => number;
}

interface ChartCanvasProps {
  market: MarketSymbol;
  interval: TimeframeId;
  theme: ThemeMode;
  candlesRef: React.MutableRefObject<Candle[]>;
  candlesVersion: number;
  viewport: ViewportState;
  onViewportChange: (next: ViewportState) => void;
  drawings: DrawingObject[];
  selectedDrawingId: string | null;
  activeToolId: string;
  selectedVisualGlyph: string;
  alerts: PriceAlert[];
  replay: ReplayState;
  isFullScreen: boolean;
  isFreeCrosshair: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  onSelectDrawing: (id: string | null) => void;
  onAddDrawing: (drawing: DrawingObject, updatedExistingDrawings?: DrawingObject[]) => void;
  onLiveUpdateDrawings: (next: DrawingObject[]) => void;
  onCommitDrawingDrag: (beforeSnapshot: DrawingObject[], afterDrawings: DrawingObject[]) => void;
  onDeleteDrawingById: (id: string) => void;
  onCancelActiveTool: () => void;
  onSelectReplayIndex: (index: number) => void;
  onExitFullScreen: () => void;
  onDownloadImage: () => void;
  onRequestOlderCandles: () => void;
  onRetryLoad?: () => void;
}

export const ChartCanvas = React.memo(
  React.forwardRef<ChartCanvasHandle, ChartCanvasProps>(
    (
      {
        market,
        interval,
        theme,
        candlesRef,
        candlesVersion,
        viewport,
        onViewportChange,
        drawings,
        selectedDrawingId,
        activeToolId,
        selectedVisualGlyph,
        alerts,
        replay,
        isFullScreen,
        isFreeCrosshair,
        isLoading,
        errorMessage,
        onSelectDrawing,
        onAddDrawing,
        onCommitDrawingDrag,
        onDeleteDrawingById,
        onCancelActiveTool,
        onSelectReplayIndex,
        onExitFullScreen,
        onDownloadImage,
        onRequestOlderCandles,
        onRetryLoad,
      },
      ref
    ) => {
      const containerRef = useRef<HTMLDivElement | null>(null);
      const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
      const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
      const baseCtxRef = useRef<CanvasRenderingContext2D | null>(null);
      const drawingCtxRef = useRef<CanvasRenderingContext2D | null>(null);

      const sizeRef = useRef({ width: 900, height: 520 });
      const dprRef = useRef<number>(getInitialChartDpr());
      const canvasRectRef = useRef<{ left: number; top: number }>({ left: 0, top: 0 });
      const pendingPointerMoveRef = useRef<{
        x: number;
        y: number;
        shiftKey: boolean;
        magnet: boolean;
      } | null>(null);
      const pendingTouchPinchRef = useRef<{
        x1: number;
        y1: number;
        x2: number;
        y2: number;
      } | null>(null);
      const dirtyBaseRef = useRef(true);
      const dirtyDrawingRef = useRef(true);
      const perfRef = useRef(new PerformanceMonitor());

    // Latest props stored in refs for zero-lag RAF rendering & gesture handlers
    const viewportRef = useRef(viewport);
    const drawingsRef = useRef(drawings);
    const selectedIdRef = useRef(selectedDrawingId);
    const activeToolRef = useRef(activeToolId);
    const visualGlyphRef = useRef(selectedVisualGlyph);
    const alertsRef = useRef(alerts);
    const replayRef = useRef(replay);
    const themeRef = useRef(theme);
    const marketRef = useRef(market);
    const intervalRef = useRef(interval);
    const freeCrosshairRef = useRef(isFreeCrosshair);

    // Interactive drawing & gesture refs
    const draftRef = useRef<DrawingObject | null>(null);
    const fibManualAnchorRef = useRef<WorldPoint | null>(null);
    const rectAttachedTlRef = useRef<{ tl: DrawingObject; touchPt: WorldPoint } | null>(null);
    const [hasActiveDraft, setHasActiveDraft] = useState(false);
    const laserTrailRef = useRef<LaserTrailPoint[]>([]);
    const replayHoverIdxRef = useRef<number | null>(null);
    const hoveredHitRef = useRef<{ drawingId: string; handleIndex: number } | null>(null);
    const longPressTimerRef = useRef<number | null>(null);

    // Drag states (declared before syncing drawingsRef so active drags are never overwritten mid-gesture)
    const dragModeRef = useRef<
      | { kind: 'none' }
      | {
          kind: 'pan';
          startX: number;
          startY: number;
          startViewport: ViewportState;
          verticalUnlocked: boolean;
          verticalOriginY: number;
          lockedRange: ComputedPriceRange | null;
        }
      | { kind: 'crosshairDrag'; temporary: boolean }
      | { kind: 'priceScale'; startY: number; startViewport: ViewportState }
      | {
          kind: 'moveDrawing';
          drawingId: string;
          beforeSnapshot: DrawingObject[];
          originDrawing: DrawingObject;
          startTime: number;
          startPrice: number;
        }
      | {
          kind: 'resizeHandle';
          drawingId: string;
          handleIndex: number;
          beforeSnapshot: DrawingObject[];
          originDrawing: DrawingObject;
        }
      | { kind: 'freehand'; drawing: DrawingObject }
      | { kind: 'laser' }
      | { kind: 'dragCreate2pt'; startX: number; startY: number; moved: boolean }
    >({ kind: 'none' });

    if (dragModeRef.current.kind !== 'moveDrawing' && dragModeRef.current.kind !== 'resizeHandle') {
      drawingsRef.current = drawings;
    }
    selectedIdRef.current = selectedDrawingId;
    activeToolRef.current = activeToolId;
    visualGlyphRef.current = selectedVisualGlyph;
    alertsRef.current = alerts;
    replayRef.current = replay;
    themeRef.current = theme;
    marketRef.current = market;
    intervalRef.current = interval;
    freeCrosshairRef.current = isFreeCrosshair;

    const crosshairRef = useRef<CrosshairData>({
      visible: false,
      x: 0,
      y: 0,
      time: 0,
      price: 0,
      candle: null,
    });

    // Kinetic momentum panning (X & Y), smooth zoom easing, smooth auto-scale Y, & live candle glide
    const inertiaVelocityXRef = useRef(0);
    const inertiaVelocityYRef = useRef(0);
    const lastPanSampleRef = useRef<{ x: number; y: number; t: number } | null>(null);
    const viewportCommitTimerRef = useRef<number | null>(null);
    const onViewportChangeRef = useRef(onViewportChange);
    onViewportChangeRef.current = onViewportChange;

    const zoomTargetRef = useRef<{
      active: boolean;
      barSpacing: number;
      rightOffset: number;
      autoScaleY: boolean;
      priceMin: number;
      priceMax: number;
    } | null>(null);
    const liveCandleVisualRef = useRef<{
      market: MarketSymbol;
      interval: TimeframeId;
      barTime: number;
      close: number;
      high: number;
      low: number;
    } | null>(null);
    const visualRangeRef = useRef<{
      market: MarketSymbol;
      interval: TimeframeId;
      min: number;
      max: number;
    } | null>(null);
    const rafIdRef = useRef<number | null>(null);
    const scheduleFrameRef = useRef<() => void>(() => {});

    const scheduleViewportCommit = useCallback((immediate = false) => {
      if (viewportCommitTimerRef.current !== null) {
        clearTimeout(viewportCommitTimerRef.current);
        viewportCommitTimerRef.current = null;
      }
      if (immediate) {
        onViewportChangeRef.current(viewportRef.current);
        return;
      }
      viewportCommitTimerRef.current = window.setTimeout(() => {
        viewportCommitTimerRef.current = null;
        onViewportChangeRef.current(viewportRef.current);
      }, 140);
    }, []);

    useEffect(() => {
      return () => {
        if (viewportCommitTimerRef.current !== null) {
          clearTimeout(viewportCommitTimerRef.current);
        }
      };
    }, []);

    // Pinch-to-zoom touch state
    const pinchRef = useRef<{
      active: boolean;
      startDist: number;
      startDistY: number;
      startMidX: number;
      startMidY: number;
      startViewport: ViewportState;
    }>({
      active: false,
      startDist: 0,
      startDistY: 0,
      startMidX: 0,
      startMidY: 0,
      startViewport: viewport,
    });

    const olderFetchCooldownRef = useRef(0);

    const getVisibleCandles = useCallback((): Candle[] => {
      const all = candlesRef.current;
      const rp = replayRef.current;
      if (rp.mode === 'OFF' || rp.mode === 'SELECTING' || rp.cutIndex === null) {
        return all;
      }
      return all.slice(0, Math.max(1, Math.min(all.length, rp.cutIndex + 1)));
    }, [candlesRef]);

    const getActivePriceRange = useCallback(
      (vis: Candle[], plot: { x: number; y: number; width: number; height: number }): ComputedPriceRange => {
        if (
          viewportRef.current.autoScaleY &&
          replayRef.current.mode !== 'SELECTING' &&
          vis.length > 0 &&
          visualRangeRef.current &&
          visualRangeRef.current.market === marketRef.current &&
          visualRangeRef.current.interval === intervalRef.current
        ) {
          return { min: visualRangeRef.current.min, max: visualRangeRef.current.max };
        }
        return computePriceRange(vis, viewportRef.current, plot);
      },
      []
    );

    const requestRedraw = useCallback((base = true, drawing = true) => {
      if (base) dirtyBaseRef.current = true;
      if (drawing) dirtyDrawingRef.current = true;
      scheduleFrameRef.current();
    }, []);

    const commitCompletedDrawing = useCallback(
      (finished: DrawingObject) => {
        fibManualAnchorRef.current = null;
        rectAttachedTlRef.current = null;
        if (finished.toolId === 'fib_retracement' && finished.points.length >= 2) {
          const { width, height } = sizeRef.current;
          const plot = getPlotRect(width, height);
          const vis = getVisibleCandles();
          const priceRange = getActivePriceRange(vis, plot);
          const matchedTl = drawingsRef.current.find(
            (d) =>
              d.toolId === 'trend_line' &&
              d.meta?.visible !== false &&
              d.points.length >= 2 &&
              Math.abs(d.points[0].time - finished.points[0].time) < 1e-6 &&
              Math.abs(d.points[0].price - finished.points[0].price) < 1e-6 &&
              Math.abs(d.points[1].time - finished.points[1].time) < 1e-6 &&
              Math.abs(d.points[1].price - finished.points[1].price) < 1e-6
          );
          if (matchedTl) {
            const updatedExisting = applyFibSnapToAttachedRectangles(
              drawingsRef.current,
              finished,
              matchedTl,
              vis,
              intervalRef.current,
              viewportRef.current,
              priceRange,
              plot
            );
            if (updatedExisting !== drawingsRef.current) {
              onAddDrawing(finished, updatedExisting);
              return;
            }
          }
        }
        onAddDrawing(finished);
      },
      [getActivePriceRange, getVisibleCandles, onAddDrawing]
    );

    const screenToWorld = useCallback(
      (
        x: number,
        y: number,
        forceMagnet = false,
        toolIdOverride?: string,
        anchorWorldPt?: WorldPoint,
        pointIndex = 0
      ): WorldPoint => {
        const { width, height } = sizeRef.current;
        const plot = getPlotRect(width, height);
        const vis = getVisibleCandles();
        const range = getActivePriceRange(vis, plot);
        const rawTime = xToTime(x, vis, intervalRef.current, viewportRef.current, plot);
        const rawPrice = yToPrice(y, range, plot);
        const effTool = toolIdOverride ?? activeToolRef.current;

        if (effTool === 'trend_line' && pointIndex === 0) {
          return snapPointToCandleBody(
            rawTime,
            rawPrice,
            vis,
            intervalRef.current,
            range,
            plot,
            viewportRef.current.barSpacing,
            15
          );
        }

        if (effTool === 'rectangle') {
          const hasTrendLines = drawingsRef.current.some(
            (d) => d.toolId === 'trend_line' && d.meta?.visible !== false && d.points.length >= 2
          );
          if (hasTrendLines) {
            return snapPointToTrendLines(
              rawTime,
              rawPrice,
              drawingsRef.current,
              vis,
              intervalRef.current,
              viewportRef.current,
              range,
              plot,
              anchorWorldPt,
              42
            );
          }
        }

        if (activeToolRef.current === 'tool_magic' || forceMagnet) {
          return snapPointToCandle(rawTime, rawPrice, vis, intervalRef.current, range, plot);
        }
        return { time: rawTime, price: rawPrice };
      },
      [getVisibleCandles]
    );

    const resolveInteractivePoint = useCallback(
      (
        x: number,
        y: number,
        shiftKey: boolean,
        magnetKey: boolean,
        anchorWorldPt?: WorldPoint,
        toolId?: string,
        pointIndex = 1
      ): { worldPt: WorldPoint; screenX: number; screenY: number } => {
        let sx = x;
        let sy = y;
        const { width, height } = sizeRef.current;
        const plot = getPlotRect(width, height);
        const vis = getVisibleCandles();
        const range = getActivePriceRange(vis, plot);
        const effTool = toolId ?? activeToolRef.current;
        const blockShiftForTrendStart = effTool === 'trend_line' && pointIndex === 0;

        let lockedPrice: number | null = null;
        let lockedTime: number | null = null;
        let snappedStraight = false;

        if (
          shiftKey &&
          anchorWorldPt &&
          toolId &&
          !blockShiftForTrendStart &&
          SHIFT_ANGLE_TOOLS.has(toolId)
        ) {
          const ax = timeToX(anchorWorldPt.time, vis, intervalRef.current, viewportRef.current, plot);
          const ay = priceToY(anchorWorldPt.price, range, plot);
          const dx = x - ax;
          const dy = y - ay;
          if (Math.hypot(dx, dy) > 4) {
            const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
            const mod = ((sector % 8) + 8) % 8;
            if (mod === 0 || mod === 4) {
              sx = x;
              sy = ay;
              lockedPrice = anchorWorldPt.price;
              snappedStraight = true;
            } else if (mod === 2 || mod === 6) {
              sx = ax;
              sy = y;
              lockedTime = anchorWorldPt.time;
              snappedStraight = true;
            } else {
              const diag = Math.max(Math.abs(dx), Math.abs(dy));
              sx = ax + Math.sign(dx || 1) * diag;
              sy = ay + Math.sign(dy || 1) * diag;
            }
          }
        } else if (
          effTool === 'trend_line' &&
          pointIndex > 0 &&
          anchorWorldPt &&
          !magnetKey
        ) {
          // Strong magnetic attraction toward a straight horizontal/vertical line after placing trend line start point
          const ax = timeToX(anchorWorldPt.time, vis, intervalRef.current, viewportRef.current, plot);
          const ay = priceToY(anchorWorldPt.price, range, plot);
          const dx = x - ax;
          const dy = y - ay;
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);
          const horizSnapRadius = Math.max(28, Math.min(54, absDx * 0.18));
          const vertSnapRadius = 18;

          if (absDx >= 4 && absDy <= horizSnapRadius) {
            sx = x;
            sy = ay;
            lockedPrice = anchorWorldPt.price;
            snappedStraight = true;
          } else if (absDy >= 14 && absDx <= vertSnapRadius) {
            sx = ax;
            sy = y;
            lockedTime = anchorWorldPt.time;
            snappedStraight = true;
          }
        }

        let worldPt = screenToWorld(sx, sy, magnetKey, toolId, anchorWorldPt, pointIndex);
        if (lockedPrice !== null || lockedTime !== null) {
          worldPt = {
            time: lockedTime !== null ? lockedTime : worldPt.time,
            price: lockedPrice !== null ? lockedPrice : worldPt.price,
          };
        }

        const shouldUseSnappedScreen =
          (shiftKey && !blockShiftForTrendStart) ||
          snappedStraight ||
          magnetKey ||
          activeToolRef.current === 'tool_magic' ||
          (effTool === 'trend_line' && pointIndex === 0) ||
          effTool === 'rectangle';

        const finalScreenX = shouldUseSnappedScreen
          ? timeToX(worldPt.time, vis, intervalRef.current, viewportRef.current, plot)
          : sx;
        const finalScreenY = shouldUseSnappedScreen ? priceToY(worldPt.price, range, plot) : sy;

        return { worldPt, screenX: finalScreenX, screenY: finalScreenY };
      },
      [getActivePriceRange, getVisibleCandles, screenToWorld]
    );

    const syncCanvasCursor = useCallback((localX?: number, localY?: number) => {
      const canvas = drawingCanvasRef.current;
      if (!canvas) return;
      if (replayRef.current.mode === 'SELECTING') {
        canvas.style.cursor = 'col-resize';
        return;
      }
      const mode = dragModeRef.current.kind;
      if (mode === 'pan' || mode === 'moveDrawing') {
        canvas.style.cursor = 'grabbing';
        return;
      }
      if (mode === 'crosshairDrag') {
        canvas.style.cursor = 'crosshair';
        return;
      }
      if (mode === 'resizeHandle') {
        const hi = dragModeRef.current.kind === 'resizeHandle' ? dragModeRef.current.handleIndex : -1;
        const isRect =
          dragModeRef.current.kind === 'resizeHandle' &&
          dragModeRef.current.originDrawing.toolId === 'rectangle';
        canvas.style.cursor =
          isRect && (hi === 4 || hi === 5)
            ? 'ns-resize'
            : isRect && (hi === 6 || hi === 7)
              ? 'ew-resize'
              : 'pointer';
        return;
      }
      if (mode === 'priceScale') {
        canvas.style.cursor = 'ns-resize';
        return;
      }
      const tool = TOOL_BY_ID[activeToolRef.current];
      if (activeToolRef.current === 'tool_eraser') {
        canvas.style.cursor = hoveredHitRef.current ? 'pointer' : 'not-allowed';
        return;
      }
      if (tool && !tool.isCursorTool) {
        canvas.style.cursor = 'crosshair';
        return;
      }
      if (localX !== undefined && localY !== undefined) {
        const { width, height } = sizeRef.current;
        const plot = getPlotRect(width, height);
        if (localX > plot.width && localY <= plot.height) {
          canvas.style.cursor = 'ns-resize';
          return;
        }
      }
      if (hoveredHitRef.current) {
        const hi = hoveredHitRef.current.handleIndex;
        if (hi >= 0) {
          const hovDrawing = drawingsRef.current.find(
            (d) => d.id === hoveredHitRef.current?.drawingId
          );
          if (hovDrawing?.toolId === 'rectangle') {
            canvas.style.cursor =
              hi === 4 || hi === 5 ? 'ns-resize' : hi === 6 || hi === 7 ? 'ew-resize' : 'pointer';
            return;
          }
          canvas.style.cursor = 'pointer';
        } else {
          canvas.style.cursor = 'grab';
        }
        return;
      }
      canvas.style.cursor = activeToolRef.current === 'tool_arrow' ? 'default' : 'crosshair';
    }, []);

    const maybeFetchOlder = useCallback(
      (vp: ViewportState) => {
        if (replayRef.current.mode !== 'OFF') return;
        const { width, height } = sizeRef.current;
        const plot = getPlotRect(width, height);
        const leftIdx = xToIndex(plot.x, vp, plot);
        const now = Date.now();
        if (leftIdx < 16 && now - olderFetchCooldownRef.current > 2500) {
          olderFetchCooldownRef.current = now;
          onRequestOlderCandles();
        }
      },
      [onRequestOlderCandles]
    );

    useImperativeHandle(
      ref,
      () => ({
        getCanvases: () => ({
          baseCanvas: baseCanvasRef.current,
          drawingCanvas: drawingCanvasRef.current,
        }),
        requestRedraw: () => requestRedraw(true, true),
        zoomIn: () => {
          const { width, height } = sizeRef.current;
          const plot = getPlotRect(width, height);
          const baseVp = zoomTargetRef.current?.active
            ? { ...viewportRef.current, ...zoomTargetRef.current }
            : viewportRef.current;
          const target = zoomHorizontalAt(baseVp, 1.25, plot.x + plot.width * 0.72, plot);
          zoomTargetRef.current = { active: true, ...target };
          scheduleViewportCommit(false);
          requestRedraw(true, true);
        },
        zoomOut: () => {
          const { width, height } = sizeRef.current;
          const plot = getPlotRect(width, height);
          const baseVp = zoomTargetRef.current?.active
            ? { ...viewportRef.current, ...zoomTargetRef.current }
            : viewportRef.current;
          const target = zoomHorizontalAt(baseVp, 0.8, plot.x + plot.width * 0.72, plot);
          zoomTargetRef.current = { active: true, ...target };
          scheduleViewportCommit(false);
          maybeFetchOlder(target);
          requestRedraw(true, true);
        },
        resetScale: () => {
          const vis = getVisibleCandles();
          const target: ViewportState = {
            ...viewportRef.current,
            rightOffset: Math.max(vis.length + 8, 20),
            barSpacing: 10,
            autoScaleY: true,
          };
          zoomTargetRef.current = { active: true, ...target };
          scheduleViewportCommit(false);
          requestRedraw(true, true);
        },
        getPlotWidth: () => getPlotRect(sizeRef.current.width, sizeRef.current.height).width,
      }),
      [getVisibleCandles, maybeFetchOlder, requestRedraw, scheduleViewportCommit]
    );

    // Reset smooth visual close, Y range, & zoom target when market or interval changes
    useEffect(() => {
      liveCandleVisualRef.current = null;
      visualRangeRef.current = null;
      zoomTargetRef.current = null;
      inertiaVelocityXRef.current = 0;
      inertiaVelocityYRef.current = 0;
      viewportRef.current = viewport;
      requestRedraw(true, true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [market, interval]);

    // Sync external viewport changes only when no active gesture/animation is in flight
    useEffect(() => {
      if (
        dragModeRef.current.kind === 'none' &&
        !pinchRef.current.active &&
        !zoomTargetRef.current?.active &&
        Math.abs(inertiaVelocityXRef.current) <= 0.04 &&
        Math.abs(inertiaVelocityYRef.current) <= 0.04
      ) {
        viewportRef.current = viewport;
        requestRedraw(true, true);
      }
    }, [viewport, requestRedraw]);

    // Mark base+drawing dirty only when underlying market/candle/axis/theme props update
    useEffect(() => {
      requestRedraw(true, true);
    }, [
      candlesVersion,
      alerts,
      replay,
      theme,
      market,
      interval,
      requestRedraw,
    ]);

    // Drawings, selection, or active tool changes only need the interactive drawing layer redrawn
    useEffect(() => {
      requestRedraw(false, true);
    }, [drawings, selectedDrawingId, activeToolId, requestRedraw]);

    // Cancel draft on ESC or tool change to cursor tool
    const cancelDraft = useCallback(() => {
      if (draftRef.current) {
        draftRef.current = null;
        setHasActiveDraft(false);
        requestRedraw(false, true);
      }
    }, [requestRedraw]);

    const finishMultiPointDraft = useCallback(() => {
      const draft = draftRef.current;
      if (!draft) return;
      if (draft.points.length >= 2) {
        const finalized: DrawingObject = {
          ...draft,
          points: draft.points.slice(0, -1), // drop trailing live preview point
        };
        if (finalized.points.length >= 2) {
          onAddDrawing(finalized);
        }
      }
      draftRef.current = null;
      setHasActiveDraft(false);
      onCancelActiveTool();
      requestRedraw(false, true);
    }, [onAddDrawing, onCancelActiveTool, requestRedraw]);

    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          if (draftRef.current) {
            cancelDraft();
          } else {
            onCancelActiveTool();
            onSelectDrawing(null);
          }
        } else if (e.key === 'Enter' && draftRef.current) {
          finishMultiPointDraft();
        }
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [cancelDraft, finishMultiPointDraft, onCancelActiveTool, onSelectDrawing]);

    const syncCanvasBackingSize = useCallback((w: number, h: number, dpr: number) => {
      const targetW = Math.round(w * dpr);
      const targetH = Math.round(h * dpr);
      [baseCanvasRef.current, drawingCanvasRef.current].forEach((canvas) => {
        if (!canvas) return;
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      });
    }, []);

    const refreshCanvasRect = useCallback(() => {
      const el = drawingCanvasRef.current ?? containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      canvasRectRef.current = { left: rect.left, top: rect.top };
    }, []);

    // ResizeObserver for crisp DPR-scaled dual canvases (also caches bounding rect to avoid layout thrash)
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      let resizeRafId: number | null = null;
      let orientTimerId: number | null = null;

      const applyResize = () => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 16 || rect.height < 16) return;
        const w = Math.max(120, Math.floor(rect.width));
        const h = Math.max(80, Math.floor(rect.height));
        const dpr = getInitialChartDpr();
        canvasRectRef.current = { left: rect.left, top: rect.top };

        const sizeChanged =
          sizeRef.current.width !== w ||
          sizeRef.current.height !== h ||
          dprRef.current !== dpr;

        if (sizeChanged) {
          dprRef.current = dpr;
          sizeRef.current = { width: w, height: h };
          syncCanvasBackingSize(w, h, dpr);
          requestRedraw(true, true);
        }
      };

      const scheduleResize = () => {
        refreshCanvasRect();
        if (resizeRafId !== null) return;
        resizeRafId = requestAnimationFrame(() => {
          resizeRafId = null;
          applyResize();
        });
      };

      const onOrientationChange = () => {
        scheduleResize();
        if (orientTimerId !== null) clearTimeout(orientTimerId);
        orientTimerId = window.setTimeout(scheduleResize, 180);
      };

      applyResize();
      const observer = new ResizeObserver(scheduleResize);
      observer.observe(el);
      window.addEventListener('resize', scheduleResize, { passive: true });
      window.addEventListener('orientationchange', onOrientationChange, { passive: true });
      window.visualViewport?.addEventListener('resize', scheduleResize, { passive: true });
      return () => {
        observer.disconnect();
        window.removeEventListener('resize', scheduleResize);
        window.removeEventListener('orientationchange', onOrientationChange);
        window.visualViewport?.removeEventListener('resize', scheduleResize);
        if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
        if (orientTimerId !== null) clearTimeout(orientTimerId);
      };
    }, [refreshCanvasRect, requestRedraw, syncCanvasBackingSize]);

    const applyPointerMoveRef = useRef<
      (sample: { x: number; y: number; shiftKey: boolean; magnet: boolean }) => void
    >(() => {});
    const applyPinchMoveRef = useRef<
      (sample: { x1: number; y1: number; x2: number; y2: number }) => void
    >(() => {});

    // On-demand high-refresh-rate RAF render loop (60Hz / 90Hz / 120Hz+) with inertia, smooth zoom, & live candle glide
    useEffect(() => {
      let prevNow = performance.now();

      const onVisibilityChange = () => {
        if (!document.hidden) {
          prevNow = performance.now();
          perfRef.current.markResumed();
        }
      };
      document.addEventListener('visibilitychange', onVisibilityChange);

      const tick = (now: number) => {
        rafIdRef.current = null;
        const dt = Math.min(50, Math.max(1, now - prevNow));
        prevNow = now;
        perfRef.current.recordFrame(now);

        // Flush at most one coalesced touch pinch or pointer move sample per vsync frame
        if (pendingTouchPinchRef.current && pinchRef.current.active) {
          const sample = pendingTouchPinchRef.current;
          pendingTouchPinchRef.current = null;
          applyPinchMoveRef.current(sample);
        } else if (pendingPointerMoveRef.current && !pinchRef.current.active) {
          const sample = pendingPointerMoveRef.current;
          pendingPointerMoveRef.current = null;
          applyPointerMoveRef.current(sample);
        }

        let keepAnimating = false;

        // 1. Smooth target-viewport zoom animation (wheel & zoom buttons)
        const zt = zoomTargetRef.current;
        if (zt && zt.active) {
          const alpha = 1 - Math.exp(-dt / 42);
          const cur = viewportRef.current;
          const nextSpacing = cur.barSpacing + (zt.barSpacing - cur.barSpacing) * alpha;
          const nextOffset = cur.rightOffset + (zt.rightOffset - cur.rightOffset) * alpha;
          const nextMin = zt.autoScaleY
            ? cur.priceMin
            : cur.priceMin + (zt.priceMin - cur.priceMin) * alpha;
          const nextMax = zt.autoScaleY
            ? cur.priceMax
            : cur.priceMax + (zt.priceMax - cur.priceMax) * alpha;

          const doneZoom =
            Math.abs(zt.barSpacing - nextSpacing) < 0.015 &&
            Math.abs(zt.rightOffset - nextOffset) < 0.015 &&
            (zt.autoScaleY ||
              (Math.abs(zt.priceMin - nextMin) < 1e-4 && Math.abs(zt.priceMax - nextMax) < 1e-4));

          if (doneZoom) {
            viewportRef.current = {
              barSpacing: zt.barSpacing,
              rightOffset: zt.rightOffset,
              autoScaleY: zt.autoScaleY,
              priceMin: zt.priceMin,
              priceMax: zt.priceMax,
            };
            zoomTargetRef.current = null;
            scheduleViewportCommit(true);
          } else {
            viewportRef.current = {
              barSpacing: nextSpacing,
              rightOffset: nextOffset,
              autoScaleY: zt.autoScaleY,
              priceMin: nextMin,
              priceMax: nextMax,
            };
            keepAnimating = true;
          }
          dirtyBaseRef.current = true;
          dirtyDrawingRef.current = true;
        }

        // 2. Smooth kinetic horizontal + vertical inertia after pan release
        if (
          (Math.abs(inertiaVelocityXRef.current) > 0.04 || Math.abs(inertiaVelocityYRef.current) > 0.04) &&
          dragModeRef.current.kind === 'none'
        ) {
          const { width, height } = sizeRef.current;
          const plot = getPlotRect(width, height);
          const vis = getVisibleCandles();
          const dx = inertiaVelocityXRef.current * dt;
          const dy = !viewportRef.current.autoScaleY ? inertiaVelocityYRef.current * dt : 0;
          const next = panViewport(viewportRef.current, vis, dx, dy, plot, Math.abs(dy) > 0.01);
          viewportRef.current = next;
          maybeFetchOlder(next);
          dirtyBaseRef.current = true;
          dirtyDrawingRef.current = true;

          const friction = Math.pow(0.91, dt / 16.67);
          inertiaVelocityXRef.current *= friction;
          inertiaVelocityYRef.current *= friction;
          if (Math.abs(inertiaVelocityXRef.current) <= 0.04 && Math.abs(inertiaVelocityYRef.current) <= 0.04) {
            inertiaVelocityXRef.current = 0;
            inertiaVelocityYRef.current = 0;
            scheduleViewportCommit(true);
          } else {
            keepAnimating = true;
          }
        }

        // 3. Smooth live candle head easing (close, high, low glide cleanly up/down at 60/120Hz)
        const visCandles = getVisibleCandles();
        let liveCandleOverride: { close: number; high: number; low: number } | null = null;
        if (visCandles.length > 0 && replayRef.current.mode === 'OFF') {
          const last = visCandles[visCandles.length - 1];
          const curMarket = marketRef.current;
          const curInterval = intervalRef.current;
          const lv = liveCandleVisualRef.current;
          if (!lv || lv.market !== curMarket || lv.interval !== curInterval) {
            liveCandleVisualRef.current = {
              market: curMarket,
              interval: curInterval,
              barTime: last.time,
              close: last.close,
              high: last.high,
              low: last.low,
            };
          } else {
            if (lv.barTime !== last.time) {
              lv.barTime = last.time;
              lv.close = last.open;
              lv.high = last.open;
              lv.low = last.open;
            }
            const eps = curMarket === 'BTCUSD' ? 0.03 : 0.001;
            const needClose = Math.abs(last.close - lv.close) > eps;
            const needHigh = Math.abs(last.high - lv.high) > eps;
            const needLow = Math.abs(last.low - lv.low) > eps;

            if (needClose || needHigh || needLow) {
              const alpha = 1 - Math.exp(-dt / 46);
              lv.close = needClose ? lv.close + (last.close - lv.close) * alpha : last.close;
              lv.high = needHigh ? lv.high + (last.high - lv.high) * alpha : last.high;
              lv.low = needLow ? lv.low + (last.low - lv.low) * alpha : last.low;
              liveCandleOverride = {
                close: lv.close,
                high: Math.max(lv.high, lv.close, last.open),
                low: Math.min(lv.low, lv.close, last.open),
              };
              dirtyBaseRef.current = true;
              keepAnimating = true;
            } else {
              lv.close = last.close;
              lv.high = last.high;
              lv.low = last.low;
            }
          }
        }

        // 4. Decay laser pointer trail smoothly
        if (laserTrailRef.current.length > 0) {
          laserTrailRef.current = laserTrailRef.current.filter((pt) => now - pt.createdAt < 900);
          dirtyDrawingRef.current = true;
          if (laserTrailRef.current.length > 0) {
            keepAnimating = true;
          }
        }

        // 5. Smooth auto-scale Y transition so candles glide up/down smoothly when scrolling or ticking
        const { width, height } = sizeRef.current;
        const plot = getPlotRect(width, height);
        const targetRange = computePriceRange(visCandles, viewportRef.current, plot);
        const curMarket = marketRef.current;
        const curInterval = intervalRef.current;
        let effectivePriceRange = targetRange;

        if (
          viewportRef.current.autoScaleY &&
          replayRef.current.mode !== 'SELECTING' &&
          visCandles.length > 0
        ) {
          const vr = visualRangeRef.current;
          if (!vr || vr.market !== curMarket || vr.interval !== curInterval) {
            visualRangeRef.current = {
              market: curMarket,
              interval: curInterval,
              min: targetRange.min,
              max: targetRange.max,
            };
          } else {
            const span = Math.max(1e-6, targetRange.max - targetRange.min);
            const diffMin = Math.abs(targetRange.min - vr.min);
            const diffMax = Math.abs(targetRange.max - vr.max);
            if (diffMin > span * 0.0004 || diffMax > span * 0.0004) {
              const yAlpha = 1 - Math.exp(-dt / 40);
              vr.min += (targetRange.min - vr.min) * yAlpha;
              vr.max += (targetRange.max - vr.max) * yAlpha;
              effectivePriceRange = { min: vr.min, max: vr.max };
              dirtyBaseRef.current = true;
              dirtyDrawingRef.current = true;
              keepAnimating = true;
            } else {
              vr.min = targetRange.min;
              vr.max = targetRange.max;
            }
          }
        } else {
          visualRangeRef.current = {
            market: curMarket,
            interval: curInterval,
            min: targetRange.min,
            max: targetRange.max,
          };
        }

        if (dirtyBaseRef.current || dirtyDrawingRef.current) {
          const dpr = dprRef.current;

          if (dirtyBaseRef.current && baseCanvasRef.current) {
            if (!baseCtxRef.current) {
              baseCtxRef.current = baseCanvasRef.current.getContext('2d', { alpha: false });
            }
            const bctx = baseCtxRef.current;
            if (bctx) {
              bctx.save();
              try {
                bctx.scale(dpr, dpr);
                renderBaseChart({
                  ctx: bctx,
                  width,
                  height,
                  candles: visCandles,
                  viewport: viewportRef.current,
                  market: curMarket,
                  interval: curInterval,
                  theme: themeRef.current,
                  alerts: alertsRef.current,
                  replay: replayRef.current,
                  replayHoverIndex: replayHoverIdxRef.current,
                  liveCandleOverride,
                  priceRangeOverride: effectivePriceRange,
                });
              } finally {
                bctx.restore();
              }
            }
            dirtyBaseRef.current = false;
          }

          if (dirtyDrawingRef.current && drawingCanvasRef.current) {
            if (!drawingCtxRef.current) {
              drawingCtxRef.current = drawingCanvasRef.current.getContext('2d');
            }
            const dctx = drawingCtxRef.current;
            if (dctx) {
              dctx.save();
              try {
                dctx.scale(dpr, dpr);
                renderDrawingsLayer({
                  ctx: dctx,
                  width,
                  height,
                  plot,
                  priceRange: effectivePriceRange,
                  candles: visCandles,
                  viewport: viewportRef.current,
                  market: curMarket,
                  interval: curInterval,
                  theme: themeRef.current,
                  drawings: drawingsRef.current,
                  draftDrawing: draftRef.current,
                  selectedDrawingId: selectedIdRef.current,
                  hoveredDrawingId: hoveredHitRef.current?.drawingId ?? null,
                  hoveredHandleIndex: hoveredHitRef.current?.handleIndex ?? null,
                  crosshair: crosshairRef.current,
                  activeToolId: activeToolRef.current,
                  isFreeCrosshair:
                    freeCrosshairRef.current || dragModeRef.current.kind === 'crosshairDrag',
                  laserTrail: laserTrailRef.current,
                });
              } finally {
                dctx.restore();
              }
            }
            dirtyDrawingRef.current = false;
          }
        }

        if (keepAnimating) {
          scheduleFrameRef.current();
        }
      };

      scheduleFrameRef.current = () => {
        if (rafIdRef.current === null) {
          prevNow = performance.now();
          rafIdRef.current = requestAnimationFrame(tick);
        }
      };

      scheduleFrameRef.current();
      return () => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
      };
    }, [getVisibleCandles, maybeFetchOlder, scheduleViewportCommit, syncCanvasBackingSize]);

    // Live 1-second candle countdown timer tick on right price axis (paused while market is closed)
    useEffect(() => {
      let lastSec = Math.floor(Date.now() / 1000);
      let wasOpen = isMarketOpen(marketRef.current, Date.now());
      const timer = window.setInterval(() => {
        if (document.hidden || replayRef.current.mode !== 'OFF' || candlesRef.current.length === 0) {
          return;
        }
        const nowMs = Date.now();
        const openNow = isMarketOpen(marketRef.current, nowMs);
        if (!openNow) {
          if (wasOpen) {
            wasOpen = false;
            dirtyBaseRef.current = true;
            scheduleFrameRef.current();
          }
          return;
        }
        wasOpen = true;
        const sec = Math.floor(nowMs / 1000);
        if (sec !== lastSec) {
          lastSec = sec;
          dirtyBaseRef.current = true;
          scheduleFrameRef.current();
        }
      }, 250);
      return () => {
        clearInterval(timer);
        if (longPressTimerRef.current !== null) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      };
    }, [candlesRef]);

    const updateCrosshair = useCallback(
      (localX: number, localY: number, forceMagnet = false) => {
        const { width, height } = sizeRef.current;
        const plot = getPlotRect(width, height);
        const clampedX = Math.max(plot.x, Math.min(plot.x + plot.width, localX));
        const clampedY = Math.max(plot.y, Math.min(plot.y + plot.height, localY));
        const vis = getVisibleCandles();
        const range = getActivePriceRange(vis, plot);
        const idx = Math.round(xToIndex(clampedX, viewportRef.current, plot));
        const candle = idx >= 0 && idx < vis.length ? vis[idx] : null;
        const toolId = activeToolRef.current;
        const isPlacingTrendStart = toolId === 'trend_line' && !draftRef.current;
        const hasTrendLineSnap =
          (toolId === 'rectangle' || toolId === 'fib_retracement') &&
          drawingsRef.current.some(
            (d) => d.toolId === 'trend_line' && d.meta?.visible !== false && d.points.length >= 2
          );
        const nearbyFibTrendLine =
          toolId === 'fib_retracement'
            ? findNearbyTrendLine(
                clampedX,
                clampedY,
                drawingsRef.current,
                vis,
                intervalRef.current,
                viewportRef.current,
                range,
                plot,
                42
              )
            : null;
        const snapped =
          !freeCrosshairRef.current &&
          dragModeRef.current.kind !== 'crosshairDrag' &&
          (toolId === 'tool_magic' ||
            forceMagnet ||
            isPlacingTrendStart ||
            (toolId === 'rectangle' && hasTrendLineSnap) ||
            Boolean(nearbyFibTrendLine));
        const anchorPt = draftRef.current?.points?.[0];
        const pointIdx = draftRef.current ? draftRef.current.points.length - 1 : 0;
        const world = nearbyFibTrendLine
          ? { ...nearbyFibTrendLine.points[draftRef.current ? 1 : 0] }
          : screenToWorld(clampedX, clampedY, forceMagnet, toolId, anchorPt, pointIdx);

        crosshairRef.current = {
          visible: true,
          x: snapped ? timeToX(world.time, vis, intervalRef.current, viewportRef.current, plot) : clampedX,
          y: snapped ? priceToY(world.price, range, plot) : clampedY,
          time: world.time,
          price: world.price,
          candle,
        };

        if (replayRef.current.mode === 'SELECTING') {
          replayHoverIdxRef.current = Math.max(1, Math.min(vis.length - 1, idx));
          requestRedraw(true, true);
        } else {
          requestRedraw(false, true);
        }
      },
      [getActivePriceRange, getVisibleCandles, requestRedraw, screenToWorld]
    );

    // Keep 24-hour free crosshair anchored & visible when toggled ON
    useEffect(() => {
      if (isFreeCrosshair) {
        const { width, height } = sizeRef.current;
        const plot = getPlotRect(width, height);
        const initX =
          crosshairRef.current.visible && crosshairRef.current.x >= plot.x && crosshairRef.current.x <= plot.x + plot.width
            ? crosshairRef.current.x
            : plot.x + plot.width * 0.55;
        const initY =
          crosshairRef.current.visible && crosshairRef.current.y >= plot.y && crosshairRef.current.y <= plot.y + plot.height
            ? crosshairRef.current.y
            : plot.y + plot.height * 0.45;
        updateCrosshair(initX, initY, false);
      } else {
        requestRedraw(false, true);
      }
    }, [isFreeCrosshair, requestRedraw, updateCrosshair]);

    // Wheel zoom (desktop mouse wheel & trackpad) with smooth anchor-locked easing
    useEffect(() => {
      const canvas = drawingCanvasRef.current;
      if (!canvas) return;

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = canvasRectRef.current;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const { width, height } = sizeRef.current;
        const plot = getPlotRect(width, height);
        const vis = getVisibleCandles();

        const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        const zoomFactor = Math.exp(-delta * 0.0014);
        const baseVp = zoomTargetRef.current?.active
          ? { ...viewportRef.current, ...zoomTargetRef.current }
          : viewportRef.current;

        // Over right price axis OR holding Shift -> Vertical Zoom
        if (x > plot.width || e.shiftKey) {
          const target = zoomVerticalAt(baseVp, vis, zoomFactor, y, plot);
          zoomTargetRef.current = { active: true, ...target };
          scheduleViewportCommit(false);
          requestRedraw(true, true);
          return;
        }

        // Horizontal zoom anchored precisely to pointer X
        const target = zoomHorizontalAt(baseVp, zoomFactor, x, plot);
        zoomTargetRef.current = { active: true, ...target };
        scheduleViewportCommit(false);
        maybeFetchOlder(target);
        requestRedraw(true, true);
      };

      canvas.addEventListener('wheel', onWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', onWheel);
    }, [getVisibleCandles, maybeFetchOlder, requestRedraw, scheduleViewportCommit]);

    // Two-finger pinch-to-zoom & pan for touch devices (Android & iOS)
    useEffect(() => {
      const canvas = drawingCanvasRef.current;
      if (!canvas) return;

      applyPinchMoveRef.current = (sample) => {
        if (!pinchRef.current.active) return;
        const { x1, y1, x2, y2 } = sample;
        const curDist = Math.max(10, Math.hypot(x2 - x1, y2 - y1));
        const midX = (x1 + x2) / 2;

        const { width, height } = sizeRef.current;
        const plot = getPlotRect(width, height);
        const vis = getVisibleCandles();
        const scale = curDist / pinchRef.current.startDist;

        // Pan midpoint delta + horizontal pinch zoom anchored around midpoint
        let next = panViewport(
          pinchRef.current.startViewport,
          vis,
          midX - pinchRef.current.startMidX,
          0,
          plot,
          false
        );
        next = zoomHorizontalAt(next, scale, midX, plot);

        viewportRef.current = next;
        scheduleViewportCommit(false);
        maybeFetchOlder(next);
        dirtyBaseRef.current = true;
        dirtyDrawingRef.current = true;
      };

      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          const bRect = canvas.getBoundingClientRect();
          canvasRectRef.current = { left: bRect.left, top: bRect.top };
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          const x1 = t1.clientX - bRect.left;
          const y1 = t1.clientY - bRect.top;
          const x2 = t2.clientX - bRect.left;
          const y2 = t2.clientY - bRect.top;

          pendingPointerMoveRef.current = null;
          pendingTouchPinchRef.current = null;
          zoomTargetRef.current = null;
          inertiaVelocityXRef.current = 0;
          inertiaVelocityYRef.current = 0;
          dragModeRef.current = { kind: 'none' };
          pinchRef.current = {
            active: true,
            startDist: Math.max(10, Math.hypot(x2 - x1, y2 - y1)),
            startDistY: Math.max(10, Math.abs(y2 - y1)),
            startMidX: (x1 + x2) / 2,
            startMidY: (y1 + y2) / 2,
            startViewport: { ...viewportRef.current },
          };
        }
      };

      const onTouchMove = (e: TouchEvent) => {
        if (pinchRef.current.active && e.touches.length === 2) {
          e.preventDefault();
          const rect = canvasRectRef.current;
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          pendingTouchPinchRef.current = {
            x1: t1.clientX - rect.left,
            y1: t1.clientY - rect.top,
            x2: t2.clientX - rect.left,
            y2: t2.clientY - rect.top,
          };
          scheduleFrameRef.current();
        }
      };

      const onTouchEnd = (e: TouchEvent) => {
        if (e.touches.length < 2) {
          if (pinchRef.current.active) {
            if (pendingTouchPinchRef.current) {
              const sample = pendingTouchPinchRef.current;
              pendingTouchPinchRef.current = null;
              applyPinchMoveRef.current(sample);
              requestRedraw(true, true);
            }
            scheduleViewportCommit(true);
          }
          pinchRef.current.active = false;
        }
      };

      canvas.addEventListener('touchstart', onTouchStart, { passive: false });
      canvas.addEventListener('touchmove', onTouchMove, { passive: false });
      canvas.addEventListener('touchend', onTouchEnd);
      canvas.addEventListener('touchcancel', onTouchEnd);
      return () => {
        canvas.removeEventListener('touchstart', onTouchStart);
        canvas.removeEventListener('touchmove', onTouchMove);
        canvas.removeEventListener('touchend', onTouchEnd);
        canvas.removeEventListener('touchcancel', onTouchEnd);
      };
    }, [getVisibleCandles, maybeFetchOlder, requestRedraw, scheduleViewportCommit]);

    // Unified Pointer Events (Mouse + Single-Touch)
    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (pinchRef.current.active || e.button === 2) return;
      const canvas = drawingCanvasRef.current;
      if (!canvas) return;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture failure on synthetic or interrupted touch transitions
      }

      const rect = canvas.getBoundingClientRect();
      canvasRectRef.current = { left: rect.left, top: rect.top };
      pendingPointerMoveRef.current = null;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const { width, height } = sizeRef.current;
      const plot = getPlotRect(width, height);
      const vis = getVisibleCandles();
      const priceRange = computePriceRange(vis, viewportRef.current, plot);

      // 1. Bar Replay candle selection mode
      if (replayRef.current.mode === 'SELECTING' && x <= plot.width && y <= plot.height) {
        const idx = Math.max(1, Math.min(vis.length - 1, Math.round(xToIndex(x, viewportRef.current, plot))));
        replayHoverIdxRef.current = null;
        onSelectReplayIndex(idx);
        return;
      }

      // 2. Right-side Price Scale vertical drag
      if (x > plot.width && y <= plot.height) {
        zoomTargetRef.current = null;
        dragModeRef.current = {
          kind: 'priceScale',
          startY: y,
          startViewport: { ...viewportRef.current },
        };
        return;
      }

      if (y > plot.height) return;

      const magnet = e.ctrlKey || e.metaKey;
      updateCrosshair(x, y, magnet);
      const tool = TOOL_BY_ID[activeToolRef.current];
      const worldPt = screenToWorld(x, y, magnet, tool?.id);

      // 3. Demonstration laser pointer
      if (activeToolRef.current === 'tool_demonstration') {
        laserTrailRef.current.push({ x, y, createdAt: performance.now() });
        dragModeRef.current = { kind: 'laser' };
        requestRedraw(false, true);
        return;
      }

      // 4. Eraser tool
      if (activeToolRef.current === 'tool_eraser') {
        const hit = hitTestDrawings(
          x,
          y,
          drawingsRef.current,
          vis,
          intervalRef.current,
          viewportRef.current,
          priceRange,
          plot,
          selectedIdRef.current
        );
        if (hit) {
          hoveredHitRef.current = null;
          onDeleteDrawingById(hit.drawingId);
          syncCanvasCursor(x, y);
        }
        return;
      }

      // 5. Drawing creation mode (non-cursor tool active)
      if (tool && !tool.isCursorTool) {
        hoveredHitRef.current = null;
        const defaultColor = tool.defaultColor || (themeRef.current === 'dark' ? '#FFFFFF' : '#141311');

        // Freehand brush / highlighter
        if (tool.pointCount === -2) {
          const newDrawing: DrawingObject = {
            id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            toolId: tool.id,
            market: marketRef.current,
            points: [worldPt],
            style: {
              color: defaultColor,
              lineWidth: tool.id === 'highlighter' ? 3 : 1,
              lineStyle: 'solid',
              opacity: tool.id === 'highlighter' ? 0.5 : 1,
            },
            meta: { createdAt: Date.now() },
          };
          draftRef.current = newDrawing;
          setHasActiveDraft(true);
          dragModeRef.current = { kind: 'freehand', drawing: newDrawing };
          requestRedraw(false, true);
          return;
        }

        // Single-click placement tools (Horizontal Ray, Horizontal Line, Vertical Line, Annotations, Visuals, etc.)
        if (tool.pointCount === 1) {
          const defaultText =
            tool.category === 'ANNOTATION'
              ? tool.name === 'PRICE NOTE'
                ? ''
                : tool.name
              : undefined;
          const created: DrawingObject = {
            id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            toolId: tool.id,
            market: marketRef.current,
            points: [worldPt],
            style: {
              color: defaultColor,
              lineWidth: 1,
              lineStyle: 'solid',
              opacity: 1,
            },
            text: defaultText,
            visualGlyph: tool.isVisualPicker ? visualGlyphRef.current : undefined,
            meta: { createdAt: Date.now() },
          };
          onAddDrawing(created);
          onCancelActiveTool();
          return;
        }

        // Multi-point tools (2, 3, 4, 5, 6, 7 or -1 variable)
        if (!draftRef.current) {
          let firstPt = worldPt;
          let secondPt = worldPt;
          let extraMeta: NonNullable<DrawingObject['meta']> = { createdAt: Date.now() };

          if (tool.id === 'fib_retracement') {
            fibManualAnchorRef.current = worldPt;
            const fibPreset = loadFibSettingsPreset();
            if (fibPreset) {
              extraMeta = {
                ...extraMeta,
                fibLevels: fibPreset.fibLevels.map((l) => ({ ...l })),
                fibShowPrices: fibPreset.fibShowPrices,
                fibShowBackground: fibPreset.fibShowBackground,
                fibExtendRight: fibPreset.fibExtendRight,
                fibReverse: fibPreset.fibReverse,
              };
            }
            const nearbyTl = findNearbyTrendLine(
              x,
              y,
              drawingsRef.current,
              vis,
              intervalRef.current,
              viewportRef.current,
              priceRange,
              plot,
              42
            );
            if (nearbyTl) {
              firstPt = { ...nearbyTl.points[0] };
              secondPt = { ...nearbyTl.points[1] };
            }
          } else {
            fibManualAnchorRef.current = null;
          }

          if (tool.id === 'rectangle') {
            const nearbyTl = findNearbyTrendLine(
              x,
              y,
              drawingsRef.current,
              vis,
              intervalRef.current,
              viewportRef.current,
              priceRange,
              plot,
              42
            );
            if (nearbyTl) {
              const tlStart = nearbyTl.points[0];
              const tlEnd = nearbyTl.points[1];
              const touch = findTrendLineTouchPoint(
                x,
                y,
                nearbyTl,
                vis,
                intervalRef.current,
                viewportRef.current,
                priceRange,
                plot
              );
              rectAttachedTlRef.current = { tl: nearbyTl, touchPt: touch.point };
              const touchX = timeToX(touch.point.time, vis, intervalRef.current, viewportRef.current, plot);
              const touchY = priceToY(touch.point.price, priceRange, plot);
              const defW = Math.max(72, Math.min(132, plot.width * 0.13));
              const defH = Math.max(36, Math.min(60, plot.height * 0.095));
              const tlMaxPrice = Math.max(tlStart.price, tlEnd.price);
              const tlMinPrice = Math.min(tlStart.price, tlEnd.price);
              const isUpperEndpoint =
                Math.abs(tlMaxPrice - tlMinPrice) > 1e-8 &&
                Math.abs(touch.point.price - tlMaxPrice) <= 1e-6;
              let secondPrice = yToPrice(touchY + (isUpperEndpoint ? defH : -defH), priceRange, plot);
              if (touch.isEnd) {
                const matchedFib = drawingsRef.current.find(
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
                  const reverse = Boolean(matchedFib.meta?.fibReverse);
                  const priceDiff = tlEnd.price - tlStart.price;
                  const price0110 = reverse
                    ? tlStart.price + priceDiff * 0.11
                    : tlEnd.price - priceDiff * 0.11;
                  if (Math.abs(price0110 - tlEnd.price) > 1e-8) {
                    secondPrice = price0110;
                  }
                }
              }
              firstPt = { time: touch.point.time, price: touch.point.price };
              secondPt = {
                time: xToTime(touchX + defW, vis, intervalRef.current, viewportRef.current, plot),
                price: secondPrice,
              };
            } else {
              rectAttachedTlRef.current = null;
            }
          } else {
            rectAttachedTlRef.current = null;
          }

          if (tool.pointCount === 2 && secondPt === worldPt) {
            const sx0 = timeToX(firstPt.time, vis, intervalRef.current, viewportRef.current, plot);
            const sy0 = priceToY(firstPt.price, priceRange, plot);
            const dirX = sx0 > plot.x + plot.width * 0.72 ? -1 : 1;
            const dirY = sy0 > plot.y + plot.height * 0.72 ? -1 : 1;
            const defW =
              tool.id === 'rectangle'
                ? Math.max(72, Math.min(132, plot.width * 0.13))
                : Math.max(88, Math.min(148, plot.width * 0.15));
            const defH =
              tool.id === 'rectangle'
                ? Math.max(36, Math.min(60, plot.height * 0.095))
                : Math.max(42, Math.min(72, plot.height * 0.115));

            if (tool.id === 'long_position' || tool.id === 'short_position') {
              const isLong = tool.id === 'long_position';
              const posDirX = sx0 > plot.x + plot.width * 0.78 ? -1 : 1;
              const posH = Math.max(46, Math.min(78, plot.height * 0.13));
              const posStopH = Math.round(posH * 0.5);
              const targetPrice = yToPrice(sy0 + (isLong ? -posH : posH), priceRange, plot);
              const stopPrice = yToPrice(sy0 + (isLong ? posStopH : -posStopH), priceRange, plot);
              secondPt = {
                time: xToTime(sx0 + posDirX * defW, vis, intervalRef.current, viewportRef.current, plot),
                price: targetPrice,
              };
              extraMeta = {
                ...extraMeta,
                targetPrice,
                stopPrice,
              };
            } else if (
              tool.id === 'trend_line' ||
              tool.id === 'ray' ||
              tool.id === 'extended_line' ||
              tool.id === 'regression_trend' ||
              tool.id === 'cyclic_lines' ||
              tool.id === 'time_cycles' ||
              tool.id === 'fib_time_zone'
            ) {
              secondPt = {
                time: xToTime(sx0 + dirX * defW, vis, intervalRef.current, viewportRef.current, plot),
                price: firstPt.price,
              };
            } else {
              secondPt = {
                time: xToTime(sx0 + dirX * defW, vis, intervalRef.current, viewportRef.current, plot),
                price: yToPrice(sy0 + dirY * defH, priceRange, plot),
              };
            }
          }
          const initial: DrawingObject = {
            id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            toolId: tool.id,
            market: marketRef.current,
            points: [firstPt, secondPt],
            style: {
              color: defaultColor,
              lineWidth: 1,
              lineStyle: 'solid',
              opacity:
                tool.id === 'long_position' || tool.id === 'short_position' ? 0.65 : 1,
            },
            text: tool.id === 'callout' ? 'CALLOUT' : undefined,
            meta: extraMeta,
          };
          draftRef.current = initial;
          setHasActiveDraft(true);
          if (tool.pointCount === 2) {
            dragModeRef.current = { kind: 'dragCreate2pt', startX: x, startY: y, moved: false };
          }
          requestRedraw(false, true);
          return;
        } else {
          // Advance existing multi-point draft (supports Shift angle lock & Ctrl/Cmd magnet snap)
          const current = draftRef.current;
          if (current.toolId === 'fib_retracement') {
            const nearbyTl = findNearbyTrendLine(
              x,
              y,
              drawingsRef.current,
              vis,
              intervalRef.current,
              viewportRef.current,
              priceRange,
              plot,
              42
            );
            let committedPoints: WorldPoint[];
            if (nearbyTl) {
              committedPoints = [{ ...nearbyTl.points[0] }, { ...nearbyTl.points[1] }];
            } else {
              const anchor = fibManualAnchorRef.current ?? current.points[0];
              const resolved = resolveInteractivePoint(
                x,
                y,
                e.shiftKey,
                magnet,
                anchor,
                tool.id,
                1
              );
              const sx0 = timeToX(anchor.time, vis, intervalRef.current, viewportRef.current, plot);
              const sy0 = priceToY(anchor.price, priceRange, plot);
              const sx1 = timeToX(resolved.worldPt.time, vis, intervalRef.current, viewportRef.current, plot);
              const sy1 = priceToY(resolved.worldPt.price, priceRange, plot);
              const nextPt =
                Math.hypot(sx1 - sx0, sy1 - sy0) < 14 ? current.points[1] : resolved.worldPt;
              committedPoints = [anchor, nextPt];
            }
            const finished: DrawingObject = { ...current, points: committedPoints };
            draftRef.current = null;
            setHasActiveDraft(false);
            commitCompletedDrawing(finished);
            onCancelActiveTool();
            requestRedraw(false, true);
            return;
          }

          const nextPtIndex = Math.max(1, current.points.length - 1);
          const anchor = current.points[current.points.length - 2];
          const resolved = resolveInteractivePoint(
            x,
            y,
            e.shiftKey,
            magnet,
            anchor,
            tool.id,
            nextPtIndex
          );
          let nextCorner = resolved.worldPt;
          let updatedMeta = current.meta;
          if (tool.pointCount === 2) {
            const sx0 = timeToX(anchor.time, vis, intervalRef.current, viewportRef.current, plot);
            const sy0 = priceToY(anchor.price, priceRange, plot);
            const sx1 = timeToX(nextCorner.time, vis, intervalRef.current, viewportRef.current, plot);
            const sy1 = priceToY(nextCorner.price, priceRange, plot);
            if (tool.id === 'rectangle') {
              if (Math.abs(sx1 - sx0) < 10 || Math.abs(sy1 - sy0) < 10) {
                nextCorner = current.points[1];
              }
            } else if (tool.id === 'long_position' || tool.id === 'short_position') {
              const isLong = tool.id === 'long_position';
              const spanPx =
                Math.abs(sy1 - sy0) > 14
                  ? Math.max(24, Math.abs(sy1 - sy0))
                  : Math.max(46, Math.min(78, plot.height * 0.13));
              const targetPrice = yToPrice(sy0 + (isLong ? -spanPx : spanPx), priceRange, plot);
              const stopPrice = yToPrice(sy0 + (isLong ? spanPx * 0.5 : -spanPx * 0.5), priceRange, plot);
              if (Math.hypot(sx1 - sx0, sy1 - sy0) < 14) {
                nextCorner = current.points[1];
              } else {
                nextCorner = { time: nextCorner.time, price: targetPrice };
              }
              updatedMeta = {
                ...updatedMeta,
                targetPrice,
                stopPrice,
              };
            } else if (Math.hypot(sx1 - sx0, sy1 - sy0) < 14) {
              nextCorner = current.points[1];
            }
          }
          const committedPoints = [...current.points.slice(0, -1), nextCorner];
          if (tool.pointCount > 0 && committedPoints.length >= tool.pointCount) {
            let finished: DrawingObject = { ...current, points: committedPoints, meta: updatedMeta };
            if (finished.toolId === 'rectangle') {
              const attached = rectAttachedTlRef.current;
              const fallbackTl =
                attached?.tl ??
                findNearbyTrendLine(
                  x,
                  y,
                  drawingsRef.current,
                  vis,
                  intervalRef.current,
                  viewportRef.current,
                  priceRange,
                  plot,
                  42
                );
              if (fallbackTl) {
                finished = constrainRectangleToTrendLine(
                  finished,
                  fallbackTl,
                  vis,
                  intervalRef.current,
                  viewportRef.current,
                  priceRange,
                  plot,
                  36,
                  attached?.touchPt
                );
              }
            }
            draftRef.current = null;
            setHasActiveDraft(false);
            commitCompletedDrawing(finished);
            onCancelActiveTool();
            requestRedraw(false, true);
          } else {
            draftRef.current = { ...current, points: [...committedPoints, nextCorner] };
            requestRedraw(false, true);
          }
          return;
        }
      }

      // 6. Cursor mode: Hit-test drawings (handle resize or body move)
      const hit = hitTestDrawings(
        x,
        y,
        drawingsRef.current,
        vis,
        intervalRef.current,
        viewportRef.current,
        priceRange,
        plot,
        selectedIdRef.current
      );

      if (hit) {
        hoveredHitRef.current = hit;
        onSelectDrawing(hit.drawingId);
        const found = drawingsRef.current.find((d) => d.id === hit.drawingId);
        if (found) {
          const snapshot = drawingsRef.current.map((d) => ({
            ...d,
            points: d.points.map((p) => ({ ...p })),
            style: { ...d.style },
            meta: d.meta ? { ...d.meta } : undefined,
          }));
          if (hit.handleIndex >= 0) {
            dragModeRef.current = {
              kind: 'resizeHandle',
              drawingId: hit.drawingId,
              handleIndex: hit.handleIndex,
              beforeSnapshot: snapshot,
              originDrawing: found,
            };
          } else {
            dragModeRef.current = {
              kind: 'moveDrawing',
              drawingId: hit.drawingId,
              beforeSnapshot: snapshot,
              originDrawing: found,
              startTime: worldPt.time,
              startPrice: worldPt.price,
            };
          }
          syncCanvasCursor(x, y);
          return;
        }
      }

      // 7. In Free Crosshair mode, dragging anywhere glides the 24-hour crosshair freely
      if (freeCrosshairRef.current) {
        dragModeRef.current = { kind: 'crosshairDrag', temporary: false };
        updateCrosshair(x, y, false);
        syncCanvasCursor(x, y);
        return;
      }

      // 8. Otherwise deselect and pan chart smoothly (zero-jump horizontal & vertical drag; touch long-press opens 24h free crosshair)
      hoveredHitRef.current = null;
      if (selectedIdRef.current) {
        onSelectDrawing(null);
      }
      zoomTargetRef.current = null;
      inertiaVelocityXRef.current = 0;
      inertiaVelocityYRef.current = 0;
      lastPanSampleRef.current = { x, y, t: performance.now() };
      const initUnlocked = !viewportRef.current.autoScaleY;
      dragModeRef.current = {
        kind: 'pan',
        startX: x,
        startY: y,
        startViewport: { ...viewportRef.current },
        verticalUnlocked: initUnlocked,
        verticalOriginY: y,
        lockedRange: initUnlocked ? computePriceRange(vis, viewportRef.current, plot) : null,
      };
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
      }
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        if (dragModeRef.current.kind === 'pan') {
          dragModeRef.current = { kind: 'crosshairDrag', temporary: true };
          updateCrosshair(x, y, false);
          syncCanvasCursor(x, y);
        }
      }, 240);
      syncCanvasCursor(x, y);
    };

    const processPointerMove = (sample: {
      x: number;
      y: number;
      shiftKey: boolean;
      magnet: boolean;
    }) => {
      if (pinchRef.current.active) return;
      const { x, y, shiftKey, magnet } = sample;
      const { width, height } = sizeRef.current;
      const plot = getPlotRect(width, height);
      const vis = getVisibleCandles();

      const mode = dragModeRef.current;

      if (mode.kind === 'crosshairDrag') {
        updateCrosshair(x, y, magnet);
        return;
      }

      updateCrosshair(x, y, magnet);

      if (mode.kind === 'laser') {
        laserTrailRef.current.push({ x, y, createdAt: performance.now() });
        requestRedraw(false, true);
        return;
      }

      if (mode.kind === 'priceScale') {
        const dy = y - mode.startY;
        const factor = Math.exp(-dy * 0.005);
        const next = zoomVerticalAt(
          mode.startViewport,
          vis,
          factor,
          plot.y + plot.height / 2,
          plot
        );
        viewportRef.current = next;
        scheduleViewportCommit(false);
        requestRedraw(true, true);
        return;
      }

      if (mode.kind === 'pan') {
        if (
          longPressTimerRef.current !== null &&
          Math.hypot(x - mode.startX, y - mode.startY) > 6
        ) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        const now = performance.now();
        if (lastPanSampleRef.current) {
          const dt = now - lastPanSampleRef.current.t;
          if (dt > 0 && dt < 90) {
            const instVx = (x - lastPanSampleRef.current.x) / dt;
            const instVy = (y - lastPanSampleRef.current.y) / dt;
            inertiaVelocityXRef.current = inertiaVelocityXRef.current * 0.45 + instVx * 0.55;
            inertiaVelocityYRef.current = inertiaVelocityYRef.current * 0.45 + instVy * 0.55;
          }
        }
        lastPanSampleRef.current = { x, y, t: now };

        const dx = x - mode.startX;
        const next = panViewport(mode.startViewport, vis, dx, 0, plot, false);

        if (!mode.verticalUnlocked && Math.abs(y - mode.startY) > 4) {
          mode.verticalUnlocked = true;
          mode.verticalOriginY = y;
          const vr = visualRangeRef.current;
          mode.lockedRange =
            vr && vr.market === marketRef.current && vr.interval === intervalRef.current
              ? { min: vr.min, max: vr.max }
              : computePriceRange(vis, next, plot);
        }

        if (mode.verticalUnlocked && mode.lockedRange && plot.height > 0) {
          const effDy = y - mode.verticalOriginY;
          const span = mode.lockedRange.max - mode.lockedRange.min;
          const priceDelta = (effDy / plot.height) * span;
          next.autoScaleY = false;
          next.priceMin = mode.lockedRange.min + priceDelta;
          next.priceMax = mode.lockedRange.max + priceDelta;
        }

        viewportRef.current = next;
        scheduleViewportCommit(false);
        maybeFetchOlder(next);
        requestRedraw(true, true);
        return;
      }

      if (mode.kind === 'freehand' && draftRef.current) {
        const pt = screenToWorld(x, y, false);
        const pts = draftRef.current.points;
        const last = pts[pts.length - 1];
        if (!last || Math.abs(last.time - pt.time) > 0 || Math.abs(last.price - pt.price) > 0) {
          draftRef.current = {
            ...draftRef.current,
            points: [...pts, pt],
          };
          requestRedraw(false, true);
        }
        return;
      }

      if (mode.kind === 'dragCreate2pt' && draftRef.current) {
        if (Math.hypot(x - mode.startX, y - mode.startY) > 6) {
          mode.moved = true;
        }
        if (!mode.moved) {
          return;
        }
        if (draftRef.current.toolId === 'fib_retracement') {
          const range = getActivePriceRange(vis, plot);
          const nearbyTl = findNearbyTrendLine(
            x,
            y,
            drawingsRef.current,
            vis,
            intervalRef.current,
            viewportRef.current,
            range,
            plot,
            42
          );
          if (nearbyTl) {
            const tlEnd = nearbyTl.points[1];
            crosshairRef.current.x = timeToX(tlEnd.time, vis, intervalRef.current, viewportRef.current, plot);
            crosshairRef.current.y = priceToY(tlEnd.price, range, plot);
            crosshairRef.current.time = tlEnd.time;
            crosshairRef.current.price = tlEnd.price;
            draftRef.current = {
              ...draftRef.current,
              points: [{ ...nearbyTl.points[0] }, { ...nearbyTl.points[1] }],
            };
            requestRedraw(false, true);
            return;
          }
        }
        const anchorPt =
          draftRef.current.toolId === 'fib_retracement' && fibManualAnchorRef.current
            ? fibManualAnchorRef.current
            : draftRef.current.points[0];
        const resolved = resolveInteractivePoint(
          x,
          y,
          shiftKey,
          magnet,
          anchorPt,
          draftRef.current.toolId,
          1
        );
        let nextDraft: DrawingObject = {
          ...draftRef.current,
          points: [anchorPt, resolved.worldPt],
        };
        if (nextDraft.toolId === 'long_position' || nextDraft.toolId === 'short_position') {
          const range = getActivePriceRange(vis, plot);
          const isLong = nextDraft.toolId === 'long_position';
          const anchorY = priceToY(anchorPt.price, range, plot);
          const dragDy = y - anchorY;
          const spanPx =
            Math.abs(dragDy) > 14
              ? Math.max(24, Math.abs(dragDy))
              : Math.max(46, Math.min(78, plot.height * 0.13));
          const targetPrice = yToPrice(anchorY + (isLong ? -spanPx : spanPx), range, plot);
          const stopPrice = yToPrice(anchorY + (isLong ? spanPx * 0.5 : -spanPx * 0.5), range, plot);
          nextDraft = {
            ...nextDraft,
            points: [anchorPt, { time: resolved.worldPt.time, price: targetPrice }],
            meta: {
              ...nextDraft.meta,
              targetPrice,
              stopPrice,
            },
          };
        } else if (nextDraft.toolId === 'rectangle') {
          const range = getActivePriceRange(vis, plot);
          const attached = rectAttachedTlRef.current;
          const fallbackTl =
            attached?.tl ??
            findNearbyTrendLine(
              x,
              y,
              drawingsRef.current,
              vis,
              intervalRef.current,
              viewportRef.current,
              range,
              plot,
              42
            );
          if (fallbackTl) {
            nextDraft = constrainRectangleToTrendLine(
              nextDraft,
              fallbackTl,
              vis,
              intervalRef.current,
              viewportRef.current,
              range,
              plot,
              36,
              attached?.touchPt
            );
          }
        }
        const finalPt = nextDraft.points[nextDraft.points.length - 1];
        const range = getActivePriceRange(vis, plot);
        crosshairRef.current.x = timeToX(finalPt.time, vis, intervalRef.current, viewportRef.current, plot);
        crosshairRef.current.y = priceToY(finalPt.price, range, plot);
        crosshairRef.current.time = finalPt.time;
        crosshairRef.current.price = finalPt.price;
        draftRef.current = nextDraft;
        requestRedraw(false, true);
        return;
      }

      if (mode.kind === 'moveDrawing') {
        const curWorld = screenToWorld(x, y, magnet, 'tool_cross');
        const deltaTime = curWorld.time - mode.startTime;
        const deltaPrice = curWorld.price - mode.startPrice;
        let moved = moveDrawingByDelta(mode.originDrawing, deltaTime, deltaPrice);
        if (moved.toolId === 'trend_line' && moved.points.length >= 2) {
          const range = getActivePriceRange(vis, plot);
          const origP0 = mode.originDrawing.points[0];
          const origP1 = mode.originDrawing.points[1];
          const snappedP0 = snapPointToCandleBody(
            moved.points[0].time,
            moved.points[0].price,
            vis,
            intervalRef.current,
            range,
            plot,
            viewportRef.current.barSpacing,
            12
          );
          if (
            snappedP0.time !== moved.points[0].time ||
            snappedP0.price !== moved.points[0].price
          ) {
            const actualDt = snappedP0.time - origP0.time;
            const actualDp = snappedP0.price - origP0.price;
            moved = {
              ...moved,
              points: [
                snappedP0,
                { time: origP1.time + actualDt, price: origP1.price + actualDp },
              ],
            };
          }
        } else if (moved.toolId === 'rectangle' && moved.points.length >= 2) {
          const range = getActivePriceRange(vis, plot);
          moved = snapMovedRectangleToTrendLines(
            moved,
            mode.beforeSnapshot,
            vis,
            intervalRef.current,
            viewportRef.current,
            range,
            plot,
            40
          );
        } else if (moved.toolId === 'fib_retracement' && moved.points.length >= 2) {
          const range = getActivePriceRange(vis, plot);
          const { drawing: snappedFib, matchedTrendLine } = snapMovedFibToTrendLines(
            moved,
            mode.beforeSnapshot,
            vis,
            intervalRef.current,
            viewportRef.current,
            range,
            plot,
            42,
            { x, y }
          );
          moved = snappedFib;
          let nextList = mode.beforeSnapshot.map((d) =>
            d.id === mode.drawingId ? moved : d
          );
          if (matchedTrendLine) {
            nextList = applyFibSnapToAttachedRectangles(
              nextList,
              moved,
              matchedTrendLine,
              vis,
              intervalRef.current,
              viewportRef.current,
              range,
              plot
            );
          }
          drawingsRef.current = nextList;
          requestRedraw(false, true);
          return;
        }
        drawingsRef.current = drawingsRef.current.map((d) =>
          d.id === mode.drawingId ? moved : d
        );
        requestRedraw(false, true);
        return;
      }

      if (mode.kind === 'resizeHandle') {
        const origPts = mode.originDrawing.points;
        let anchorPt: WorldPoint | undefined;
        if (mode.originDrawing.toolId === 'rectangle' && origPts.length >= 2) {
          if (mode.handleIndex === 0) anchorPt = origPts[1];
          else if (mode.handleIndex === 1) anchorPt = origPts[0];
          else if (mode.handleIndex === 2) anchorPt = { time: origPts[0].time, price: origPts[1].price };
          else if (mode.handleIndex === 3) anchorPt = { time: origPts[1].time, price: origPts[0].price };
          else anchorPt = undefined;
        } else {
          anchorPt =
            mode.handleIndex === 1
              ? origPts[0]
              : mode.handleIndex === 0 && origPts.length >= 2
                ? origPts[1]
                : undefined;
        }
        const resolved = resolveInteractivePoint(
          x,
          y,
          shiftKey,
          magnet,
          anchorPt,
          mode.originDrawing.toolId,
          mode.handleIndex
        );
        crosshairRef.current.x = resolved.screenX;
        crosshairRef.current.y = resolved.screenY;
        crosshairRef.current.time = resolved.worldPt.time;
        crosshairRef.current.price = resolved.worldPt.price;
        let resized = resizeDrawingHandle(
          mode.originDrawing,
          mode.handleIndex,
          resolved.worldPt
        );
        if (resized.toolId === 'rectangle') {
          const range = getActivePriceRange(vis, plot);
          const attachedTl = findAttachedTrendLineForRectangle(
            mode.originDrawing,
            mode.beforeSnapshot,
            vis,
            intervalRef.current,
            viewportRef.current,
            range,
            plot,
            34
          );
          if (attachedTl) {
            const origP0 = mode.originDrawing.points[0];
            const origP1 = mode.originDrawing.points[1];
            const origX = timeToX(
              Math.min(origP0.time, origP1.time),
              vis,
              intervalRef.current,
              viewportRef.current,
              plot
            );
            const origBottomY = priceToY(Math.min(origP0.price, origP1.price), range, plot);
            const origTopY = priceToY(Math.max(origP0.price, origP1.price), range, plot);
            const bottomTouch = findTrendLineTouchPoint(
              origX,
              origBottomY,
              attachedTl,
              vis,
              intervalRef.current,
              viewportRef.current,
              range,
              plot
            );
            const topTouch = findTrendLineTouchPoint(
              origX,
              origTopY,
              attachedTl,
              vis,
              intervalRef.current,
              viewportRef.current,
              range,
              plot
            );
            const topTouchScreenY = priceToY(topTouch.point.price, range, plot);
            const bottomTouchScreenY = priceToY(bottomTouch.point.price, range, plot);
            const origTouch =
              Math.abs(origTopY - topTouchScreenY) < Math.abs(origBottomY - bottomTouchScreenY)
                ? topTouch
                : bottomTouch;
            resized = constrainRectangleToTrendLine(
              resized,
              attachedTl,
              vis,
              intervalRef.current,
              viewportRef.current,
              range,
              plot,
              36,
              origTouch.point
            );
          }
        }
        drawingsRef.current = drawingsRef.current.map((d) =>
          d.id === mode.drawingId ? resized : d
        );
        requestRedraw(false, true);
        return;
      }

      // Live rubber-band preview for multi-click drawings (with Shift angle lock & magnet snap)
      if (draftRef.current) {
        const pts = draftRef.current.points;
        if (draftRef.current.toolId === 'fib_retracement') {
          const range = getActivePriceRange(vis, plot);
          const nearbyTl = findNearbyTrendLine(
            x,
            y,
            drawingsRef.current,
            vis,
            intervalRef.current,
            viewportRef.current,
            range,
            plot,
            42
          );
          if (nearbyTl) {
            const tlEnd = nearbyTl.points[1];
            crosshairRef.current.x = timeToX(tlEnd.time, vis, intervalRef.current, viewportRef.current, plot);
            crosshairRef.current.y = priceToY(tlEnd.price, range, plot);
            crosshairRef.current.time = tlEnd.time;
            crosshairRef.current.price = tlEnd.price;
            draftRef.current = {
              ...draftRef.current,
              points: [{ ...nearbyTl.points[0] }, { ...nearbyTl.points[1] }],
            };
            requestRedraw(false, true);
            return;
          }
        }
        const anchor =
          draftRef.current.toolId === 'fib_retracement' && fibManualAnchorRef.current
            ? fibManualAnchorRef.current
            : pts.length >= 2
              ? pts[pts.length - 2]
              : pts[0];
        if (TOOL_BY_ID[draftRef.current.toolId]?.pointCount === 2) {
          const range = getActivePriceRange(vis, plot);
          const sx0 = timeToX(anchor.time, vis, intervalRef.current, viewportRef.current, plot);
          const sy0 = priceToY(anchor.price, range, plot);
          if (Math.hypot(x - sx0, y - sy0) < 14) {
            return;
          }
        }
        const ptIdx = Math.max(1, pts.length - 1);
        const resolved = resolveInteractivePoint(
          x,
          y,
          shiftKey,
          magnet,
          anchor,
          draftRef.current.toolId,
          ptIdx
        );
        let nextDraft: DrawingObject = {
          ...draftRef.current,
          points:
            draftRef.current.toolId === 'fib_retracement'
              ? [anchor, resolved.worldPt]
              : [...pts.slice(0, -1), resolved.worldPt],
        };
        if (nextDraft.toolId === 'long_position' || nextDraft.toolId === 'short_position') {
          const range = getActivePriceRange(vis, plot);
          const isLong = nextDraft.toolId === 'long_position';
          const anchorY = priceToY(anchor.price, range, plot);
          const dragDy = y - anchorY;
          const spanPx =
            Math.abs(dragDy) > 14
              ? Math.max(24, Math.abs(dragDy))
              : Math.max(46, Math.min(78, plot.height * 0.13));
          const targetPrice = yToPrice(anchorY + (isLong ? -spanPx : spanPx), range, plot);
          const stopPrice = yToPrice(anchorY + (isLong ? spanPx * 0.5 : -spanPx * 0.5), range, plot);
          nextDraft = {
            ...nextDraft,
            points: [anchor, { time: resolved.worldPt.time, price: targetPrice }],
            meta: {
              ...nextDraft.meta,
              targetPrice,
              stopPrice,
            },
          };
        } else if (nextDraft.toolId === 'rectangle') {
          const range = getActivePriceRange(vis, plot);
          const attached = rectAttachedTlRef.current;
          const fallbackTl =
            attached?.tl ??
            findNearbyTrendLine(
              x,
              y,
              drawingsRef.current,
              vis,
              intervalRef.current,
              viewportRef.current,
              range,
              plot,
              42
            );
          if (fallbackTl) {
            nextDraft = constrainRectangleToTrendLine(
              nextDraft,
              fallbackTl,
              vis,
              intervalRef.current,
              viewportRef.current,
              range,
              plot,
              36,
              attached?.touchPt
            );
          }
        }
        const finalPt = nextDraft.points[nextDraft.points.length - 1];
        const range = getActivePriceRange(vis, plot);
        crosshairRef.current.x = timeToX(finalPt.time, vis, intervalRef.current, viewportRef.current, plot);
        crosshairRef.current.y = priceToY(finalPt.price, range, plot);
        crosshairRef.current.time = finalPt.time;
        crosshairRef.current.price = finalPt.price;
        draftRef.current = nextDraft;
        requestRedraw(false, true);
        return;
      }

      // Idle hover hit-test for anchor preview & TradingView cursor feedback (zero React re-renders)
      const tool = TOOL_BY_ID[activeToolRef.current];
      const canHoverDrawings =
        x <= plot.width &&
        y <= plot.height &&
        replayRef.current.mode !== 'SELECTING' &&
        (!tool || tool.isCursorTool || activeToolRef.current === 'tool_eraser');

      if (canHoverDrawings) {
        const priceRange = computePriceRange(vis, viewportRef.current, plot);
        const hit = hitTestDrawings(
          x,
          y,
          drawingsRef.current,
          vis,
          intervalRef.current,
          viewportRef.current,
          priceRange,
          plot,
          selectedIdRef.current
        );
        const prev = hoveredHitRef.current;
        if (prev?.drawingId !== hit?.drawingId || prev?.handleIndex !== hit?.handleIndex) {
          hoveredHitRef.current = hit;
          requestRedraw(false, true);
        }
      } else if (hoveredHitRef.current !== null) {
        hoveredHitRef.current = null;
        requestRedraw(false, true);
      }

      syncCanvasCursor(x, y);
    };
    applyPointerMoveRef.current = processPointerMove;

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (pinchRef.current.active) return;
      const rect = canvasRectRef.current;
      pendingPointerMoveRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        shiftKey: e.shiftKey,
        magnet: e.ctrlKey || e.metaKey,
      };
      scheduleFrameRef.current();
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (pendingPointerMoveRef.current) {
        const lastSample = pendingPointerMoveRef.current;
        pendingPointerMoveRef.current = null;
        processPointerMove(lastSample);
      }
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      const canvas = drawingCanvasRef.current;
      try {
        if (canvas && canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore if pointer capture already released
      }

      const mode = dragModeRef.current;
      dragModeRef.current = { kind: 'none' };

      if (mode.kind === 'crosshairDrag') {
        if (mode.temporary) {
          crosshairRef.current.visible = false;
        }
        requestRedraw(false, true);
        syncCanvasCursor();
        return;
      }

      if (mode.kind === 'freehand' && draftRef.current) {
        const finished = draftRef.current;
        draftRef.current = null;
        setHasActiveDraft(false);
        if (finished.points.length >= 2) {
          onAddDrawing(finished);
        }
        onCancelActiveTool();
        requestRedraw(false, true);
        syncCanvasCursor();
        return;
      }

      if (mode.kind === 'dragCreate2pt' && mode.moved && draftRef.current) {
        const finished = draftRef.current;
        draftRef.current = null;
        setHasActiveDraft(false);
        commitCompletedDrawing(finished);
        onCancelActiveTool();
        requestRedraw(false, true);
        syncCanvasCursor();
        return;
      }

      if (mode.kind === 'pan') {
        if (!mode.verticalUnlocked) {
          inertiaVelocityYRef.current = 0;
        }
        const lastSample = lastPanSampleRef.current;
        const stale = !lastSample || performance.now() - lastSample.t > 75;
        const noMomentum =
          Math.abs(inertiaVelocityXRef.current) < 0.15 &&
          Math.abs(inertiaVelocityYRef.current) < 0.15;
        if (stale || noMomentum) {
          inertiaVelocityXRef.current = 0;
          inertiaVelocityYRef.current = 0;
          scheduleViewportCommit(true);
        } else {
          scheduleFrameRef.current();
        }
        lastPanSampleRef.current = null;
        syncCanvasCursor();
        return;
      }

      if (mode.kind === 'priceScale') {
        scheduleViewportCommit(true);
        syncCanvasCursor();
        return;
      }

      if (mode.kind === 'moveDrawing' || mode.kind === 'resizeHandle') {
        onCommitDrawingDrag(mode.beforeSnapshot, drawingsRef.current);
        syncCanvasCursor();
      }
    };

    const handlePointerLeave = () => {
      pendingPointerMoveRef.current = null;
      if (!freeCrosshairRef.current) {
        crosshairRef.current.visible = false;
        crosshairRef.current.candle = null;
      }
      if (hoveredHitRef.current !== null) {
        hoveredHitRef.current = null;
      }
      requestRedraw(false, true);
    };

    const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRectRef.current;
      const x = e.clientX - rect.left;
      const { width, height } = sizeRef.current;
      const plot = getPlotRect(width, height);

      if (draftRef.current && TOOL_BY_ID[draftRef.current.toolId]?.pointCount === -1) {
        finishMultiPointDraft();
        return;
      }

      // Double-click right price scale -> restore Auto-Scale Y
      if (x > plot.width) {
        const next: ViewportState = { ...viewportRef.current, autoScaleY: true };
        viewportRef.current = next;
        onViewportChange(next);
        requestRedraw(true, true);
      }
    };

    const visCandles = getVisibleCandles();
    const activeToolDef = TOOL_BY_ID[activeToolId];
    const isDrawingToolActive = Boolean(activeToolDef && !activeToolDef.isCursorTool);
    const isMultiVariableTool = activeToolDef?.pointCount === -1;

    const cursorClass =
      replay.mode === 'SELECTING'
        ? 'cursor-col-resize'
        : isFreeCrosshair
          ? 'cursor-crosshair'
          : activeToolId === 'tool_eraser'
            ? 'cursor-not-allowed'
            : activeToolId === 'tool_arrow'
              ? 'cursor-default'
              : 'cursor-crosshair';

    return (
      <div
        ref={containerRef}
        className="lv-chart-stage relative flex-1 w-full h-full overflow-hidden select-none touch-none"
      >
        {/* Layer 1: Base Chart Canvas (Grid, Candlesticks, Axes, Countdown Timer, Alert & Price Lines) */}
        <canvas
          ref={baseCanvasRef}
          className="absolute inset-0 block pointer-events-none"
        />

        {/* Layer 2: Interactive Drawing & Crosshair Canvas */}
        <canvas
          ref={drawingCanvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onDoubleClick={handleDoubleClick}
          data-testid="chart-interactive-canvas"
          className={`absolute inset-0 block touch-none ${cursorClass}`}
        />

        {/* Active Drawing Tool Banner (with Cancel / Done actions) */}
        {(isDrawingToolActive || hasActiveDraft || activeToolId === 'tool_eraser' || activeToolId === 'tool_demonstration') && (
          <div className="absolute top-2.5 left-2.5 z-20 flex items-center gap-2 rounded-md border border-[#141311]/35 dark:border-[#FFFFFF]/45 bg-[#FFFFFF]/96 dark:bg-[#101013]/96 px-2.5 py-1.5 text-[11px] shadow-lg">
            <span className="font-bold tracking-wider text-[#141311] dark:text-[#FFFFFF]">
              {activeToolDef?.name}
            </span>
            {hasActiveDraft && isMultiVariableTool && (
              <button
                type="button"
                onClick={finishMultiPointDraft}
                className="flex items-center gap-1 rounded bg-[#141311] dark:bg-[#FFFFFF] px-2 py-0.5 text-[10px] font-bold text-[#FFFFFF] dark:text-[#080808] cursor-pointer"
              >
                <Check className="w-3 h-3" />
                DONE
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                cancelDraft();
                onCancelActiveTool();
              }}
              className="flex items-center gap-1 rounded border border-[#141311]/30 dark:border-[#FFFFFF]/35 px-1.5 py-0.5 text-[10px] font-bold text-[#625D52] dark:text-[#DCD9D0] hover:text-[#141311] dark:hover:text-[#FFFFFF] cursor-pointer"
            >
              <X className="w-3 h-3" />
              CANCEL
            </button>
          </div>
        )}

        {/* Convenient On-Chart Zoom & Reset Controls */}
        <div
          className="absolute bottom-9 z-20 flex items-center gap-1 rounded-md border border-[#141311]/25 dark:border-[#FFFFFF]/25 bg-[#FFFFFF]/94 dark:bg-[#0E0E11]/94 p-1 shadow-lg"
          style={{ right: `${PRICE_AXIS_WIDTH + 10}px` }}
        >
          <button
            type="button"
            onClick={() => {
              const { width, height } = sizeRef.current;
              const plot = getPlotRect(width, height);
              const baseVp = zoomTargetRef.current?.active
                ? { ...viewportRef.current, ...zoomTargetRef.current }
                : viewportRef.current;
              const target = zoomHorizontalAt(baseVp, 0.8, plot.x + plot.width * 0.72, plot);
              zoomTargetRef.current = { active: true, ...target };
              scheduleViewportCommit(false);
              maybeFetchOlder(target);
              requestRedraw(true, true);
            }}
            aria-label="Zoom Out"
            title="ZOOM OUT"
            data-testid="zoom-out-btn"
            className="flex h-7 w-7 items-center justify-center rounded text-[#141311] dark:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/15 cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              const { width, height } = sizeRef.current;
              const plot = getPlotRect(width, height);
              const baseVp = zoomTargetRef.current?.active
                ? { ...viewportRef.current, ...zoomTargetRef.current }
                : viewportRef.current;
              const target = zoomHorizontalAt(baseVp, 1.25, plot.x + plot.width * 0.72, plot);
              zoomTargetRef.current = { active: true, ...target };
              scheduleViewportCommit(false);
              requestRedraw(true, true);
            }}
            aria-label="Zoom In"
            title="ZOOM IN"
            data-testid="zoom-in-btn"
            className="flex h-7 w-7 items-center justify-center rounded text-[#141311] dark:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/15 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              const vis = getVisibleCandles();
              const target: ViewportState = {
                ...viewportRef.current,
                rightOffset: Math.max(vis.length + 8, 20),
                barSpacing: 10,
                autoScaleY: true,
              };
              zoomTargetRef.current = { active: true, ...target };
              scheduleViewportCommit(false);
              requestRedraw(true, true);
            }}
            aria-label="Reset Chart View"
            title="RESET SCALE"
            data-testid="reset-scale-btn"
            className="flex h-7 w-7 items-center justify-center rounded text-[#141311] dark:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/15 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Full Screen Top-Right Controls: Download + Exit (×) */}
        {isFullScreen && (
          <div className="fixed top-3 right-3 z-40 flex items-center gap-1.5">
            <button
              type="button"
              onClick={onDownloadImage}
              aria-label="Download Chart Image"
              title="DOWNLOAD CHART IMAGE"
              data-testid="download-image-btn"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[#141311]/35 dark:border-[#FFFFFF]/45 bg-[#FFFFFF]/90 dark:bg-[#0D0D10]/90 text-[#141311] dark:text-[#FFFFFF] shadow-xl backdrop-blur-sm hover:bg-[#141311] hover:text-[#FFFFFF] dark:hover:bg-[#FFFFFF] dark:hover:text-[#080808] transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onExitFullScreen}
              aria-label="Exit Full Screen"
              title="EXIT FULL SCREEN"
              data-testid="exit-fullscreen-btn"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[#141311]/35 dark:border-[#FFFFFF]/45 bg-[#FFFFFF]/90 dark:bg-[#0D0D10]/90 text-[#141311] dark:text-[#FFFFFF] shadow-xl backdrop-blur-sm hover:bg-[#141311] hover:text-[#FFFFFF] dark:hover:bg-[#FFFFFF] dark:hover:text-[#080808] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Loading Overlay */}
        {isLoading && visCandles.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#FAF8F3]/75 dark:bg-[#080808]/75 backdrop-blur-[1px]">
            <div className="h-8 w-8 rounded-full border-2 border-[#141311]/25 dark:border-[#FFFFFF]/25 border-t-[#141311] dark:border-t-[#FFFFFF] animate-spin" />
            <p className="mt-3 text-xs font-bold tracking-[0.18em] text-[#141311] dark:text-[#FFFFFF]">
              LOADING {market} MARKET DATA
            </p>
          </div>
        )}

        {/* Real Error State (never fakes candles) */}
        {errorMessage && visCandles.length === 0 && !isLoading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#FAF8F3]/90 dark:bg-[#080808]/90 p-6 text-center">
            <p className="text-xs font-bold tracking-[0.16em] text-[#D63946] dark:text-[#E54855]">
              MARKET DATA FEED UNAVAILABLE
            </p>
            <p className="mt-2 max-w-md text-xs text-[#625D52] dark:text-[#9A9892]">
              {errorMessage}
            </p>
            {onRetryLoad && (
              <button
                type="button"
                onClick={onRetryLoad}
                className="mt-4 px-4 py-2 rounded-md border border-[#141311] dark:border-[#FFFFFF] bg-[#141311]/10 dark:bg-[#FFFFFF]/15 text-xs font-bold tracking-[0.12em] text-[#141311] dark:text-[#FFFFFF] hover:bg-[#141311] hover:text-[#FFFFFF] dark:hover:bg-[#FFFFFF] dark:hover:text-[#080808] transition-colors cursor-pointer"
              >
                RETRY CONNECTION
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
  )
);

ChartCanvas.displayName = 'ChartCanvas';
