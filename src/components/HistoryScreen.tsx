import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpDown,
  Calendar,
  Check,
  Download,
  Share2,
  X,
} from 'lucide-react';
import {
  CalendarFilterState,
  CalendarPreset,
  HistorySortOption,
  TradingAccountState,
} from '../types/trading';
import {
  filterAndSortPositions,
  resolveCalendarRange,
} from '../modules/tradingEngine';
import {
  GeneratedHistoryJpgPage,
  generateHistoryJpgPages,
  shareHistoryJpgs,
  triggerJpgDownloads,
} from '../modules/historyExport';
import { formatPrice, MARKETS } from '../modules/timeframeManager';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

interface HistoryScreenProps {
  open: boolean;
  account: TradingAccountState;
  onClose: () => void;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function getLocalTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDateCol(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatTimeCol(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function formatUSD(val: number, signed = false): string {
  const abs = Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (val < 0) return `-$${abs}`;
  if (signed && val > 0) return `+$${abs}`;
  return `$${abs}`;
}

const SORT_LABELS: Array<{ id: HistorySortOption; label: string }> = [
  { id: 'NEWEST', label: 'Newest First' },
  { id: 'OLDEST', label: 'Oldest First' },
  { id: 'HIGHEST_PROFIT', label: 'Highest Profit First' },
  { id: 'LOWEST_PROFIT', label: 'Lowest Profit First' },
];

const CALENDAR_PRESETS: Array<{ id: CalendarPreset; label: string }> = [
  { id: 'TODAY', label: 'Today' },
  { id: 'YESTERDAY', label: 'Yesterday' },
  { id: 'LAST_WEEK', label: 'Last Week' },
  { id: 'LAST_MONTH', label: 'Last Month' },
  { id: 'LAST_3_MONTHS', label: 'Last 3 Months' },
  { id: 'CUSTOM', label: 'Custom Period' },
];

export const HistoryScreen: React.FC<HistoryScreenProps> = React.memo(({ open, account, onClose }) => {
  const { shouldRender, isClosing } = useAnimatedPresence(open, 165);
  const [sortOption, setSortOption] = useState<HistorySortOption>('NEWEST');

  const todayStr = getLocalTodayString();
  const [calendarFilter, setCalendarFilter] = useState<CalendarFilterState>({
    preset: 'TODAY',
    customStartDate: todayStr,
    customEndDate: todayStr,
  });

  const [isSortOpen, setIsSortOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [draftCustomStart, setDraftCustomStart] = useState(todayStr);
  const [draftCustomEnd, setDraftCustomEnd] = useState(todayStr);

  // Generated JPG report preview / share banner
  const [isExporting, setIsExporting] = useState(false);
  const [lastExportPages, setLastExportPages] = useState<GeneratedHistoryJpgPage[] | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!shouldRender) {
      setIsSortOpen(false);
      setIsCalendarOpen(false);
      setExportNotice(null);
    }
  }, [shouldRender]);

  const sortAnim = useAnimatedPresence(isSortOpen, 145);
  const calendarAnim = useAnimatedPresence(isCalendarOpen, 155);

  const dateRange = useMemo(
    () => (shouldRender ? resolveCalendarRange(calendarFilter) : { startMs: 0, endMs: 0, label: 'Today' }),
    [shouldRender, calendarFilter]
  );

  const filteredPositions = useMemo(
    () => (shouldRender ? filterAndSortPositions(account.positionHistory, 'ALL', dateRange, sortOption) : []),
    [shouldRender, account.positionHistory, dateRange, sortOption]
  );

  if (!shouldRender) return null;

  const positionTotalProfit = filteredPositions.reduce((s, p) => s + p.profitLoss, 0);

  const handleSelectPreset = (preset: CalendarPreset) => {
    if (preset === 'CUSTOM') {
      setDraftCustomStart(calendarFilter.customStartDate || todayStr);
      setDraftCustomEnd(calendarFilter.customEndDate || todayStr);
      setCalendarFilter((prev) => ({ ...prev, preset: 'CUSTOM' }));
      return;
    }
    setCalendarFilter((prev) => ({ ...prev, preset }));
    setIsCalendarOpen(false);
  };

  const handleApplyCustomDates = () => {
    if (!draftCustomStart || !draftCustomEnd) return;
    setCalendarFilter({
      preset: 'CUSTOM',
      customStartDate: draftCustomStart,
      customEndDate: draftCustomEnd,
    });
    setIsCalendarOpen(false);
  };

  const handleDownloadJpg = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportNotice(null);
    try {
      const pages = await generateHistoryJpgPages({
        activeTab: 'POSITION',
        dateRangeLabel: dateRange.label,
        symbolFilter: 'ALL',
        balanceUSD: account.balanceUSD,
        positions: filteredPositions,
        orders: [],
        deals: [],
      });
      if (pages.length > 0) {
        triggerJpgDownloads(pages);
        setLastExportPages(pages);
        setExportNotice(
          `Position History exported (${pages.length} JPG file${pages.length > 1 ? 's' : ''}).`
        );
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleShareJpg = async () => {
    if (!lastExportPages || lastExportPages.length === 0) return;
    const outcome = await shareHistoryJpgs(
      lastExportPages,
      'Leaders View — Position History'
    );
    if (outcome === 'fallback_downloaded') {
      setExportNotice('JPG saved to your device downloads.');
    }
  };

  return (
    <div
      role="dialog"
      aria-label="History Screen"
      data-testid="history-screen"
      className={`${
        isClosing ? 'animate-lv-screen-out pointer-events-none' : 'animate-lv-screen-in'
      } fixed inset-0 z-40 flex flex-col bg-[#050507] text-white`}
    >
      {/* Click-outside backdrop for Sort Popover (sits below header z-50 so toolbar icons toggle/switch cleanly) */}
      {sortAnim.shouldRender && (
        <div
          className={`fixed inset-0 z-40 ${sortAnim.isClosing ? 'pointer-events-none' : ''}`}
          onClick={() => setIsSortOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Top MetaTrader History Toolbar (White Icons, Zero Chart Displayed) */}
      <header className="relative z-50 flex h-13 shrink-0 items-center justify-between border-b border-neutral-800 bg-[#0B0B0F] px-2 sm:px-4">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to Chart"
            data-testid="history-back-btn"
            className="flex h-10 w-10 items-center justify-center rounded-md text-white hover:bg-white/10 active:scale-95 transition-transform cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold text-white">History</h1>
            <div className="truncate text-[10px] font-medium text-neutral-400">
              {dateRange.label}
            </div>
          </div>
        </div>

        {/* Right Toolbar: Sort Up/Down | Calendar | Download JPG */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* 1. Sort Up/Down Icon */}
          <button
            type="button"
            onClick={() => {
              setIsSortOpen((v) => !v);
              setIsCalendarOpen(false);
            }}
            aria-label="Sort History"
            title="Sort History"
            data-testid="history-sort-btn"
            className="flex h-10 w-10 items-center justify-center rounded-md text-white hover:bg-white/10 cursor-pointer"
          >
            <ArrowUpDown className="w-[18px] h-[18px]" />
          </button>

          {/* 2. Calendar Icon (Golden when selected) */}
          <button
            type="button"
            onClick={() => {
              setIsCalendarOpen((v) => !v);
              setIsSortOpen(false);
            }}
            aria-label="Calendar Filter"
            title="Calendar"
            data-testid="history-calendar-btn"
            className={`flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10 cursor-pointer ${
              isCalendarOpen ? 'text-[#D4AF37]' : 'text-white'
            }`}
          >
            <Calendar className="w-[18px] h-[18px]" />
          </button>

          {/* 3. Download JPG Button (directly beside Calendar) */}
          <button
            type="button"
            onClick={handleDownloadJpg}
            disabled={isExporting}
            aria-label="Download Position History JPG"
            title="Download Position History as JPG"
            data-testid="history-download-jpg-btn"
            className="flex h-10 w-10 items-center justify-center rounded-md text-white hover:bg-white/10 disabled:opacity-50 cursor-pointer"
          >
            <Download className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* Sort Popover */}
        {sortAnim.shouldRender && (
          <div
            data-testid="history-sort-menu"
            className={`${
              sortAnim.isClosing ? 'animate-lv-panel-out pointer-events-none' : 'animate-lv-panel-in'
            } absolute right-2 top-13 z-50 w-52 rounded-xl border border-neutral-700 bg-[#101015] p-1.5 shadow-2xl`}
          >
            {SORT_LABELS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setSortOption(opt.id);
                  setIsSortOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-xs font-semibold cursor-pointer ${
                  sortOption === opt.id
                    ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                    : 'text-white hover:bg-white/5'
                }`}
              >
                <span>{opt.label}</span>
                {sortOption === opt.id && <Check className="w-3.5 h-3.5" />}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Golden Position Header Bar (Orders & Deals removed) */}
      <div className="flex h-11 shrink-0 items-center justify-center border-b border-neutral-800 bg-[#0B0B0F]">
        <span
          data-testid="history-tab-POSITION"
          className="relative flex h-full items-center px-6 text-xs font-bold tracking-wider uppercase text-[#D4AF37]"
        >
          Position
          <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[#D4AF37]" />
        </span>
      </div>

      {/* Export Status / Quick Share Banner */}
      {exportNotice && (
        <div
          data-testid="history-export-banner"
          className="flex shrink-0 items-center justify-between gap-2 border-b border-[#D4AF37]/30 bg-[#12100B] px-3 py-2 text-xs"
        >
          <span className="text-[#D4AF37] font-medium">{exportNotice}</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleShareJpg}
              data-testid="history-share-jpg-btn"
              className="flex h-8 items-center gap-1 rounded-md border border-[#D4AF37]/60 bg-[#D4AF37]/15 px-2.5 text-[11px] font-bold text-[#D4AF37] cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5" />
              Share JPG
            </button>
            <button
              type="button"
              onClick={() => setExportNotice(null)}
              aria-label="Dismiss export notice"
              className="p-1 text-neutral-400 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Position Summary + Records */}
      <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-5">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
          {/* Top Summary Card: Profit & Balance ONLY */}
          <div
            data-testid="history-summary-position"
            className="flex items-center justify-between rounded-xl border border-neutral-800 bg-[#0D0D11] px-4 py-3"
          >
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Profit
              </div>
              <div
                className={`mt-0.5 font-mono-num text-lg font-bold ${
                  positionTotalProfit >= 0 ? 'text-[#19B87D]' : 'text-[#E54855]'
                }`}
              >
                {formatUSD(positionTotalProfit, true)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Balance (USD)
              </div>
              <div className="mt-0.5 font-mono-num text-lg font-bold text-white">
                {formatUSD(account.balanceUSD)}
              </div>
            </div>
          </div>

          {/* Position Records List */}
          <div className="rounded-xl border border-neutral-800 bg-[#0D0D11] divide-y divide-neutral-800">
            {filteredPositions.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-neutral-500">
                No closed positions for {dateRange.label}.
              </div>
            ) : (
              filteredPositions.map((p) => {
                const dec = MARKETS[p.symbol].decimals;
                const isWin = p.profitLoss >= 0;
                return (
                  <div
                    key={p.id}
                    data-testid={`hist-pos-${p.id}`}
                    className="flex items-center justify-between gap-2 px-3.5 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-white">{p.symbol}</span>
                        <span
                          className={`text-xs font-bold ${
                            p.direction === 'BUY' ? 'text-[#22C55E]' : 'text-[#F43F5E]'
                          }`}
                        >
                          {p.direction.toLowerCase()} {p.lotSize.toFixed(2)}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono-num text-xs text-neutral-300">
                        {formatPrice(p.entryPrice, dec)} → {formatPrice(p.exitPrice, dec)}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div
                        className={`font-mono-num text-sm font-bold ${
                          isWin ? 'text-[#19B87D]' : 'text-[#E54855]'
                        }`}
                      >
                        {formatUSD(p.profitLoss, true)}
                      </div>
                      <div className="mt-0.5 font-mono-num text-[11px] text-neutral-500">
                        {formatDateCol(p.closedAt)} · {formatTimeCol(p.closedAt)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Calendar Filter Modal */}
      {calendarAnim.shouldRender && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsCalendarOpen(false);
          }}
          className={`${
            calendarAnim.isClosing ? 'animate-lv-fade-out pointer-events-none' : 'animate-lv-fade-in'
          } fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 sm:items-center`}
        >
          <div
            data-testid="history-calendar-modal"
            className={`${
              calendarAnim.isClosing ? 'animate-lv-modal-out' : 'animate-lv-modal-in'
            } w-full max-w-md rounded-2xl border border-neutral-700 bg-[#0E0E12] p-4 shadow-2xl`}
          >
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <span className="text-sm font-bold text-[#D4AF37]">Calendar Period</span>
              <button
                type="button"
                onClick={() => setIsCalendarOpen(false)}
                aria-label="Close calendar"
                className="flex h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10 active:scale-95 transition-transform cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {CALENDAR_PRESETS.map((p) => {
                const selected = calendarFilter.preset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPreset(p.id)}
                    data-testid={`calendar-preset-${p.id}`}
                    className={`h-11 rounded-lg border px-3 text-xs font-bold transition-colors cursor-pointer ${
                      selected
                        ? 'border-[#D4AF37] bg-[#D4AF37]/15 text-[#D4AF37]'
                        : 'border-neutral-800 bg-[#141419] text-white hover:border-neutral-600'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {calendarFilter.preset === 'CUSTOM' && (
              <div className="mt-3 rounded-xl border border-neutral-800 bg-[#08080A] p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-neutral-400">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={draftCustomStart}
                      onChange={(e) => setDraftCustomStart(e.target.value)}
                      data-testid="calendar-custom-start"
                      className="h-10 w-full rounded-lg border border-neutral-700 bg-[#141419] px-2.5 text-xs text-white focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-neutral-400">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={draftCustomEnd}
                      onChange={(e) => setDraftCustomEnd(e.target.value)}
                      data-testid="calendar-custom-end"
                      className="h-10 w-full rounded-lg border border-neutral-700 bg-[#141419] px-2.5 text-xs text-white focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCalendarOpen(false)}
                    data-testid="calendar-custom-cancel"
                    className="h-10 flex-1 rounded-lg border border-neutral-700 bg-[#141419] text-xs font-bold text-white active:scale-95 transition-transform cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyCustomDates}
                    data-testid="calendar-custom-apply"
                    className="h-10 flex-1 rounded-lg bg-[#D4AF37] text-xs font-bold text-black hover:bg-[#E5C158] active:scale-95 transition-transform cursor-pointer"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

HistoryScreen.displayName = 'HistoryScreen';
