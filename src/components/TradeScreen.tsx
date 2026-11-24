import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlarmClock,
  ArrowLeft,
  ChevronRight,
  History,
  Minus,
  Plus,
  Wallet,
  X,
} from 'lucide-react';
import { MarketSymbol } from '../types/chart';
import {
  BulkCloseFilter,
  MarketBidAskQuote,
  OpenPosition,
  TradeDirection,
  TradingAccountState,
  TradingScreen,
} from '../types/trading';
import {
  computeUnrealizedPnL,
  formatSpreadPoints,
  INSTRUMENT_SPREAD_CONFIG,
  roundUSD,
} from '../modules/spreadEngine';
import {
  computeAvailableTradeBalanceUSD,
  computeMaxAffordableLot,
  computeRequiredMarginUSD,
  DEMO_ACCOUNT_LEVERAGE,
  evaluatePoorAccountBalance,
} from '../modules/tradingEngine';
import { formatPrice, MARKETS } from '../modules/timeframeManager';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

interface TradeScreenProps {
  open: boolean;
  account: TradingAccountState;
  selectedMarket: MarketSymbol;
  quotes: Partial<Record<MarketSymbol, MarketBidAskQuote | null>>;
  onToggleActiveBuySell: (enabled: boolean) => void;
  onExecuteOrder: (params: {
    symbol: MarketSymbol;
    direction: TradeDirection;
    lotSize: number;
    sl: number | null;
    tp: number | null;
  }) => { ok: boolean; error?: string };
  onClosePosition: (positionId: string) => { ok: boolean; error?: string };
  onCloseBulkPositions: (filter: BulkCloseFilter) => {
    ok: boolean;
    closedCount?: number;
    error?: string;
  };
  onModifyPositionSlTp: (params: {
    positionId: string;
    sl: number | null;
    tp: number | null;
  }) => { ok: boolean; error?: string };
  onSetBalance: (amount: number) => void;
  onSwitchScreen: (screen: TradingScreen) => void;
  onClose: () => void;
  openSetBalanceNonce?: number;
}

function formatUSD(value: number, signed = false): string {
  const abs = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (value < 0) return `-$${abs}`;
  if (signed && value > 0) return `+$${abs}`;
  return `$${abs}`;
}

function parseOptionalPrice(raw: string): { valid: boolean; value: number | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return { valid: false, value: null };
  return { valid: true, value: n };
}

export const TradeScreen: React.FC<TradeScreenProps> = React.memo(({
  open,
  account,
  selectedMarket,
  quotes,
  onToggleActiveBuySell,
  onExecuteOrder,
  onClosePosition,
  onCloseBulkPositions,
  onModifyPositionSlTp,
  onSetBalance,
  onSwitchScreen,
  onClose,
  openSetBalanceNonce = 0,
}) => {
  const { shouldRender, isClosing } = useAnimatedPresence(open, 165);

  const [lotInput, setLotInput] = useState('0.10');
  const [slInput, setSlInput] = useState('');
  const [tpInput, setTpInput] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  // Set Unlimited Demo Balance state
  const [isEditingBalance, setIsEditingBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState('');

  // Expanded quick-action position ID (tapping position or price area opens Quick Action Panel)
  const [expandedPosId, setExpandedPosId] = useState<string | null>(null);
  const [quickSlMap, setQuickSlMap] = useState<Record<string, string>>({});
  const [quickTpMap, setQuickTpMap] = useState<Record<string, string>>({});

  // Full Modify Position Panel (opened via Modify arrow)
  const [modifyPosId, setModifyPosId] = useState<string | null>(null);
  const [modifySlInput, setModifySlInput] = useState('');
  const [modifyTpInput, setModifyTpInput] = useState('');
  const [modifyFeedback, setModifyFeedback] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  const activeQuote = quotes[selectedMarket] ?? null;
  const cfg = INSTRUMENT_SPREAD_CONFIG[selectedMarket];

  useEffect(() => {
    setFeedback(null);
  }, [selectedMarket, open]);

  useEffect(() => {
    if (!shouldRender) {
      setIsEditingBalance(false);
      setExpandedPosId(null);
      setModifyPosId(null);
      setModifyFeedback(null);
    }
  }, [shouldRender]);

  useEffect(() => {
    if (open && openSetBalanceNonce > 0) {
      setIsEditingBalance(true);
      setBalanceInput(account.balanceUSD > 0 ? String(account.balanceUSD) : '');
    }
  }, [open, openSetBalanceNonce]);

  const modifyTargetPosition = useMemo(
    () => account.openPositions.find((p) => p.id === modifyPosId) ?? null,
    [account.openPositions, modifyPosId]
  );

  const lastModifyPosRef = useRef<OpenPosition | null>(modifyTargetPosition);
  if (modifyTargetPosition) {
    lastModifyPosRef.current = modifyTargetPosition;
  }
  const modifyModalAnim = useAnimatedPresence(Boolean(modifyPosId && modifyTargetPosition), 155);
  const activeModifyPosition = modifyTargetPosition ?? lastModifyPosRef.current;

  const liveSummary = useMemo(() => {
    if (!shouldRender) {
      return { totalProfit: 0, totalLoss: 0, netPnL: 0 };
    }
    let totalProfit = 0;
    let totalLoss = 0;
    let netPnL = 0;
    for (const pos of account.openPositions) {
      const { pnl } = computeUnrealizedPnL(pos, quotes[pos.symbol] ?? null);
      if (pnl > 0) totalProfit += pnl;
      else if (pnl < 0) totalLoss += pnl;
      netPnL += pnl;
    }
    return {
      totalProfit: roundUSD(totalProfit),
      totalLoss: roundUSD(totalLoss),
      netPnL: roundUSD(netPnL),
    };
  }, [shouldRender, account.openPositions, quotes]);

  const availableTradeBalance = useMemo(
    () => (shouldRender ? computeAvailableTradeBalanceUSD(account, quotes) : 0),
    [shouldRender, account, quotes]
  );

  const maxAffordableLot = useMemo(() => {
    if (!shouldRender || !activeQuote) return 0;
    return computeMaxAffordableLot(selectedMarket, availableTradeBalance, activeQuote.ask);
  }, [shouldRender, selectedMarket, availableTradeBalance, activeQuote]);

  const poorStatus = useMemo(
    () =>
      shouldRender
        ? evaluatePoorAccountBalance(account, selectedMarket, quotes)
        : {
            isPoor: false,
            reason: null,
            minLotRequiredUSD: 0,
            maxLot: 0,
            equityUSD: account.balanceUSD,
            freeMarginUSD: account.balanceUSD,
          },
    [shouldRender, account, selectedMarket, quotes]
  );

  const estimatedMarginUSD = useMemo(() => {
    if (!shouldRender || !activeQuote) return 0;
    const lot = Number(lotInput);
    if (!Number.isFinite(lot) || lot <= 0) return 0;
    return computeRequiredMarginUSD(selectedMarket, lot, activeQuote.ask);
  }, [shouldRender, activeQuote, lotInput, selectedMarket]);

  if (!shouldRender) return null;

  const openQuickPanel = (pos: OpenPosition) => {
    const decimals = MARKETS[pos.symbol].decimals;
    setExpandedPosId((cur) => (cur === pos.id ? null : pos.id));
    setQuickSlMap((prev) => ({
      ...prev,
      [pos.id]: pos.sl !== null ? pos.sl.toFixed(decimals) : '',
    }));
    setQuickTpMap((prev) => ({
      ...prev,
      [pos.id]: pos.tp !== null ? pos.tp.toFixed(decimals) : '',
    }));
  };

  const openModifyPanel = (pos: OpenPosition, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const decimals = MARKETS[pos.symbol].decimals;
    setModifyPosId(pos.id);
    setModifySlInput(pos.sl !== null ? pos.sl.toFixed(decimals) : '');
    setModifyTpInput(pos.tp !== null ? pos.tp.toFixed(decimals) : '');
    setModifyFeedback(null);
  };

  const adjustLot = (delta: number) => {
    const cur = Number(lotInput);
    const base = Number.isFinite(cur) && cur > 0 ? cur : 0.01;
    let candidate = Math.round((base + delta) * 100) / 100;
    if (delta > 0 && maxAffordableLot >= 0.01) {
      candidate = Math.min(maxAffordableLot, candidate);
    }
    const next = Math.min(1000, Math.max(0.01, candidate));
    setLotInput(next.toFixed(2));
  };

  const handleApplyBalance = (e: React.FormEvent) => {
    e.preventDefault();
    const val = Number(balanceInput);
    if (!Number.isFinite(val) || val <= 0) {
      setFeedback({ kind: 'error', text: 'Enter a valid USD amount greater than 0.' });
      return;
    }
    onSetBalance(val);
    setIsEditingBalance(false);
    setBalanceInput('');
    setFeedback({
      kind: 'ok',
      text: `Demo Balance set to ${formatUSD(val)} USD.`,
    });
  };

  const handleOrder = (direction: TradeDirection) => {
    setFeedback(null);
    const lot = Number(lotInput);
    const slParsed = parseOptionalPrice(slInput);
    const tpParsed = parseOptionalPrice(tpInput);
    if (!slParsed.valid) {
      setFeedback({ kind: 'error', text: 'Invalid Stop Loss price.' });
      return;
    }
    if (!tpParsed.valid) {
      setFeedback({ kind: 'error', text: 'Invalid Take Profit price.' });
      return;
    }

    const res = onExecuteOrder({
      symbol: selectedMarket,
      direction,
      lotSize: lot,
      sl: slParsed.value,
      tp: tpParsed.value,
    });
    if (!res.ok) {
      setFeedback({ kind: 'error', text: res.error || 'Order rejected.' });
      return;
    }
    setFeedback({
      kind: 'ok',
      text: `${selectedMarket} ${direction} ${lot.toFixed(2)} lot executed (Demo).`,
    });
  };

  const handleSaveQuickSlTp = (pos: OpenPosition) => {
    const slParsed = parseOptionalPrice(quickSlMap[pos.id] ?? '');
    const tpParsed = parseOptionalPrice(quickTpMap[pos.id] ?? '');
    if (!slParsed.valid || !tpParsed.valid) {
      setFeedback({ kind: 'error', text: 'Enter valid numeric SL / TP values or leave blank.' });
      return;
    }
    const res = onModifyPositionSlTp({
      positionId: pos.id,
      sl: slParsed.value,
      tp: tpParsed.value,
    });
    if (!res.ok) {
      setFeedback({ kind: 'error', text: res.error || 'Unable to update SL/TP.' });
      return;
    }
    setFeedback({ kind: 'ok', text: `${pos.symbol} SL/TP updated.` });
  };

  const handleSaveModifyModal = () => {
    if (!modifyTargetPosition) return;
    setModifyFeedback(null);
    const slParsed = parseOptionalPrice(modifySlInput);
    const tpParsed = parseOptionalPrice(modifyTpInput);
    if (!slParsed.valid || !tpParsed.valid) {
      setModifyFeedback({ kind: 'error', text: 'Enter valid numeric SL / TP prices or leave blank.' });
      return;
    }
    const res = onModifyPositionSlTp({
      positionId: modifyTargetPosition.id,
      sl: slParsed.value,
      tp: tpParsed.value,
    });
    if (!res.ok) {
      setModifyFeedback({ kind: 'error', text: res.error || 'Unable to modify position.' });
      return;
    }
    setModifyPosId(null);
    setModifyFeedback(null);
    setFeedback({ kind: 'ok', text: `${modifyTargetPosition.symbol} position modified.` });
  };

  const handleCloseSinglePosition = (pos: OpenPosition) => {
    setFeedback(null);
    const res = onClosePosition(pos.id);
    if (!res.ok) {
      setFeedback({ kind: 'error', text: res.error || 'Unable to close position.' });
      return;
    }
    setExpandedPosId((cur) => (cur === pos.id ? null : cur));
    setFeedback({
      kind: 'ok',
      text: `Closed ${pos.symbol} ${pos.direction} ${pos.lotSize.toFixed(2)} lot.`,
    });
  };

  const handleBulkClose = (filter: BulkCloseFilter) => {
    setFeedback(null);
    const res = onCloseBulkPositions(filter);
    if (!res.ok) {
      setFeedback({ kind: 'error', text: res.error || 'No matching positions to close.' });
      return;
    }
    setExpandedPosId(null);
    setFeedback({
      kind: 'ok',
      text: `Closed ${res.closedCount ?? 0} position${res.closedCount === 1 ? '' : 's'}.`,
    });
  };

  return (
    <div
      role="dialog"
      aria-label="Trade Screen"
      data-testid="trade-screen"
      className={`${
        isClosing ? 'animate-lv-screen-out pointer-events-none' : 'animate-lv-screen-in'
      } fixed inset-0 z-40 flex flex-col bg-[#050507] text-white`}
    >
      {/* Top MetaTrader-style Header */}
      <header className="flex h-13 shrink-0 items-center justify-between border-b border-neutral-800 bg-[#0B0B0F] px-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to Chart"
            data-testid="trade-back-btn"
            className="flex h-10 w-10 items-center justify-center rounded-md text-white hover:bg-white/10 active:scale-95 transition-transform cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-base font-bold tracking-wide text-[#D4AF37]">Trade</span>
          <span className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-neutral-300">
            {selectedMarket} · DEMO
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onSwitchScreen('PENDING')}
            aria-label="Open Pending Orders"
            title="Pending Orders"
            className="flex h-10 w-10 items-center justify-center rounded-md text-white hover:bg-white/10 active:scale-95 transition-transform cursor-pointer"
          >
            <AlarmClock className="w-[19px] h-[19px]" />
          </button>
          <button
            type="button"
            onClick={() => onSwitchScreen('HISTORY')}
            aria-label="Open History"
            title="History"
            className="flex h-10 w-10 items-center justify-center rounded-md text-white hover:bg-white/10 active:scale-95 transition-transform cursor-pointer"
          >
            <History className="w-[19px] h-[19px]" />
          </button>
        </div>
      </header>

      {poorStatus.isPoor && (
        <div
          data-testid="trade-poor-balance-banner"
          className="animate-lv-panel-in flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#E54855]/75 bg-[#2A0B10] px-3 py-2 text-xs shadow-lg"
        >
          <span className="font-bold tracking-wide text-[#FCA5A5]">
            POOR ACCOUNT BALANCE LEVEL SET BALANCE TO CONTINUE
          </span>
          <button
            type="button"
            onClick={() => {
              setIsEditingBalance(true);
              setBalanceInput('');
            }}
            className="rounded-md bg-[#D4AF37] px-2.5 py-1 text-[11px] font-bold text-black hover:bg-[#E5C158] active:scale-95 transition-transform cursor-pointer"
          >
            Set Balance
          </button>
        </div>
      )}

      {/* Scrollable Body */}
      <div className="lv-scroll-smooth flex-1 overflow-y-auto px-3 py-3 sm:px-5">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
          {/* Top Account Balance Row — USD ONLY + Unlimited Set Balance + Active BUY/SELL */}
          <section className="rounded-xl border border-neutral-800 bg-[#0D0D11] p-3.5">
            <div className="flex items-start justify-between gap-2 border-b border-neutral-800 pb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
                    Balance (USD)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingBalance((v) => !v);
                      setBalanceInput(String(account.balanceUSD));
                    }}
                    data-testid="set-balance-open-btn"
                    className="flex items-center gap-1 rounded-md border border-[#D4AF37]/50 bg-[#D4AF37]/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-[#D4AF37] hover:bg-[#D4AF37]/20 cursor-pointer"
                  >
                    <Wallet className="w-3 h-3" />
                    Set Balance
                  </button>
                </div>
                <div
                  data-testid="trade-balance-usd"
                  className="mt-0.5 font-mono-num text-2xl font-bold text-white"
                >
                  {formatUSD(account.balanceUSD)}{' '}
                  <span className="text-xs font-semibold text-neutral-400">USD</span>
                </div>
              </div>

              {/* Animated Active BUY/SELL Master Switch */}
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-neutral-300">
                  <span
                    className={`h-2 w-2 rounded-full transition-colors duration-200 ${
                      account.activeBuySell ? 'bg-[#19B87D] shadow-[0_0_8px_#19B87D]' : 'bg-neutral-600'
                    }`}
                  />
                  Active BUY/SELL
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={account.activeBuySell}
                  data-testid="active-buysell-toggle"
                  onClick={() => onToggleActiveBuySell(!account.activeBuySell)}
                  className={`relative flex h-9 w-[86px] items-center rounded-full border transition-colors duration-200 active:scale-95 cursor-pointer ${
                    account.activeBuySell
                      ? 'border-[#19B87D] bg-[#19B87D]/20 text-[#19B87D]'
                      : 'border-neutral-700 bg-neutral-900 text-neutral-400'
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 h-6.5 w-6.5 rounded-full shadow-md transition-transform duration-200 ease-out will-change-transform ${
                      account.activeBuySell
                        ? 'translate-x-[50px] bg-[#19B87D]'
                        : 'translate-x-0 bg-neutral-500'
                    }`}
                  />
                  <span
                    className={`w-full px-2.5 text-[11px] font-bold transition-all duration-200 ${
                      account.activeBuySell ? 'text-left' : 'text-right'
                    }`}
                  >
                    {account.activeBuySell ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>
            </div>

            {/* Unlimited Set Balance Form */}
            {isEditingBalance && (
              <form
                onSubmit={handleApplyBalance}
                data-testid="set-balance-form"
                className="animate-lv-panel-in mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#D4AF37]/40 bg-[#08080B] p-2.5"
              >
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0.01"
                  placeholder="Enter any USD balance (unlimited)"
                  value={balanceInput}
                  onChange={(e) => setBalanceInput(e.target.value)}
                  data-testid="set-balance-input"
                  className="h-10 min-w-[170px] flex-1 rounded-md border border-neutral-700 bg-[#141419] px-3 font-mono-num text-sm font-semibold text-white placeholder:text-neutral-500 focus:border-[#D4AF37] focus:outline-none"
                />
                <button
                  type="submit"
                  data-testid="set-balance-save-btn"
                  className="h-10 rounded-md bg-[#D4AF37] px-4 text-xs font-bold text-black hover:bg-[#E5C158] cursor-pointer"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingBalance(false)}
                  className="h-10 rounded-md border border-neutral-700 bg-[#141419] px-3 text-xs font-semibold text-neutral-300 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
              </form>
            )}

            {/* Market Order Panel (Hidden/Disabled when Active BUY/SELL is OFF) */}
            {!account.activeBuySell ? (
              <div
                data-testid="trading-controls-disabled-banner"
                className="animate-lv-panel-in mt-3 rounded-lg border border-neutral-800 bg-[#08080A] px-3 py-4 text-center"
              >
                <div className="text-xs font-semibold text-neutral-300">
                  Trading controls are turned OFF
                </div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  Turn Active BUY/SELL ON to enable chart one-click Buy/Sell &amp; order execution.
                </div>
              </div>
            ) : (
              <div className="animate-lv-panel-in mt-3 flex flex-col gap-3" data-testid="trading-controls-panel">
                {/* Active Chart Symbol Bid / Ask / Spread Info (no duplicate symbol picker) */}
                <div className="rounded-lg border border-neutral-800 bg-[#08080B] px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-semibold tracking-wider text-neutral-400">
                    <span>
                      <strong className="text-white">{selectedMarket}</strong> ·{' '}
                      {activeQuote?.spreadLabel ?? 'WAITING FOR MARKET FEED'}
                    </span>
                    {activeQuote && (
                      <span className="font-mono-num text-[#D4AF37]">
                        SPREAD {formatPrice(activeQuote.spread, cfg.decimals)} (
                        {formatSpreadPoints(activeQuote.spread, selectedMarket)} pts)
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between font-mono-num">
                    <div>
                      <span className="mr-1 text-[10px] text-[#F43F5E]">SELL/BID</span>
                      <span data-testid="trade-bid-price" className="text-base font-bold text-white">
                        {activeQuote ? formatPrice(activeQuote.bid, cfg.decimals) : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="mr-1 text-[10px] text-[#22C55E]">BUY/ASK</span>
                      <span data-testid="trade-ask-price" className="text-base font-bold text-white">
                        {activeQuote ? formatPrice(activeQuote.ask, cfg.decimals) : '—'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Lot Size Input (0.01 to 1000 precise manual input) + SL & TP */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-1">
                      <label
                        htmlFor="trade-lot-input"
                        className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400"
                      >
                        Lot (0.01 – 1000)
                      </label>
                      <button
                        type="button"
                        disabled={maxAffordableLot < 0.01}
                        onClick={() => {
                          if (maxAffordableLot >= 0.01) {
                            setLotInput(maxAffordableLot.toFixed(2));
                          }
                        }}
                        data-testid="trade-max-lot-btn"
                        className="font-mono-num text-[10px] font-semibold text-[#D4AF37] hover:underline disabled:text-neutral-500 disabled:no-underline cursor-pointer"
                      >
                        Max {maxAffordableLot.toFixed(2)} (1:{DEMO_ACCOUNT_LEVERAGE})
                      </button>
                    </div>
                    <div className="flex h-11 items-center rounded-lg border border-neutral-700 bg-[#121216]">
                      <button
                        type="button"
                        onClick={() => adjustLot(-0.01)}
                        aria-label="Decrease lot size"
                        className="flex h-full w-10 items-center justify-center border-r border-neutral-800 text-white hover:bg-white/10 cursor-pointer"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input
                        id="trade-lot-input"
                        data-testid="trade-lot-input"
                        type="number"
                        inputMode="decimal"
                        min={0.01}
                        max={1000}
                        step="0.01"
                        value={lotInput}
                        onChange={(e) => setLotInput(e.target.value)}
                        className="h-full w-full bg-transparent px-2 text-center font-mono-num text-sm font-bold text-white focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => adjustLot(0.01)}
                        aria-label="Increase lot size"
                        className="flex h-full w-10 items-center justify-center border-l border-neutral-800 text-white hover:bg-white/10 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {activeQuote && (
                      <div
                        className={`mt-1 font-mono-num text-[10px] ${
                          estimatedMarginUSD > availableTradeBalance || poorStatus.isPoor
                            ? 'text-[#F87171]'
                            : 'text-neutral-400'
                        }`}
                      >
                        Req: {formatUSD(estimatedMarginUSD)} · Avail: {formatUSD(Math.max(0, availableTradeBalance))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="trade-sl-input"
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-neutral-400"
                    >
                      Stop Loss (SL)
                    </label>
                    <input
                      id="trade-sl-input"
                      data-testid="trade-sl-input"
                      type="number"
                      inputMode="decimal"
                      step={cfg.pointStep}
                      placeholder="Optional SL"
                      value={slInput}
                      onChange={(e) => setSlInput(e.target.value)}
                      className="h-11 w-full rounded-lg border border-neutral-700 bg-[#121216] px-3 font-mono-num text-sm text-white placeholder:text-neutral-600 focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="trade-tp-input"
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-neutral-400"
                    >
                      Take Profit (TP)
                    </label>
                    <input
                      id="trade-tp-input"
                      data-testid="trade-tp-input"
                      type="number"
                      inputMode="decimal"
                      step={cfg.pointStep}
                      placeholder="Optional TP"
                      value={tpInput}
                      onChange={(e) => setTpInput(e.target.value)}
                      className="h-11 w-full rounded-lg border border-neutral-700 bg-[#121216] px-3 font-mono-num text-sm text-white placeholder:text-neutral-600 focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Inline Validation / Execution Feedback */}
                {feedback && (
                  <div
                    data-testid="trade-feedback-msg"
                    className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                      feedback.kind === 'error'
                        ? 'border-[#E54855]/50 bg-[#E54855]/10 text-[#F87171]'
                        : 'border-[#19B87D]/50 bg-[#19B87D]/10 text-[#19B87D]'
                    }`}
                  >
                    {feedback.text}
                  </div>
                )}

                {/* MetaTrader BUY / SELL Execution Buttons */}
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={!activeQuote}
                    onClick={() => handleOrder('SELL')}
                    data-testid="trade-sell-btn"
                    className="flex h-12 flex-col items-center justify-center rounded-lg bg-[#E54855] px-3 text-white shadow hover:bg-[#D63946] disabled:opacity-45 cursor-pointer"
                  >
                    <span className="text-[11px] font-bold tracking-wider">SELL BY MARKET</span>
                    <span className="font-mono-num text-sm font-bold">
                      {activeQuote ? formatPrice(activeQuote.bid, cfg.decimals) : '—'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={!activeQuote}
                    onClick={() => handleOrder('BUY')}
                    data-testid="trade-buy-btn"
                    className="flex h-12 flex-col items-center justify-center rounded-lg bg-[#16A34A] px-3 text-white shadow hover:bg-[#15803D] disabled:opacity-45 cursor-pointer"
                  >
                    <span className="text-[11px] font-bold tracking-wider">BUY BY MARKET</span>
                    <span className="font-mono-num text-sm font-bold">
                      {activeQuote ? formatPrice(activeQuote.ask, cfg.decimals) : '—'}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {feedback && !account.activeBuySell && (
              <div
                data-testid="trade-feedback-msg"
                className={`mt-3 rounded-lg border px-3 py-2 text-xs font-medium ${
                  feedback.kind === 'error'
                    ? 'border-[#E54855]/50 bg-[#E54855]/10 text-[#F87171]'
                    : 'border-[#19B87D]/50 bg-[#19B87D]/10 text-[#19B87D]'
                }`}
              >
                {feedback.text}
              </div>
            )}
          </section>

          {/* Open Positions Section */}
          <section className="rounded-xl border border-neutral-800 bg-[#0D0D11]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 px-3.5 py-2.5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
                Open Positions ({account.openPositions.length})
              </h2>
              <span className="text-[11px] text-neutral-400">
                Tap position or price to manage
              </span>
            </div>

            {/* Total Live Profit & Total Live Loss Summary Box inside Open Positions */}
            <div
              data-testid="live-pnl-summary-box"
              className="mx-3.5 mt-3 grid grid-cols-3 gap-2 rounded-lg border border-neutral-800 bg-[#08080B] p-2.5"
            >
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  Total Live Profit
                </div>
                <div
                  data-testid="total-live-profit-val"
                  className="mt-0.5 font-mono-num text-sm font-bold text-[#19B87D]"
                >
                  {formatUSD(liveSummary.totalProfit, true)}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  Total Live Loss
                </div>
                <div
                  data-testid="total-live-loss-val"
                  className="mt-0.5 font-mono-num text-sm font-bold text-[#E54855]"
                >
                  {formatUSD(liveSummary.totalLoss, false)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  Net Live P/L
                </div>
                <div
                  data-testid="total-live-net-val"
                  className={`mt-0.5 font-mono-num text-sm font-bold ${
                    liveSummary.netPnL >= 0 ? 'text-[#19B87D]' : 'text-[#E54855]'
                  }`}
                >
                  {formatUSD(liveSummary.netPnL, true)}
                </div>
              </div>
            </div>

            {/* Bulk Close Actions: Close All / Close Profitable / Close Losing */}
            {account.openPositions.length > 0 && (
              <div className="mx-3.5 mt-2.5 grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleBulkClose('ALL')}
                  data-testid="close-all-positions-btn"
                  className="h-9 rounded-lg border border-neutral-700 bg-[#14141A] px-2 text-[11px] font-bold text-white hover:border-white active:scale-95 transition-transform whitespace-nowrap cursor-pointer"
                >
                  Close All
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkClose('PROFITABLE')}
                  data-testid="close-profitable-positions-btn"
                  className="h-9 rounded-lg border border-[#19B87D]/45 bg-[#0B2219] px-2 text-[11px] font-bold text-[#19B87D] hover:border-[#19B87D] active:scale-95 transition-transform whitespace-nowrap cursor-pointer"
                >
                  Close Profitable
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkClose('LOSING')}
                  data-testid="close-losing-positions-btn"
                  className="h-9 rounded-lg border border-[#E54855]/45 bg-[#230C10] px-2 text-[11px] font-bold text-[#F87171] hover:border-[#E54855] active:scale-95 transition-transform whitespace-nowrap cursor-pointer"
                >
                  Close Losing
                </button>
              </div>
            )}

            {account.openPositions.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-neutral-500">
                No open demo positions. Execute Buy or Sell above to open a position.
              </div>
            ) : (
              <div className="divide-y divide-neutral-800">
                {account.openPositions.map((pos) => {
                  const posQuote = quotes[pos.symbol] ?? null;
                  const { currentClosePrice, pnl } = computeUnrealizedPnL(pos, posQuote);
                  const dec = MARKETS[pos.symbol].decimals;
                  const isExpanded = expandedPosId === pos.id;
                  const isProfit = pnl >= 0;

                  return (
                    <div key={pos.id} className="px-3.5 py-3" data-testid={`open-pos-${pos.id}`}>
                      {/* Tappable Position & Price Row */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => openQuickPanel(pos)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openQuickPanel(pos);
                          }
                        }}
                        className="flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-bold text-white">{pos.symbol}</span>
                            <span
                              className={`text-xs font-bold ${
                                pos.direction === 'BUY' ? 'text-[#22C55E]' : 'text-[#F43F5E]'
                              }`}
                            >
                              {pos.direction.toLowerCase()} {pos.lotSize.toFixed(2)}
                            </span>
                          </div>
                          <div className="mt-0.5 font-mono-num text-xs text-neutral-400">
                            {formatPrice(pos.entryPrice, dec)} → {formatPrice(currentClosePrice, dec)}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-3 font-mono-num text-[11px] text-neutral-500">
                            <span>SL: {pos.sl !== null ? formatPrice(pos.sl, dec) : '—'}</span>
                            <span>TP: {pos.tp !== null ? formatPrice(pos.tp, dec) : '—'}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <div
                              className={`font-mono-num text-sm font-bold ${
                                isProfit ? 'text-[#19B87D]' : 'text-[#E54855]'
                              }`}
                            >
                              {formatUSD(pnl, true)}
                            </div>
                            <div className="text-[10px] text-neutral-500">
                              {isExpanded ? 'Hide panel' : 'Actions'}
                            </div>
                          </div>

                          {/* Modify Position Arrow */}
                          <button
                            type="button"
                            onClick={(e) => openModifyPanel(pos, e)}
                            aria-label={`Modify ${pos.symbol} position`}
                            title="Modify Order / Position"
                            data-testid={`modify-pos-arrow-${pos.id}`}
                            className="flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-800 bg-[#141419] text-white hover:border-[#D4AF37] cursor-pointer"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Quick Action Panel when row or price area is tapped */}
                      {isExpanded && (
                        <div
                          data-testid={`quick-action-panel-${pos.id}`}
                          className="mt-3 rounded-lg border border-neutral-800 bg-[#08080A] p-3"
                        >
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                                Quick SL
                              </label>
                              <input
                                type="number"
                                inputMode="decimal"
                                step={INSTRUMENT_SPREAD_CONFIG[pos.symbol].pointStep}
                                placeholder="No SL"
                                value={quickSlMap[pos.id] ?? ''}
                                onChange={(e) =>
                                  setQuickSlMap((p) => ({ ...p, [pos.id]: e.target.value }))
                                }
                                data-testid={`quick-sl-input-${pos.id}`}
                                className="h-10 w-full rounded-md border border-neutral-700 bg-[#141419] px-2.5 font-mono-num text-xs text-white focus:border-[#D4AF37] focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                                Quick TP
                              </label>
                              <input
                                type="number"
                                inputMode="decimal"
                                step={INSTRUMENT_SPREAD_CONFIG[pos.symbol].pointStep}
                                placeholder="No TP"
                                value={quickTpMap[pos.id] ?? ''}
                                onChange={(e) =>
                                  setQuickTpMap((p) => ({ ...p, [pos.id]: e.target.value }))
                                }
                                data-testid={`quick-tp-input-${pos.id}`}
                                className="h-10 w-full rounded-md border border-neutral-700 bg-[#141419] px-2.5 font-mono-num text-xs text-white focus:border-[#D4AF37] focus:outline-none"
                              />
                            </div>
                          </div>

                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleCloseSinglePosition(pos)}
                              data-testid={`close-pos-btn-${pos.id}`}
                              className="h-10 flex-1 rounded-md bg-[#E54855] px-3 text-xs font-bold text-white hover:bg-[#D63946] active:scale-95 transition-transform cursor-pointer"
                            >
                              Close Position
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveQuickSlTp(pos)}
                              data-testid={`save-quick-sltp-btn-${pos.id}`}
                              className="h-10 rounded-md border border-[#D4AF37] bg-[#D4AF37]/15 px-3 text-xs font-bold text-[#D4AF37] hover:bg-[#D4AF37]/25 cursor-pointer"
                            >
                              Save SL / TP
                            </button>
                            <button
                              type="button"
                              onClick={(e) => openModifyPanel(pos, e)}
                              className="flex h-10 items-center gap-1 rounded-md border border-neutral-700 bg-[#141419] px-3 text-xs font-semibold text-white hover:border-white cursor-pointer"
                            >
                              Modify <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Full Modify Position Panel (opened via Modify Arrow) */}
      {modifyModalAnim.shouldRender && activeModifyPosition && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setModifyPosId(null);
              setModifyFeedback(null);
            }
          }}
          className={`${
            modifyModalAnim.isClosing ? 'animate-lv-fade-out pointer-events-none' : 'animate-lv-fade-in'
          } fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 sm:items-center`}
        >
          <div
            data-testid="modify-position-modal"
            className={`${
              modifyModalAnim.isClosing ? 'animate-lv-modal-out' : 'animate-lv-modal-in'
            } w-full max-w-md rounded-2xl border border-neutral-700 bg-[#0E0E12] p-4 shadow-2xl`}
          >
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#D4AF37]">
                  Modify Position · {activeModifyPosition.symbol}
                </h3>
                <p className="mt-0.5 font-mono-num text-xs text-neutral-400">
                  {activeModifyPosition.direction} {activeModifyPosition.lotSize.toFixed(2)} @{' '}
                  {formatPrice(
                    activeModifyPosition.entryPrice,
                    MARKETS[activeModifyPosition.symbol].decimals
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModifyPosId(null);
                  setModifyFeedback(null);
                }}
                aria-label="Close modify panel"
                className="flex h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10 active:scale-95 transition-transform cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-neutral-300">
                  Stop Loss (SL)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step={INSTRUMENT_SPREAD_CONFIG[activeModifyPosition.symbol].pointStep}
                  placeholder="Blank to clear"
                  value={modifySlInput}
                  onChange={(e) => setModifySlInput(e.target.value)}
                  data-testid="modify-modal-sl-input"
                  className="h-11 w-full rounded-lg border border-neutral-700 bg-[#141419] px-3 font-mono-num text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-neutral-300">
                  Take Profit (TP)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step={INSTRUMENT_SPREAD_CONFIG[activeModifyPosition.symbol].pointStep}
                  placeholder="Blank to clear"
                  value={modifyTpInput}
                  onChange={(e) => setModifyTpInput(e.target.value)}
                  data-testid="modify-modal-tp-input"
                  className="h-11 w-full rounded-lg border border-neutral-700 bg-[#141419] px-3 font-mono-num text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                />
              </div>
            </div>

            {modifyFeedback && (
              <div
                className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                  modifyFeedback.kind === 'error'
                    ? 'border-[#E54855]/50 bg-[#E54855]/10 text-[#F87171]'
                    : 'border-[#19B87D]/50 bg-[#19B87D]/10 text-[#19B87D]'
                }`}
              >
                {modifyFeedback.text}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setModifyPosId(null);
                  setModifyFeedback(null);
                }}
                className="h-11 flex-1 rounded-lg border border-neutral-700 bg-[#141419] text-xs font-bold text-white active:scale-95 transition-transform cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveModifyModal}
                data-testid="modify-modal-save-btn"
                className="h-11 flex-1 rounded-lg bg-[#D4AF37] text-xs font-bold text-black hover:bg-[#E5C158] active:scale-95 transition-transform cursor-pointer"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

TradeScreen.displayName = 'TradeScreen';
