import React from 'react';
import {
  ChevronDown,
  Crosshair,
  Download,
  Maximize2,
  Minimize2,
  Moon,
  MoreVertical,
  Pencil,
  Redo2,
  Sun,
  Undo2,
} from 'lucide-react';
import {
  ConnectionStatus,
  MarketSymbol,
  ThemeMode,
  TickerData,
  TimeframeId,
} from '../types/chart';
import { formatPrice, INTERVAL_BY_ID, MARKETS } from '../modules/timeframeManager';

interface TopToolbarProps {
  market: MarketSymbol;
  ticker?: TickerData;
  connectionStatus: ConnectionStatus;
  interval: TimeframeId;
  theme: ThemeMode;
  canUndo: boolean;
  canRedo: boolean;
  isFullScreen: boolean;
  isDrawingPanelOpen: boolean;
  isThreeDotsOpen: boolean;
  isFreeCrosshair: boolean;
  activeToolName?: string;
  onOpenMarketSelector: () => void;
  onOpenTimeframeMenu: () => void;
  onToggleDrawingPanel: () => void;
  onToggleThreeDots: () => void;
  onToggleFreeCrosshair: () => void;
  onUndo: () => void;
  onToggleTheme: () => void;
  onRedo: () => void;
  onToggleFullScreen: () => void;
  onDownloadImage: () => void;
}

export const TopToolbar: React.FC<TopToolbarProps> = React.memo(({
  market,
  ticker,
  connectionStatus,
  interval,
  theme,
  canUndo,
  canRedo,
  isFullScreen,
  isDrawingPanelOpen,
  isThreeDotsOpen,
  isFreeCrosshair,
  onOpenMarketSelector,
  onOpenTimeframeMenu,
  onToggleDrawingPanel,
  onToggleThreeDots,
  onToggleFreeCrosshair,
  onUndo,
  onToggleTheme,
  onRedo,
  onToggleFullScreen,
  onDownloadImage,
}) => {
  const meta = MARKETS[market];
  const price = ticker?.price;
  const changePct = ticker?.changePercent ?? 0;
  const isUp = changePct >= 0;
  const shortTf = INTERVAL_BY_ID[interval]?.shortLabel ?? interval;

  const btnBase =
    'flex items-center justify-center h-9 min-w-[36px] px-2 rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]';
  const btnNormal =
    'border-transparent hover:border-[#D4AF37]/40 bg-transparent hover:bg-[#D4AF37]/10 text-[#B08618] dark:text-[#D4AF37]';
  const btnActive =
    'border-[#D4AF37]/70 bg-[#D4AF37]/15 text-[#9A7210] dark:text-[#F1D378]';

  if (isFullScreen) {
    return null;
  }

  return (
    <footer
      aria-label="Bottom Navigation Bar"
      className="relative z-30 flex h-12 w-full items-center justify-between gap-1.5 border-t border-[#B48C20]/25 dark:border-[#D4AF37]/25 bg-[#FFFFFF] dark:bg-[#0D0D0F] px-2 sm:px-3 select-none shrink-0"
    >
      {/* Left Cluster: Brand + 1. Market Selector + 2. Timeframe + 3. Pencil + 4. Three Dots */}
      <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 overflow-x-auto no-scrollbar">
        {/* Compact Brand Mark on desktop */}
        <div className="hidden lg:flex items-center gap-2 pr-2.5 mr-1 border-r border-[#B48C20]/20 dark:border-[#D4AF37]/20 shrink-0">
          <img
            src="/assets/aistudio/file_000000001a488208b6099279793e33f1_d26a340a.png"
            alt="LEADERS VIEW"
            className="h-6 w-6 rounded-md object-cover border border-[#D4AF37]/35 shrink-0"
          />
          <span className="font-brand text-xs font-bold tracking-[0.18em] text-[#B08618] dark:text-[#D4AF37] whitespace-nowrap">
            LEADERS VIEW
          </span>
        </div>

        {/* 1. MARKET SELECTOR */}
        <button
          type="button"
          onClick={onOpenMarketSelector}
          aria-label="Select Market"
          data-testid="market-selector-btn"
          className="flex items-center gap-1.5 sm:gap-2 h-9 px-2 sm:px-2.5 rounded-md border border-[#B48C20]/30 dark:border-[#D4AF37]/30 bg-[#FBF9F4] dark:bg-[#141418] hover:border-[#D4AF37] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span className="text-xs sm:text-sm font-bold tracking-wide text-[#141311] dark:text-[#F5F5F7]">
            {market}
          </span>
          {price !== undefined && (
            <span className="font-mono-num text-xs sm:text-[13px] font-semibold text-[#141311] dark:text-[#F1D378]">
              {formatPrice(price, meta.decimals)}
            </span>
          )}
          {price !== undefined && (
            <span
              className={`hidden md:inline font-mono-num text-[11px] font-semibold ${
                isUp ? 'text-[#0F9D68] dark:text-[#19B87D]' : 'text-[#D63946] dark:text-[#E54855]'
              }`}
            >
              {isUp ? '+' : ''}
              {changePct.toFixed(2)}%
            </span>
          )}
          <span
            title={`Feed status: ${connectionStatus}`}
            className={`hidden sm:inline text-[9.5px] font-mono-num font-semibold tracking-wider ${
              connectionStatus === 'LIVE'
                ? 'text-[#0F9D68] dark:text-[#19B87D]'
                : connectionStatus === 'DELAYED'
                  ? 'text-[#C49214] dark:text-[#F1D378]'
                  : 'text-[#D63946] dark:text-[#E54855]'
            }`}
          >
            {connectionStatus}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-[#B08618] dark:text-[#D4AF37]" />
        </button>

        {/* 2. TIMEFRAME */}
        <button
          type="button"
          onClick={onOpenTimeframeMenu}
          aria-label="Select Timeframe"
          data-testid="timeframe-btn"
          className={`${btnBase} border-[#B48C20]/25 dark:border-[#D4AF37]/25 bg-[#FBF9F4] dark:bg-[#141418] hover:border-[#D4AF37] px-2.5 gap-1`}
        >
          <span className="font-mono-num text-xs font-bold text-[#141311] dark:text-[#F5F5F7]">
            {shortTf}
          </span>
          <ChevronDown className="w-3 h-3 text-[#B08618] dark:text-[#D4AF37]" />
        </button>

        {/* 3. DRAWING / PENCIL */}
        <button
          type="button"
          onClick={onToggleDrawingPanel}
          aria-label="Drawing Tools"
          title="DRAWING TOOLS"
          data-testid="drawing-tools-btn"
          className={`${btnBase} ${isDrawingPanelOpen ? btnActive : btnNormal}`}
        >
          <Pencil className="w-4 h-4" />
        </button>

        {/* 4. 24H FREE CROSSHAIR */}
        <button
          type="button"
          onClick={onToggleFreeCrosshair}
          aria-label="24H Free Crosshair"
          aria-pressed={isFreeCrosshair}
          title={isFreeCrosshair ? '24H FREE CROSSHAIR: ON' : '24H FREE CROSSHAIR'}
          data-testid="free-crosshair-btn"
          className={`${btnBase} ${isFreeCrosshair ? btnActive : btnNormal}`}
        >
          <Crosshair className="w-4 h-4" />
        </button>

        {/* 5. THREE DOTS MENU */}
        <button
          type="button"
          onClick={onToggleThreeDots}
          aria-label="More Tools Menu"
          title="INDICATORS, ALERT, BAR REPLAY"
          data-testid="three-dots-btn"
          className={`${btnBase} ${isThreeDotsOpen ? btnActive : btnNormal}`}
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>

      {/* Right Cluster: 5. UNDO | 6. DARK/LIGHT MODE (EXACTLY BETWEEN UNDO & REDO) | 7. REDO | 8. FULL SCREEN | 9. DOWNLOAD IMAGE */}
      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
        {/* 5. UNDO */}
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo"
          title="UNDO (CTRL+Z)"
          data-testid="undo-btn"
          className={`${btnBase} ${
            canUndo
              ? btnNormal
              : 'border-transparent text-[#625D52]/35 dark:text-[#9A9892]/30 cursor-not-allowed'
          }`}
        >
          <Undo2 className="w-4 h-4" />
        </button>

        {/* 6. DARK MODE / LIGHT MODE SWITCH — EXACTLY BETWEEN UNDO AND REDO */}
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          title={theme === 'dark' ? 'SWITCH TO LIGHT MODE' : 'SWITCH TO DARK MODE'}
          data-testid="theme-switch-btn"
          className={`${btnBase} border-[#B48C20]/35 dark:border-[#D4AF37]/35 bg-[#FBF9F4] dark:bg-[#151411] hover:border-[#D4AF37] text-[#B08618] dark:text-[#F1D378]`}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* 7. REDO */}
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo"
          title="REDO (CTRL+Y)"
          data-testid="redo-btn"
          className={`${btnBase} ${
            canRedo
              ? btnNormal
              : 'border-transparent text-[#625D52]/35 dark:text-[#9A9892]/30 cursor-not-allowed'
          }`}
        >
          <Redo2 className="w-4 h-4" />
        </button>

        <div className="mx-0.5 h-5 w-px bg-[#B48C20]/20 dark:bg-[#D4AF37]/20" aria-hidden="true" />

        {/* 8. FULL SCREEN */}
        <button
          type="button"
          onClick={onToggleFullScreen}
          aria-label="Full Screen"
          title="FULL SCREEN"
          data-testid="fullscreen-btn"
          className={`${btnBase} ${btnNormal}`}
        >
          {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>

        {/* 9. DOWNLOAD CHART IMAGE */}
        <button
          type="button"
          onClick={onDownloadImage}
          aria-label="Download Chart Image"
          title="DOWNLOAD CHART IMAGE"
          data-testid="download-image-btn"
          className={`${btnBase} ${btnNormal}`}
        >
          <Download className="w-4 h-4" />
        </button>
      </div>
    </footer>
  );
});

TopToolbar.displayName = 'TopToolbar';
