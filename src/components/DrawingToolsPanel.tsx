import React, { useMemo, useState } from 'react';
import { Search, Star, X } from 'lucide-react';
import { DrawingCategoryId, DrawingToolDefinition } from '../types/chart';
import {
  DRAWING_CATEGORIES,
  DRAWING_TOOLS,
  TOOL_BY_ID,
  VISUAL_EMOJIS,
  VISUAL_ICONS,
  VISUAL_STICKERS,
} from '../modules/drawingCatalogue';
import { ToolIcon } from './ToolIcon';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

interface DrawingToolsPanelProps {
  open: boolean;
  activeToolId: string;
  favoriteIds: string[];
  showFavoritesOnChart: boolean;
  selectedVisualGlyph: string;
  onSelectTool: (toolId: string, visualGlyph?: string) => void;
  onToggleFavorite: (toolId: string) => void;
  onToggleShowFavoritesOnChart: () => void;
  onClose: () => void;
}

export const DrawingToolsPanel: React.FC<DrawingToolsPanelProps> = React.memo(({
  open,
  activeToolId,
  favoriteIds,
  showFavoritesOnChart,
  selectedVisualGlyph,
  onSelectTool,
  onToggleFavorite,
  onToggleShowFavoritesOnChart,
  onClose,
}) => {
  const { shouldRender, isClosing } = useAnimatedPresence(open, 155);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<DrawingCategoryId>('FAVORITES');
  const [visualSubPicker, setVisualSubPicker] = useState<'EMOJIS' | 'STICKERS' | 'ICONS' | null>(
    null
  );

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const filteredTools = useMemo<DrawingToolDefinition[]>(() => {
    if (!shouldRender) return [];
    const q = search.trim().toLowerCase();
    if (q) {
      return DRAWING_TOOLS.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.category.replace(/_/g, ' ').toLowerCase().includes(q)
      );
    }

    if (activeCategory === 'FAVORITES') {
      return favoriteIds.map((id) => TOOL_BY_ID[id]).filter(Boolean);
    }
    return DRAWING_TOOLS.filter((t) => t.category === activeCategory);
  }, [shouldRender, search, activeCategory, favoriteIds]);

  if (!shouldRender) return null;

  const handleToolClick = (tool: DrawingToolDefinition) => {
    if (tool.isVisualPicker) {
      setVisualSubPicker((prev) => (prev === tool.isVisualPicker ? null : tool.isVisualPicker!));
      return;
    }
    setVisualSubPicker(null);
    onSelectTool(tool.id);
    onClose();
  };

  const visualItems =
    visualSubPicker === 'EMOJIS'
      ? VISUAL_EMOJIS
      : visualSubPicker === 'STICKERS'
        ? VISUAL_STICKERS
        : visualSubPicker === 'ICONS'
          ? VISUAL_ICONS
          : [];

  return (
    <div
      className={`${
        isClosing ? 'animate-lv-fade-out pointer-events-none' : 'animate-lv-fade-in'
      } fixed inset-0 z-50 flex items-center justify-center sm:items-end sm:justify-start bg-black/65 p-2 pb-14 sm:pl-4`}
      onClick={onClose}
    >
      <div
        className={`${
          isClosing ? 'animate-lv-modal-out' : 'animate-lv-modal-in'
        } w-full max-w-2xl h-[calc(100dvh-64px)] sm:h-[min(560px,calc(100dvh-72px))] flex flex-col rounded-lg border border-[#141311]/30 dark:border-[#FFFFFF]/35 bg-[#FFFFFF] dark:bg-[#0F0F12] shadow-2xl overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Panel Header + Search */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#141311]/15 dark:border-[#FFFFFF]/15 shrink-0">
          <div className="flex items-center gap-2.5 flex-1">
            <h2 className="text-xs font-bold tracking-[0.18em] text-[#141311] dark:text-[#FFFFFF] whitespace-nowrap">
              DRAWING TOOLS
            </h2>
            <div className="relative flex-1 max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#625D52] dark:text-[#9A9892]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search drawing tools..."
                aria-label="Search drawing tools"
                className="w-full h-8 pl-8 pr-7 text-xs rounded-md border border-[#141311]/20 dark:border-[#FFFFFF]/25 bg-[#FBF9F4] dark:bg-[#17171B] text-[#141311] dark:text-[#F5F5F7] placeholder:text-[#625D52] dark:placeholder:text-[#7E7B74] focus:outline-none focus:border-[#141311] dark:focus:border-[#FFFFFF]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#625D52] dark:text-[#9A9892] hover:text-[#141311] dark:hover:text-[#FFFFFF] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Drawing Tools"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#625D52] dark:text-[#9A9892] hover:text-[#141311] dark:hover:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/10 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Two-Pane Body: Exact 9 Categories on Left + Tools List on Right */}
        <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
          {/* Exact 9 Categories Sidebar */}
          <nav
            aria-label="Drawing tool categories"
            className="sm:w-56 border-b sm:border-b-0 sm:border-r border-[#141311]/15 dark:border-[#FFFFFF]/15 bg-[#F9F7F1] dark:bg-[#0B0B0D] overflow-x-auto sm:overflow-y-auto shrink-0"
          >
            <div className="flex sm:flex-col p-1.5 gap-0.5">
              {DRAWING_CATEGORIES.map((cat) => {
                const selected = !search && activeCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setActiveCategory(cat.id);
                      setVisualSubPicker(null);
                    }}
                    className={`flex items-center justify-between gap-2 px-3 py-2.5 text-left text-[11px] font-bold tracking-[0.08em] rounded-md transition-colors whitespace-nowrap sm:whitespace-normal cursor-pointer shrink-0 ${
                      selected
                        ? 'bg-[#141311]/10 dark:bg-[#FFFFFF]/15 text-[#141311] dark:text-[#FFFFFF] border border-[#141311]/40 dark:border-[#FFFFFF]/45'
                        : 'text-[#4D4940] dark:text-[#A9A69E] hover:bg-[#141311]/8 dark:hover:bg-[#FFFFFF]/10 hover:text-[#141311] dark:hover:text-[#F5F5F7] border border-transparent'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {cat.id === 'FAVORITES' && (
                        <Star className="w-3.5 h-3.5 fill-[#141311] text-[#141311] dark:fill-[#FFFFFF] dark:text-[#FFFFFF] shrink-0" />
                      )}
                      {cat.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Tools Grid / List */}
          <div className="flex-1 overflow-y-auto p-3">
            {search && (
              <div className="mb-2 px-1 text-[11px] font-medium text-[#625D52] dark:text-[#9A9892]">
                {filteredTools.length} MATCHING TOOLS
              </div>
            )}

            {filteredTools.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-xs font-semibold text-[#625D52] dark:text-[#9A9892]">
                  NO DRAWING TOOLS MATCH YOUR SEARCH
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {filteredTools.map((tool) => {
                  const isFav = favoriteSet.has(tool.id);
                  const isActive = activeToolId === tool.id;

                  return (
                    <div
                      key={tool.id}
                      className={`group flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 transition-colors ${
                        isActive
                          ? 'border-[#141311] dark:border-[#FFFFFF] bg-[#141311]/10 dark:bg-[#FFFFFF]/15'
                          : 'border-transparent hover:border-[#141311]/25 dark:hover:border-[#FFFFFF]/30 hover:bg-[#F7F4EC] dark:hover:bg-[#17171C]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleToolClick(tool)}
                        className="flex flex-1 items-center gap-2.5 text-left min-w-0 cursor-pointer"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded border border-[#141311]/20 dark:border-[#FFFFFF]/25 bg-[#FBF9F4] dark:bg-[#141418] text-[#141311] dark:text-[#FFFFFF] shrink-0">
                          <ToolIcon toolId={tool.id} className="w-3.5 h-3.5" />
                        </span>
                        <span className="text-xs font-semibold tracking-wide text-[#141311] dark:text-[#F5F5F7] truncate">
                          {tool.name}
                        </span>
                      </button>

                      {/* Star favorite toggle */}
                      <button
                        type="button"
                        onClick={() => onToggleFavorite(tool.id)}
                        aria-label={isFav ? `Remove ${tool.name} from favorites` : `Add ${tool.name} to favorites`}
                        title={isFav ? 'REMOVE FROM FAVORITES' : 'ADD TO FAVORITES'}
                        className="flex h-7 w-7 items-center justify-center rounded hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/15 cursor-pointer shrink-0"
                      >
                        <Star
                          className={`w-3.5 h-3.5 transition-colors ${
                            isFav
                              ? 'fill-[#141311] text-[#141311] dark:fill-[#FFFFFF] dark:text-[#FFFFFF]'
                              : 'text-[#625D52]/45 dark:text-[#9A9892]/45 hover:text-[#141311] dark:hover:text-[#FFFFFF]'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Sub-picker when user selects EMOJIS, STICKERS, or ICONS under VISUALS */}
            {visualSubPicker && (
              <div className="mt-4 rounded-md border border-[#141311]/30 dark:border-[#FFFFFF]/35 bg-[#FBF9F4] dark:bg-[#151519] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-bold tracking-[0.14em] text-[#141311] dark:text-[#FFFFFF]">
                    SELECT {visualSubPicker} TO PLACE ON CHART
                  </span>
                  <button
                    type="button"
                    onClick={() => setVisualSubPicker(null)}
                    className="text-[#625D52] dark:text-[#9A9892] hover:text-[#141311] dark:hover:text-[#FFFFFF] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                  {visualItems.map((glyph) => (
                    <button
                      key={glyph}
                      type="button"
                      onClick={() => {
                        const toolId =
                          visualSubPicker === 'EMOJIS'
                            ? 'visual_emojis'
                            : visualSubPicker === 'STICKERS'
                              ? 'visual_stickers'
                              : 'visual_icons';
                        onSelectTool(toolId, glyph);
                        onClose();
                      }}
                      className={`h-10 flex items-center justify-center rounded border text-sm font-bold transition-colors cursor-pointer ${
                        selectedVisualGlyph === glyph
                          ? 'border-[#141311] dark:border-[#FFFFFF] bg-[#141311]/15 dark:bg-[#FFFFFF]/20 text-[#141311] dark:text-[#FFFFFF]'
                          : 'border-[#141311]/20 dark:border-[#FFFFFF]/20 bg-[#FFFFFF] dark:bg-[#0E0E11] text-[#141311] dark:text-[#FFFFFF] hover:border-[#141311] dark:hover:border-[#FFFFFF]'
                      }`}
                    >
                      {glyph}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Bar: SHOW FAVORITES ON CHART */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#141311]/15 dark:border-[#FFFFFF]/15 bg-[#F9F7F1] dark:bg-[#0B0B0D] shrink-0">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 fill-[#141311] text-[#141311] dark:fill-[#FFFFFF] dark:text-[#FFFFFF]" />
            <span className="text-xs font-bold tracking-[0.12em] text-[#141311] dark:text-[#F5F5F7]">
              SHOW FAVORITES ON CHART
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showFavoritesOnChart}
            onClick={onToggleShowFavoritesOnChart}
            data-testid="show-favorites-toggle"
            className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors cursor-pointer ${
              showFavoritesOnChart
                ? 'border-[#141311] dark:border-[#FFFFFF] bg-[#141311] dark:bg-[#FFFFFF]'
                : 'border-[#141311]/35 dark:border-[#FFFFFF]/35 bg-[#E6E2D6] dark:bg-[#1C1C21]'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                showFavoritesOnChart
                  ? 'translate-x-5 bg-[#FFFFFF] dark:bg-[#080808]'
                  : 'translate-x-1 bg-[#141311] dark:bg-[#FFFFFF]'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
});

DrawingToolsPanel.displayName = 'DrawingToolsPanel';
