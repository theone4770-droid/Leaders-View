import React, { useState } from 'react';
import { Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { DrawingObject, FibLevelConfig } from '../types/chart';
import {
  DEFAULT_FIB_RETRACEMENT_LEVELS,
  getFibRetracementLevels,
} from '../modules/drawingEngine';
import { saveFibSettingsPreset } from '../modules/drawingStorage';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

interface FibSettingsModalProps {
  open: boolean;
  drawing: DrawingObject;
  onUpdate: (patch: Partial<DrawingObject>) => void;
  onClose: () => void;
}

interface FibLevelValueInputProps {
  value: number;
  onCommit: (next: number) => void;
}

const FibLevelValueInput: React.FC<FibLevelValueInputProps> = ({ value, onCommit }) => {
  const formatVal = (v: number) => (v === 0.11 ? '0.110' : String(v));
  const [text, setText] = useState(() => formatVal(value));

  React.useEffect(() => {
    setText(formatVal(value));
  }, [value]);

  const commit = () => {
    const trimmed = text.trim();
    const parsed = Number(trimmed);
    if (trimmed !== '' && Number.isFinite(parsed)) {
      onCommit(parsed);
      setText(formatVal(parsed));
    } else {
      setText(formatVal(value));
    }
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        if (next.trim() !== '' && !next.endsWith('.')) {
          const parsed = Number(next);
          if (Number.isFinite(parsed)) {
            onCommit(parsed);
          }
        }
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
      aria-label={`Level value ${value}`}
      className="w-16 bg-transparent font-mono-num text-xs font-semibold text-[#141311] dark:text-[#FFFFFF] focus:outline-none"
    />
  );
};

export const FibSettingsModal: React.FC<FibSettingsModalProps> = ({
  open,
  drawing,
  onUpdate,
  onClose,
}) => {
  const { shouldRender, isClosing } = useAnimatedPresence(
    open && drawing.toolId === 'fib_retracement',
    155
  );
  const [newLevelInput, setNewLevelInput] = useState('');

  if (!shouldRender || drawing.toolId !== 'fib_retracement') return null;

  const levels = getFibRetracementLevels(drawing);
  const showPrices = drawing.meta?.fibShowPrices !== false;
  const showBackground = drawing.meta?.fibShowBackground !== false;
  const extendRight = Boolean(drawing.meta?.fibExtendRight);
  const reverse = Boolean(drawing.meta?.fibReverse);

  const persistPreset = (nextMeta: NonNullable<DrawingObject['meta']>) => {
    saveFibSettingsPreset({
      fibLevels: (nextMeta.fibLevels ?? levels).map((l) => ({ ...l })),
      fibShowPrices: nextMeta.fibShowPrices !== false,
      fibShowBackground: nextMeta.fibShowBackground !== false,
      fibExtendRight: Boolean(nextMeta.fibExtendRight),
      fibReverse: Boolean(nextMeta.fibReverse),
    });
  };

  const commitMetaPatch = (patchMeta: Partial<NonNullable<DrawingObject['meta']>>) => {
    const nextMeta: NonNullable<DrawingObject['meta']> = {
      ...drawing.meta,
      fibLevels: levels.map((l) => ({ ...l })),
      fibShowPrices: showPrices,
      fibShowBackground: showBackground,
      fibExtendRight: extendRight,
      fibReverse: reverse,
      ...patchMeta,
    };
    persistPreset(nextMeta);
    onUpdate({ meta: nextMeta });
  };

  const commitLevels = (nextLevels: FibLevelConfig[]) => {
    commitMetaPatch({ fibLevels: nextLevels });
  };

  const toggleLevel = (idx: number) => {
    const next = levels.map((item, i) =>
      i === idx ? { ...item, enabled: !item.enabled } : item
    );
    commitLevels(next);
  };

  const updateLevelValue = (idx: number, parsed: number) => {
    if (!Number.isFinite(parsed)) return;
    const next = levels.map((item, i) => (i === idx ? { ...item, level: parsed } : item));
    commitLevels(next);
  };

  const updateLevelColor = (idx: number, color: string) => {
    const next = levels.map((item, i) => (i === idx ? { ...item, color } : item));
    commitLevels(next);
  };

  const removeLevel = (idx: number) => {
    if (levels.length <= 1) return;
    commitLevels(levels.filter((_, i) => i !== idx));
  };

  const handleAddLevel = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(newLevelInput.trim());
    if (!Number.isFinite(parsed)) return;
    const next = [...levels, { level: parsed, enabled: true }].sort((a, b) => a.level - b.level);
    commitLevels(next);
    setNewLevelInput('');
  };

  const handleResetDefaults = () => {
    const nextMeta: NonNullable<DrawingObject['meta']> = {
      ...drawing.meta,
      fibLevels: DEFAULT_FIB_RETRACEMENT_LEVELS.map((l) => ({ ...l })),
      fibShowPrices: true,
      fibShowBackground: true,
      fibExtendRight: false,
      fibReverse: false,
    };
    persistPreset(nextMeta);
    onUpdate({ meta: nextMeta });
  };

  const handleSelectAll = () => {
    commitLevels(levels.map((l) => ({ ...l, enabled: true })));
  };

  const handleClearAll = () => {
    commitLevels(levels.map((l) => ({ ...l, enabled: false })));
  };

  const handleSaveAndClose = () => {
    persistPreset({
      ...drawing.meta,
      fibLevels: levels.map((l) => ({ ...l })),
      fibShowPrices: showPrices,
      fibShowBackground: showBackground,
      fibExtendRight: extendRight,
      fibReverse: reverse,
    });
    onClose();
  };

  return (
    <div
      className={`${
        isClosing ? 'animate-lv-fade-out pointer-events-none' : 'animate-lv-fade-in'
      } fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={handleSaveAndClose}
    >
      <div
        data-testid="fib-settings-modal"
        className={`${
          isClosing ? 'animate-lv-modal-out' : 'animate-lv-modal-in'
        } w-full max-w-md max-h-[calc(100dvh-20px)] flex flex-col rounded-lg border border-[#141311]/30 dark:border-[#FFFFFF]/35 bg-[#FFFFFF] dark:bg-[#0F0F12] shadow-2xl overflow-y-auto select-none`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#141311]/15 dark:border-[#FFFFFF]/15 shrink-0">
          <div>
            <h2 className="text-xs font-bold tracking-[0.16em] text-[#141311] dark:text-[#FFFFFF]">
              FIB RETRACEMENT SETTINGS
            </h2>
            <p className="mt-0.5 text-[10.5px] text-[#625D52] dark:text-[#9A9892]">
              SELECT LEVELS TO DISPLAY ON CHART
            </p>
          </div>
          <button
            type="button"
            onClick={handleSaveAndClose}
            aria-label="Close Fibonacci Settings"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#625D52] dark:text-[#9A9892] hover:text-[#141311] dark:hover:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Display toggles (TradingView style) */}
        <div className="grid grid-cols-2 gap-2 px-4 py-3 border-b border-[#141311]/12 dark:border-[#FFFFFF]/12 bg-[#F9F7F1] dark:bg-[#0B0B0D] shrink-0">
          <label className="flex items-center gap-2 text-[11px] font-semibold text-[#141311] dark:text-[#F5F5F7] cursor-pointer">
            <input
              type="checkbox"
              checked={extendRight}
              onChange={(e) => commitMetaPatch({ fibExtendRight: e.target.checked })}
              className="h-3.5 w-3.5 accent-[#141311] dark:accent-[#FFFFFF] cursor-pointer"
            />
            <span>EXTEND LINES RIGHT</span>
          </label>
          <label className="flex items-center gap-2 text-[11px] font-semibold text-[#141311] dark:text-[#F5F5F7] cursor-pointer">
            <input
              type="checkbox"
              checked={reverse}
              onChange={(e) => commitMetaPatch({ fibReverse: e.target.checked })}
              className="h-3.5 w-3.5 accent-[#141311] dark:accent-[#FFFFFF] cursor-pointer"
            />
            <span>REVERSE</span>
          </label>
          <label className="flex items-center gap-2 text-[11px] font-semibold text-[#141311] dark:text-[#F5F5F7] cursor-pointer">
            <input
              type="checkbox"
              checked={showPrices}
              onChange={(e) => commitMetaPatch({ fibShowPrices: e.target.checked })}
              className="h-3.5 w-3.5 accent-[#141311] dark:accent-[#FFFFFF] cursor-pointer"
            />
            <span>PRICES</span>
          </label>
          <label className="flex items-center gap-2 text-[11px] font-semibold text-[#141311] dark:text-[#F5F5F7] cursor-pointer">
            <input
              type="checkbox"
              checked={showBackground}
              onChange={(e) => commitMetaPatch({ fibShowBackground: e.target.checked })}
              className="h-3.5 w-3.5 accent-[#141311] dark:accent-[#FFFFFF] cursor-pointer"
            />
            <span>BACKGROUND</span>
          </label>
        </div>

        {/* Select / Clear / Add Level Toolbar */}
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-[#141311]/12 dark:border-[#FFFFFF]/12 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleSelectAll}
              className="px-2 py-1 rounded border border-[#141311]/20 dark:border-[#FFFFFF]/20 text-[10px] font-bold tracking-wider text-[#141311] dark:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/10 cursor-pointer"
            >
              ALL
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="px-2 py-1 rounded border border-[#141311]/20 dark:border-[#FFFFFF]/20 text-[10px] font-bold tracking-wider text-[#625D52] dark:text-[#9A9892] hover:text-[#141311] dark:hover:text-[#FFFFFF] cursor-pointer"
            >
              NONE
            </button>
          </div>

          <form onSubmit={handleAddLevel} className="flex items-center gap-1">
            <input
              type="number"
              step="any"
              value={newLevelInput}
              onChange={(e) => setNewLevelInput(e.target.value)}
              placeholder="e.g. 0.110"
              aria-label="Add custom Fibonacci level"
              className="w-24 h-7 px-2 rounded border border-[#141311]/25 dark:border-[#FFFFFF]/25 bg-[#FBF9F4] dark:bg-[#17171B] font-mono-num text-[11px] text-[#141311] dark:text-[#F5F5F7] focus:outline-none focus:border-[#141311] dark:focus:border-[#FFFFFF]"
            />
            <button
              type="submit"
              title="ADD FIB LEVEL"
              className="flex h-7 items-center gap-1 px-2 rounded bg-[#141311] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#080808] text-[10px] font-bold tracking-wider cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>ADD</span>
            </button>
          </form>
        </div>

        {/* Levels 2-column checklist (TradingView style) */}
        <div className="flex-1 min-h-[140px] overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-2">
            {levels.map((item, idx) => (
              <div
                key={`${idx}_${item.level}`}
                className={`flex items-center justify-between gap-1.5 rounded-md border px-2.5 py-1.5 transition-colors ${
                  item.enabled
                    ? 'border-[#141311]/35 dark:border-[#FFFFFF]/40 bg-[#141311]/5 dark:bg-[#FFFFFF]/10'
                    : 'border-[#141311]/12 dark:border-[#FFFFFF]/12 bg-[#FBF9F4] dark:bg-[#141418] opacity-65'
                }`}
              >
                <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={() => toggleLevel(idx)}
                    aria-label={`Toggle level ${item.level.toFixed(3)}`}
                    className="h-3.5 w-3.5 shrink-0 accent-[#141311] dark:accent-[#FFFFFF] cursor-pointer"
                  />
                  <FibLevelValueInput
                    value={item.level}
                    onCommit={(nextVal) => updateLevelValue(idx, nextVal)}
                  />
                </label>

                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="color"
                    value={item.color || drawing.style.color || '#FFFFFF'}
                    onChange={(e) => updateLevelColor(idx, e.target.value)}
                    aria-label={`Color for level ${item.level}`}
                    className="h-4 w-4 rounded border border-black/20 dark:border-white/25 bg-transparent p-0 cursor-pointer"
                  />
                  {levels.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLevel(idx)}
                      title="REMOVE LEVEL"
                      aria-label={`Remove level ${item.level}`}
                      className="flex h-5 w-5 items-center justify-center rounded text-[#625D52] dark:text-[#9A9892] hover:text-[#E54855] cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[#141311]/15 dark:border-[#FFFFFF]/15 bg-[#F9F7F1] dark:bg-[#0B0B0D] shrink-0">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[#141311]/25 dark:border-[#FFFFFF]/25 text-[11px] font-bold tracking-wider text-[#141311] dark:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/10 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>DEFAULTS</span>
          </button>

          <button
            type="button"
            onClick={handleSaveAndClose}
            className="px-4 py-1.5 rounded-md bg-[#141311] hover:bg-[#2A2824] dark:bg-[#FFFFFF] dark:hover:bg-[#E5E5E7] text-[#FFFFFF] dark:text-[#080808] text-[11px] font-bold tracking-wider cursor-pointer"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};
