import React, { useEffect, useRef, useState } from 'react';
import { GripHorizontal, X } from 'lucide-react';
import { TOOL_BY_ID } from '../modules/drawingCatalogue';
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
      barW: 44,
      barH: 340,
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
        const clampedX = Math.max(8, Math.min(window.innerWidth - d.barW - 8, d.origX + dx));
        const clampedY = Math.max(8, Math.min(window.innerHeight - d.barH - 56, d.origY + dy));
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
        const barW = barRef.current?.offsetWidth ?? 44;
        const barH = barRef.current?.offsetHeight ?? 260;
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
        origX: rect ? rect.left : window.innerWidth - 136,
        origY: rect ? rect.top : 14,
        barW: el?.offsetWidth ?? 44,
        barH: el?.offsetHeight ?? 340,
        rafId: null,
        pendingPos: null,
      };
    };

    const style: React.CSSProperties = pos
      ? { left: `${pos.x}px`, top: `${pos.y}px` }
      : { right: '92px', top: '14px' };

    return (
      <aside
        ref={barRef}
        style={style}
        aria-label="Favorite Drawing Tools"
        data-testid="floating-favorites-bar"
        className="lv-gpu-layer fixed z-30 flex flex-col items-center gap-0.5 rounded-lg border border-[#FFFFFF]/40 bg-[#0A0A0C]/96 p-1 shadow-[0_10px_28px_rgba(0,0,0,0.55)] max-h-[calc(100dvh-76px)] overflow-y-auto no-scrollbar select-none"
      >
        {/* Draggable toolbar handle */}
        <div
          onPointerDown={startDrag}
          title="DRAG TOOLBAR"
          className="flex w-8 h-6 items-center justify-center rounded text-[#FFFFFF]/75 hover:text-[#FFFFFF] cursor-grab active:cursor-grabbing touch-none"
        >
          <GripHorizontal className="w-4 h-4" />
        </div>

        <div className="w-6 h-px bg-[#FFFFFF]/25 mb-0.5" />

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

        <div className="w-6 h-px bg-[#FFFFFF]/25 my-0.5" />

        {/* Hide floating favorites toolbar */}
        <button
          type="button"
          onClick={onHide}
          title="HIDE FAVORITES TOOLBAR"
          aria-label="Hide Favorites Toolbar"
          className="flex h-7 w-8 items-center justify-center rounded text-[#9A9892] hover:text-[#FFFFFF] hover:bg-[#FFFFFF]/15 cursor-pointer shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </aside>
    );
  }
);

FloatingFavoritesBar.displayName = 'FloatingFavoritesBar';
