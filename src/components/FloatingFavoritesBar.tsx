import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GripHorizontal, GripVertical, RotateCw, X } from 'lucide-react';
import { TOOL_BY_ID } from '../modules/drawingCatalogue';
import {
  FavoritesBarOrientation,
  loadFavoritesBarOrientation,
  saveFavoritesBarOrientation,
} from '../modules/drawingStorage';
import { ToolIcon } from './ToolIcon';

interface FloatingFavoritesBarProps {
  visible: boolean;
  favoriteIds: string[];
  activeToolId: string;
  initialPosition: { x: number; y: number } | null;
  onSelectTool: (toolId: string) => void;
  onHide: () => void;
  onPositionChange: (pos: { x: number; y: number }) => void;
}

export const FloatingFavoritesBar: React.FC<FloatingFavoritesBarProps> = React.memo(
  ({
    visible,
    favoriteIds,
    activeToolId,
    initialPosition,
    onSelectTool,
    onHide,
    onPositionChange,
  }) => {
    const barRef = useRef<HTMLDivElement | null>(null);
    const [pos, setPos] = useState<{ x: number; y: number } | null>(initialPosition);
    const [orientation, setOrientation] = useState<FavoritesBarOrientation>(() =>
      loadFavoritesBarOrientation()
    );
    const isLandscape = orientation === 'landscape';
    const posRef = useRef<{ x: number; y: number } | null>(initialPosition);
    const onPositionChangeRef = useRef(onPositionChange);
    onPositionChangeRef.current = onPositionChange;

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
      barH: 44,
      rafId: null,
      pendingPos: null,
    });

    useEffect(() => {
      const applyDomPos = (nextPos: { x: number; y: number }) => {
        const el = barRef.current;
        if (!el) return;
        el.style.right = 'auto';
        el.style.left = `${nextPos.x}px`;
        el.style.top = `${nextPos.y}px`;
      };

      const handleMove = (e: PointerEvent) => {
        const d = draggingRef.current;
        if (!d.active) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        const maxX = Math.max(8, window.innerWidth - d.barW - 8);
        const maxY = Math.max(8, window.innerHeight - d.barH - 56);
        const clampedX = Math.max(8, Math.min(maxX, d.origX + dx));
        const clampedY = Math.max(8, Math.min(maxY, d.origY + dy));
        const nextPos = { x: clampedX, y: clampedY };
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
          onPositionChangeRef.current(posRef.current);
        }
      };

      const handleResize = () => {
        if (!posRef.current) return;
        const barW = barRef.current?.offsetWidth ?? 360;
        const barH = barRef.current?.offsetHeight ?? 44;
        const maxX = Math.max(8, window.innerWidth - barW - 8);
        const maxY = Math.max(8, window.innerHeight - barH - 56);
        const clamped = {
          x: Math.max(8, Math.min(maxX, posRef.current.x)),
          y: Math.max(8, Math.min(maxY, posRef.current.y)),
        };
        posRef.current = clamped;
        applyDomPos(clamped);
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

    // Keep saved/dragged position safely inside viewport when orientation or tool count changes
    useLayoutEffect(() => {
      if (!visible || !posRef.current || !barRef.current) return;
      const barW = barRef.current.offsetWidth;
      const barH = barRef.current.offsetHeight;
      const maxX = Math.max(8, window.innerWidth - barW - 8);
      const maxY = Math.max(8, window.innerHeight - barH - 56);
      const clampedX = Math.max(8, Math.min(maxX, posRef.current.x));
      const clampedY = Math.max(8, Math.min(maxY, posRef.current.y));
      if (clampedX !== posRef.current.x || clampedY !== posRef.current.y) {
        const clamped = { x: clampedX, y: clampedY };
        posRef.current = clamped;
        setPos(clamped);
        onPositionChangeRef.current(clamped);
      }
    }, [visible, orientation, favoriteIds.length]);

    if (!visible || favoriteIds.length === 0) return null;

    const startDrag = (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = barRef.current;
      const rect = el?.getBoundingClientRect();
      draggingRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        origX: rect ? rect.left : isLandscape ? 12 : window.innerWidth - 136,
        origY: rect ? rect.top : 14,
        barW: el?.offsetWidth ?? (isLandscape ? 360 : 44),
        barH: el?.offsetHeight ?? (isLandscape ? 44 : 340),
        rafId: null,
        pendingPos: null,
      };
    };

    const handleToggleOrientation = () => {
      const next: FavoritesBarOrientation = isLandscape ? 'portrait' : 'landscape';
      setOrientation(next);
      saveFavoritesBarOrientation(next);
    };

    const style: React.CSSProperties = pos
      ? { left: `${pos.x}px`, top: `${pos.y}px` }
      : isLandscape
        ? { left: '12px', top: '12px' }
        : { right: '92px', top: '14px' };

    return (
      <aside
        ref={barRef}
        style={style}
        aria-label="Favorite Drawing Tools"
        data-testid="floating-favorites-bar"
        data-orientation={orientation}
        className={`lv-gpu-layer fixed z-30 flex items-center gap-0.5 rounded-lg border border-[#FFFFFF]/40 bg-[#0A0A0C]/96 p-1 shadow-[0_10px_28px_rgba(0,0,0,0.55)] no-scrollbar select-none ${
          isLandscape
            ? 'flex-row max-w-[calc(100vw-24px)] overflow-x-auto'
            : 'flex-col max-h-[calc(100dvh-76px)] overflow-y-auto'
        }`}
      >
        {/* Draggable toolbar handle */}
        <div
          onPointerDown={startDrag}
          title="DRAG TOOLBAR"
          className={`flex items-center justify-center rounded text-[#FFFFFF]/75 hover:text-[#FFFFFF] cursor-grab active:cursor-grabbing touch-none shrink-0 ${
            isLandscape ? 'h-8 w-6' : 'w-8 h-6'
          }`}
        >
          {isLandscape ? (
            <GripVertical className="w-4 h-4" />
          ) : (
            <GripHorizontal className="w-4 h-4" />
          )}
        </div>

        <div
          className={
            isLandscape
              ? 'h-6 w-px bg-[#FFFFFF]/25 mx-0.5 shrink-0'
              : 'w-6 h-px bg-[#FFFFFF]/25 mb-0.5 shrink-0'
          }
        />

        {/* Exact favorite-tool order with white icons */}
        {favoriteIds.map((toolId) => {
          const tool = TOOL_BY_ID[toolId];
          if (!tool) return null;
          const active = activeToolId === toolId;
          return (
            <button
              key={toolId}
              type="button"
              onClick={() => onSelectTool(toolId)}
              title={tool.name}
              aria-label={tool.name}
              className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors cursor-pointer shrink-0 ${
                active
                  ? 'border-[#FFFFFF] bg-[#FFFFFF]/20 text-[#FFFFFF]'
                  : 'border-transparent text-[#FFFFFF] hover:bg-[#FFFFFF]/15 hover:text-[#FFFFFF]'
              }`}
            >
              <ToolIcon toolId={toolId} className="w-4 h-4" />
            </button>
          );
        })}

        <div
          className={
            isLandscape
              ? 'h-6 w-px bg-[#FFFFFF]/25 mx-0.5 shrink-0'
              : 'w-6 h-px bg-[#FFFFFF]/25 my-0.5 shrink-0'
          }
        />

        {/* Orientation toggle (Landscape / Vertical) */}
        <button
          type="button"
          onClick={handleToggleOrientation}
          title={isLandscape ? 'SWITCH TO VERTICAL MODE' : 'SWITCH TO LANDSCAPE MODE'}
          aria-label={isLandscape ? 'Switch to Vertical Mode' : 'Switch to Landscape Mode'}
          data-testid="favorites-orientation-toggle"
          className={`flex items-center justify-center rounded text-[#9A9892] hover:text-[#FFFFFF] hover:bg-[#FFFFFF]/15 cursor-pointer shrink-0 ${
            isLandscape ? 'h-8 w-7' : 'h-7 w-8'
          }`}
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>

        {/* Hide floating favorites toolbar */}
        <button
          type="button"
          onClick={onHide}
          title="HIDE FAVORITES TOOLBAR"
          aria-label="Hide Favorites Toolbar"
          className={`flex items-center justify-center rounded text-[#9A9892] hover:text-[#FFFFFF] hover:bg-[#FFFFFF]/15 cursor-pointer shrink-0 ${
            isLandscape ? 'h-8 w-7' : 'h-7 w-8'
          }`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </aside>
    );
  }
);

FloatingFavoritesBar.displayName = 'FloatingFavoritesBar';
