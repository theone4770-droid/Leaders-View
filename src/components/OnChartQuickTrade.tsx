import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GripVertical, Minus, Plus } from 'lucide-react';
import { MarketSymbol } from '../types/chart';
import { MarketBidAskQuote, TradeDirection } from '../types/trading';
import { formatPrice, MARKETS } from '../modules/timeframeManager';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

interface OnChartQuickTradeProps {
  visible: boolean;
  market: MarketSymbol;
  quote: MarketBidAskQuote | null;
  lotSize: number;
  maxAffordableLot: number;
  isPoorBalance: boolean;
  onChangeLotSize: (nextLot: number) => void;
  onExecuteQuickOrder: (params: {
    symbol: MarketSymbol;
    direction: TradeDirection;
    lotSize: number;
    sl: number | null;
    tp: number | null;
  }) => { ok: boolean; error?: string };
}

const STORAGE_KEY = 'lv_quick_trade_pos_v1';
const DEFAULT_POS = { x: 10, y: 58 };

function loadInitialPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number' &&
          Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
        return { x: parsed.x, y: parsed.y };
      }
    }
  } catch {
    // Ignore storage errors
  }
  return DEFAULT_POS;
}

export const OnChartQuickTrade: React.FC<OnChartQuickTradeProps> = React.memo(
  ({
    visible,
    market,
    quote,
    lotSize,
    maxAffordableLot,
    isPoorBalance,
    onChangeLotSize,
    onExecuteQuickOrder,
  }) => {
    const { shouldRender, isClosing } = useAnimatedPresence(visible, 155);
    const [lotText, setLotText] = useState<string>(() => lotSize.toFixed(2));
    const [flashMsg, setFlashMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const [pos, setPos] = useState<{ x: number; y: number }>(loadInitialPos);
    const [isDragging, setIsDragging] = useState(false);

    const rootRef = useRef<HTMLDivElement | null>(null);
    const posRef = useRef(pos);
    posRef.current = pos;
    const isFocusedRef = useRef(false);
    const flashTimerRef = useRef<number | null>(null);
    const rafDragRef = useRef<number | null>(null);

    const dragStateRef = useRef<{
      active: boolean;
      pointerId: number;
      startClientX: number;
      startClientY: number;
      origX: number;
      origY: number;
    }>({
      active: false,
      pointerId: -1,
      startClientX: 0,
      startClientY: 0,
      origX: 0,
      origY: 0,
    });

    const clampToParent = useCallback((x: number, y: number): { x: number; y: number } => {
      const el = rootRef.current;
      const parent = el?.parentElement;
      if (!el || !parent) {
        return { x: Math.max(6, x), y: Math.max(8, y) };
      }
      const pw = parent.clientWidth;
      const ph = parent.clientHeight;
      const ew = el.offsetWidth || 260;
      const eh = el.offsetHeight || 44;
      const maxX = Math.max(8, pw - ew - 6);
      const maxY = Math.max(8, ph - eh - 28);
      return {
        x: Math.round(Math.max(6, Math.min(maxX, x))),
        y: Math.round(Math.max(8, Math.min(maxY, y))),
      };
    }, []);

    useEffect(() => {
      if (!isFocusedRef.current) {
        setLotText(lotSize.toFixed(2));
      }
    }, [lotSize]);

    useEffect(() => {
      if (!visible) return;
      const syncBounds = () => {
        const clamped = clampToParent(posRef.current.x, posRef.current.y);
        if (clamped.x !== posRef.current.x || clamped.y !== posRef.current.y) {
          posRef.current = clamped;
          setPos(clamped);
        }
      };
      const raf = requestAnimationFrame(syncBounds);
      window.addEventListener('resize', syncBounds, { passive: true });
      window.addEventListener('orientationchange', syncBounds, { passive: true });
      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', syncBounds);
        window.removeEventListener('orientationchange', syncBounds);
      };
    }, [visible, clampToParent]);

    useEffect(() => {
      return () => {
        if (flashTimerRef.current !== null) {
          window.clearTimeout(flashTimerRef.current);
        }
        if (rafDragRef.current !== null) {
          cancelAnimationFrame(rafDragRef.current);
        }
      };
    }, []);

    if (!shouldRender) return null;

    const decimals = MARKETS[market].decimals;

    const adjustLot = (delta: number) => {
      const parsed = Number(lotText);
      const base = Number.isFinite(parsed) && parsed > 0 ? parsed : lotSize;
      const cap = maxAffordableLot >= 0.01 ? maxAffordableLot : 0.01;
      let next = Math.round((base + delta) * 100) / 100;
      if (delta > 0) {
        next = Math.min(cap, next);
      }
      const clamped = Math.min(1000, Math.max(0.01, next));
      setLotText(clamped.toFixed(2));
      onChangeLotSize(clamped);
    };

    const handleLotInputChange = (raw: string) => {
      setLotText(raw);
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0.01 && parsed <= 1000) {
        onChangeLotSize(Math.round(parsed * 100) / 100);
      }
    };

    const handleLotBlur = () => {
      const parsed = Number(lotText);
      if (!Number.isFinite(parsed) || parsed < 0.01) {
        setLotText('0.01');
        onChangeLotSize(0.01);
      } else if (parsed > 1000) {
        setLotText('1000.00');
        onChangeLotSize(1000);
      } else {
        const clean = Math.round(parsed * 100) / 100;
        setLotText(clean.toFixed(2));
        onChangeLotSize(clean);
      }
    };

    const handleTrade = (direction: TradeDirection) => {
      const parsed = Number(lotText);
      const effectiveLot = Number.isFinite(parsed) ? parsed : lotSize;
      if (isPoorBalance) {
        setFlashMsg({ kind: 'err', text: 'POOR ACCOUNT BALANCE LEVEL SET BALANCE TO CONTINUE' });
      } else {
        const res = onExecuteQuickOrder({
          symbol: market,
          direction,
          lotSize: effectiveLot,
          sl: null,
          tp: null,
        });
        if (!res.ok) {
          setFlashMsg({ kind: 'err', text: res.error || 'Order rejected' });
        } else {
          setFlashMsg({
            kind: 'ok',
            text: `${direction} ${effectiveLot.toFixed(2)} @ ${
              quote ? formatPrice(direction === 'BUY' ? quote.ask : quote.bid, decimals) : ''
            }`,
          });
        }
      }
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
      flashTimerRef.current = window.setTimeout(() => {
        setFlashMsg(null);
        flashTimerRef.current = null;
      }, 2400);
    };

    const handleHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragStateRef.current = {
        active: true,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origX: posRef.current.x,
        origY: posRef.current.y,
      };
      setIsDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture edge case
      }
    };

    const handleHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const ds = dragStateRef.current;
      if (!ds.active || e.pointerId !== ds.pointerId) return;
      const rawX = ds.origX + (e.clientX - ds.startClientX);
      const rawY = ds.origY + (e.clientY - ds.startClientY);
      const clamped = clampToParent(rawX, rawY);
      posRef.current = clamped;
      if (rafDragRef.current === null) {
        rafDragRef.current = requestAnimationFrame(() => {
          rafDragRef.current = null;
          if (rootRef.current) {
            rootRef.current.style.transform = `translate3d(${posRef.current.x}px, ${posRef.current.y}px, 0)`;
          }
        });
      }
    };

    const handleHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
      const ds = dragStateRef.current;
      if (!ds.active || e.pointerId !== ds.pointerId) return;
      ds.active = false;
      setIsDragging(false);
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore
      }
      const finalPos = posRef.current;
      setPos(finalPos);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(finalPos));
      } catch {
        // Ignore storage errors
      }
    };

    return (
      <div
        ref={rootRef}
        data-testid="onchart-quick-trade"
        style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}
        className={`lv-gpu-layer absolute top-0 left-0 z-20 flex flex-col items-start gap-1 ${
          isClosing ? 'pointer-events-none' : ''
        } ${isDragging ? 'ring-1 ring-[#D4AF37]/70 rounded-lg' : ''}`}
      >
        <div
          className={`${
            isClosing ? 'animate-lv-quickbar-out' : 'animate-lv-quickbar-in'
          } flex items-stretch self-start overflow-hidden rounded-lg border border-white/25 bg-[#0B0B10]/96 shadow-2xl`}
        >
          {/* Freely Movable Drag Handle */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Move Quick Trade Bar"
            title="Drag to move anywhere on chart"
            data-testid="onchart-drag-handle"
            onPointerDown={handleHandlePointerDown}
            onPointerMove={handleHandlePointerMove}
            onPointerUp={handleHandlePointerUp}
            onPointerCancel={handleHandlePointerUp}
            className="flex w-6 shrink-0 items-center justify-center border-r border-white/15 bg-[#16161F] text-neutral-400 hover:text-[#D4AF37] touch-none cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </div>

          {/* SELL Button */}
          <button
            type="button"
            disabled={!quote}
            onClick={() => handleTrade('SELL')}
            data-testid="onchart-sell-btn"
            className={`flex min-w-[74px] flex-col items-center justify-center bg-[#E54855] px-2.5 py-1 text-white hover:bg-[#D63946] active:scale-95 disabled:opacity-45 transition-transform duration-150 cursor-pointer ${
              isPoorBalance ? 'opacity-65' : ''
            }`}
          >
            <span className="text-[9px] font-bold tracking-wider uppercase leading-none">
              SELL
            </span>
            <span className="mt-0.5 font-mono-num text-[11px] font-bold leading-none">
              {quote ? formatPrice(quote.bid, decimals) : '—'}
            </span>
          </button>

          {/* Center Lot Size Stepper & Input */}
          <div className="flex items-center border-x border-white/15 bg-[#121218] px-0.5">
            <button
              type="button"
              onClick={() => adjustLot(-0.01)}
              aria-label="Decrease quick lot size"
              data-testid="onchart-lot-minus"
              className="flex h-9 w-7 items-center justify-center text-white hover:bg-white/10 active:scale-90 transition-transform cursor-pointer"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <input
              type="number"
              inputMode="decimal"
              min={0.01}
              max={1000}
              step="0.01"
              aria-label="Quick Lot Size"
              data-testid="onchart-lot-input"
              value={lotText}
              onFocus={() => {
                isFocusedRef.current = true;
              }}
              onChange={(e) => handleLotInputChange(e.target.value)}
              onBlur={() => {
                isFocusedRef.current = false;
                handleLotBlur();
              }}
              className="h-9 w-13 bg-transparent text-center font-mono-num text-xs font-bold text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              type="button"
              onClick={() => adjustLot(0.01)}
              aria-label="Increase quick lot size"
              data-testid="onchart-lot-plus"
              className="flex h-9 w-7 items-center justify-center text-white hover:bg-white/10 active:scale-90 transition-transform cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* BUY Button */}
          <button
            type="button"
            disabled={!quote}
            onClick={() => handleTrade('BUY')}
            data-testid="onchart-buy-btn"
            className={`flex min-w-[74px] flex-col items-center justify-center bg-[#16A34A] px-2.5 py-1 text-white hover:bg-[#15803D] active:scale-95 disabled:opacity-45 transition-transform duration-150 cursor-pointer ${
              isPoorBalance ? 'opacity-65' : ''
            }`}
          >
            <span className="text-[9px] font-bold tracking-wider uppercase leading-none">
              BUY
            </span>
            <span className="mt-0.5 font-mono-num text-[11px] font-bold leading-none">
              {quote ? formatPrice(quote.ask, decimals) : '—'}
            </span>
          </button>

          {/* Right-side Freely Movable Drag Handle */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Move Quick Trade Bar (Right)"
            title="Drag to move anywhere on chart"
            data-testid="onchart-drag-handle-right"
            onPointerDown={handleHandlePointerDown}
            onPointerMove={handleHandlePointerMove}
            onPointerUp={handleHandlePointerUp}
            onPointerCancel={handleHandlePointerUp}
            className="flex w-6 shrink-0 items-center justify-center border-l border-white/15 bg-[#16161F] text-neutral-400 hover:text-[#D4AF37] touch-none cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </div>
        </div>

        {flashMsg && (
          <div
            data-testid="onchart-flash-msg"
            className={`${
              isClosing ? 'animate-lv-panel-out' : 'animate-lv-panel-in'
            } self-start rounded px-2 py-0.5 font-mono-num text-[10px] font-bold shadow ${
              flashMsg.kind === 'err'
                ? 'bg-[#E54855] text-white'
                : 'bg-[#19B87D] text-black'
            }`}
          >
            {flashMsg.text}
          </div>
        )}
      </div>
    );
  }
);

OnChartQuickTrade.displayName = 'OnChartQuickTrade';
