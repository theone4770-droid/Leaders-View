import React, { useEffect, useRef, useState } from 'react';
import { Copy, GripVertical, Settings, Trash2, X } from 'lucide-react';
import { DrawingObject, LineStyleType } from '../types/chart';
import { TOOL_BY_ID } from '../modules/drawingCatalogue';
import { loadPropBarPosition, savePropBarPosition } from '../modules/drawingStorage';
import { FibSettingsModal } from './FibSettingsModal';

interface DrawingPropertiesBarProps {
  drawing: DrawingObject | null;
  onUpdate: (patch: Partial<DrawingObject>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const SWATCHES = ['#FFFFFF', '#9A9892', '#19B87D', '#E54855', '#3B82F6', '#F97316', '#A855F7'];

const TEXT_CAPABLE_TOOLS = new Set([
  'text',
  'anchored_text',
  'note',
  'price_note',
  'pin',
  'callout',
  'comment',
]);

export const DrawingPropertiesBar: React.FC<DrawingPropertiesBarProps> = React.memo(
  ({ drawing, onUpdate, onDuplicate, onDelete, onClose }) => {
    const barRef = useRef<HTMLDivElement | null>(null);
    const [pos, setPos] = useState<{ x: number; y: number } | null>(() => loadPropBarPosition());
    const posRef = useRef<{ x: number; y: number } | null>(pos);
    posRef.current = pos;
    const [isFibSettingsOpen, setIsFibSettingsOpen] = useState(false);

    useEffect(() => {
      if (!drawing || drawing.toolId !== 'fib_retracement') {
        setIsFibSettingsOpen(false);
      }
    }, [drawing?.id, drawing?.toolId]);

    const draggingRef = useRef<{
      active: boolean;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      barW: number;
      barH: number;
      rafId: number | null;
      pendingPos: { x: number; y: number } | null;
    }>({
      active: false,
      startX: 0,
      startY: 0,
      origX: 0,
      origY: 0,
      barW: 360,
      barH: 48,
      rafId: null,
      pendingPos: null,
    });

    useEffect(() => {
      const clampPos = (x: number, y: number, barW: number, barH: number) => ({
        x: Math.max(8, Math.min(Math.max(8, window.innerWidth - barW - 8), x)),
        y: Math.max(8, Math.min(Math.max(8, window.innerHeight - barH - 56), y)),
      });

      const applyDomPos = (nextPos: { x: number; y: number }) => {
        const el = barRef.current;
        if (!el) return;
        el.style.bottom = 'auto';
        el.style.transform = 'translateZ(0)';
        el.style.left = `${nextPos.x}px`;
        el.style.top = `${nextPos.y}px`;
      };

      const handleMove = (e: PointerEvent) => {
        const d = draggingRef.current;
        if (!d.active) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        const nextPos = clampPos(d.origX + dx, d.origY + dy, d.barW, d.barH);
        posRef.current = nextPos;
        d.pendingPos = nextPos;
        if (d.rafId === null) {
          d.rafId = requestAnimationFrame(() => {
            d.rafId = null;
            if (d.pendingPos) {
              applyDomPos(d.pendingPos);
              d.pendingPos = null;
            }
          });
        }
      };

      const handleUp = () => {
        const d = draggingRef.current;
        if (!d.active) return;
        d.active = false;
        if (d.rafId !== null) {
          cancelAnimationFrame(d.rafId);
          d.rafId = null;
        }
        if (d.pendingPos) {
          applyDomPos(d.pendingPos);
          d.pendingPos = null;
        }
        if (posRef.current) {
          setPos(posRef.current);
          savePropBarPosition(posRef.current);
        }
      };

      const handleResize = () => {
        if (!posRef.current) return;
        const barW = barRef.current?.offsetWidth ?? 360;
        const barH = barRef.current?.offsetHeight ?? 48;
        const clamped = clampPos(posRef.current.x, posRef.current.y, barW, barH);
        posRef.current = clamped;
        setPos(clamped);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleUp);
      window.addEventListener('resize', handleResize, { passive: true });
      window.addEventListener('orientationchange', handleResize, { passive: true });
      return () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleUp);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('orientationchange', handleResize);
        if (draggingRef.current.rafId !== null) {
          cancelAnimationFrame(draggingRef.current.rafId);
        }
      };
    }, []);

    if (!drawing) return null;

    const toolDef = TOOL_BY_ID[drawing.toolId];
    const supportsText = TEXT_CAPABLE_TOOLS.has(drawing.toolId);

    const startDrag = (e: React.PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        target.closest('button, input, select, textarea, label') &&
        !target.closest('[data-drag-handle="true"]')
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const el = barRef.current;
      const rect = el?.getBoundingClientRect();
      const origX = rect ? rect.left : Math.max(8, (window.innerWidth - 400) / 2);
      const origY = rect ? rect.top : Math.max(8, window.innerHeight - 106);
      draggingRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        origX,
        origY,
        barW: el?.offsetWidth ?? 360,
        barH: el?.offsetHeight ?? 48,
        rafId: null,
        pendingPos: null,
      };
    };

    const resetPosition = () => {
      posRef.current = null;
      setPos(null);
      savePropBarPosition(null);
    };

    const style: React.CSSProperties = pos
      ? { left: `${pos.x}px`, top: `${pos.y}px` }
      : { bottom: '58px', left: '50%', transform: 'translateX(-50%)' };

    return (
      <>
        <div
          ref={barRef}
          style={style}
          onPointerDown={startDrag}
          data-testid="drawing-properties-bar"
          className="lv-gpu-layer fixed z-30 flex flex-nowrap items-center gap-1.5 w-max max-w-[calc(100vw-16px)] overflow-x-auto no-scrollbar whitespace-nowrap rounded-lg border border-[#141311]/30 dark:border-[#FFFFFF]/35 bg-[#FFFFFF]/96 dark:bg-[#101013]/96 px-2.5 py-1.5 shadow-2xl select-none"
        >
          {/* Movable drag grip handle */}
          <div
            data-drag-handle="true"
            onPointerDown={startDrag}
            onDoubleClick={resetPosition}
            title="DRAG TO MOVE TOOLBAR (DOUBLE-CLICK TO RESET)"
            className="flex h-7 w-5 items-center justify-center rounded text-[#141311] dark:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/15 cursor-grab active:cursor-grabbing touch-none shrink-0"
          >
            <GripVertical className="w-4 h-4" />
          </div>

          <span
            title="DRAG TO MOVE TOOLBAR"
            className="text-[10.5px] font-bold tracking-[0.12em] text-[#141311] dark:text-[#FFFFFF] whitespace-nowrap cursor-grab active:cursor-grabbing touch-none shrink-0"
          >
            {toolDef?.name ?? 'DRAWING'}
          </span>

          <div className="h-4 w-px shrink-0 bg-[#141311]/20 dark:bg-[#FFFFFF]/20" />

          {/* Color swatches */}
          <div className="flex items-center gap-1 shrink-0">
            {SWATCHES.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => onUpdate({ style: { ...drawing.style, color: hex } })}
                aria-label={`Set color ${hex}`}
                className={`h-4.5 w-4.5 shrink-0 rounded-full border transition-transform cursor-pointer ${
                  drawing.style.color.toLowerCase() === hex.toLowerCase()
                    ? 'scale-110 border-[#141311] dark:border-[#FFFFFF] ring-2 ring-[#141311]/35 dark:ring-[#FFFFFF]/40'
                    : 'border-black/25 dark:border-white/25'
                }`}
                style={{ backgroundColor: hex }}
              />
            ))}
            <input
              type="color"
              value={drawing.style.color}
              onChange={(e) => onUpdate({ style: { ...drawing.style, color: e.target.value } })}
              aria-label="Custom color"
              className="h-5 w-5 shrink-0 rounded cursor-pointer border border-[#141311]/35 dark:border-[#FFFFFF]/40 bg-transparent p-0"
            />
          </div>

          <div className="h-4 w-px shrink-0 bg-[#141311]/20 dark:bg-[#FFFFFF]/20" />

          {/* Line thickness */}
          <div className="flex items-center gap-1 shrink-0">
            {[1, 2, 3, 4].map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => onUpdate({ style: { ...drawing.style, lineWidth: w } })}
                className={`h-6 w-6 shrink-0 rounded text-[11px] font-mono-num font-bold border cursor-pointer ${
                  drawing.style.lineWidth === w
                    ? 'border-[#141311] dark:border-[#FFFFFF] bg-[#141311]/15 dark:bg-[#FFFFFF]/20 text-[#141311] dark:text-[#FFFFFF]'
                    : 'border-transparent text-[#625D52] dark:text-[#9A9892] hover:border-[#141311]/40 dark:hover:border-[#FFFFFF]/40'
                }`}
              >
                {w}
              </button>
            ))}
          </div>

          {/* Line style */}
          <div className="flex items-center gap-1 shrink-0">
            {(['solid', 'dashed', 'dotted'] as LineStyleType[]).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => onUpdate({ style: { ...drawing.style, lineStyle: st } })}
                className={`px-2 h-6 shrink-0 rounded text-[10px] font-bold tracking-wider uppercase border cursor-pointer ${
                  drawing.style.lineStyle === st
                    ? 'border-[#141311] dark:border-[#FFFFFF] bg-[#141311]/15 dark:bg-[#FFFFFF]/20 text-[#141311] dark:text-[#FFFFFF]'
                    : 'border-transparent text-[#625D52] dark:text-[#9A9892] hover:border-[#141311]/40 dark:hover:border-[#FFFFFF]/40'
                }`}
              >
                {st.slice(0, 3)}
              </button>
            ))}
          </div>

          {/* Opacity */}
          {(() => {
            const opacityPct = Math.round((drawing.style.opacity ?? 1) * 100);
            const sliderRatio = Math.max(0, Math.min(1, (opacityPct - 15) / 85));
            return (
              <label className="flex items-center gap-1.5 shrink-0 text-[10px] font-mono-num text-[#141311] dark:text-[#FFFFFF]">
                <span>{opacityPct}%</span>
                <span className="relative flex h-5 w-14 items-center rounded bg-[#141311]/90 px-1 dark:bg-transparent dark:px-0">
                  <span className="pointer-events-none relative flex h-full w-full items-center">
                    <span className="h-px w-full rounded-full bg-[#FACC15]" />
                    <span
                      className="absolute top-1/2 h-[9px] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-[1px] bg-[#FACC15]"
                      style={{ left: `${sliderRatio * 100}%` }}
                    />
                  </span>
                  <input
                    type="range"
                    min={15}
                    max={100}
                    value={opacityPct}
                    onChange={(e) =>
                      onUpdate({ style: { ...drawing.style, opacity: Number(e.target.value) / 100 } })
                    }
                    aria-label="Drawing Opacity"
                    className="lv-thin-range absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </span>
              </label>
            );
          })()}

          {/* Inline text editor for annotation tools */}
          {supportsText && (
            <input
              type="text"
              value={drawing.text ?? ''}
              onChange={(e) => onUpdate({ text: e.target.value })}
              placeholder="Annotation text..."
              aria-label="Edit drawing text"
              className="h-7 w-32 sm:w-40 shrink-0 px-2 rounded border border-[#141311]/30 dark:border-[#FFFFFF]/30 bg-[#FBF9F4] dark:bg-[#17171B] text-xs text-[#141311] dark:text-[#F5F5F7] focus:outline-none focus:border-[#141311] dark:focus:border-[#FFFFFF]"
            />
          )}

          <div className="h-4 w-px shrink-0 bg-[#141311]/20 dark:bg-[#FFFFFF]/20" />

          {/* TradingView-style Settings button for Fibonacci Retracement */}
          {drawing.toolId === 'fib_retracement' && (
            <button
              type="button"
              onClick={() => setIsFibSettingsOpen(true)}
              title="FIBONACCI SETTINGS (SELECT LEVELS)"
              aria-label="Fibonacci Retracement Settings"
              data-testid="fib-settings-btn"
              className="flex h-7 shrink-0 items-center gap-1 rounded px-2 border border-[#141311]/25 dark:border-[#FFFFFF]/30 bg-[#141311]/8 dark:bg-[#FFFFFF]/12 text-[10.5px] font-bold tracking-wider text-[#141311] dark:text-[#FFFFFF] hover:bg-[#141311]/15 dark:hover:bg-[#FFFFFF]/22 cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>SETTINGS</span>
            </button>
          )}

          {/* Duplicate & Delete */}
          <button
            type="button"
            onClick={onDuplicate}
            title="DUPLICATE DRAWING"
            aria-label="Duplicate drawing"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#141311] dark:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/15 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="DELETE DRAWING (DEL)"
            aria-label="Delete drawing"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#D63946] dark:text-[#E54855] hover:bg-[#E54855]/15 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="DESELECT"
            aria-label="Deselect drawing"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#625D52] dark:text-[#9A9892] hover:text-[#141311] dark:hover:text-[#FFFFFF] cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <FibSettingsModal
          open={isFibSettingsOpen}
          drawing={drawing}
          onUpdate={onUpdate}
          onClose={() => setIsFibSettingsOpen(false)}
        />
      </>
    );
  }
);

DrawingPropertiesBar.displayName = 'DrawingPropertiesBar';
