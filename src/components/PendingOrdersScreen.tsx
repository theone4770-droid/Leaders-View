import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlarmClock,
  ChevronRight,
  Crosshair,
  Minus,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { MarketSymbol } from '../types/chart';
import {
  MarketBidAskQuote,
  PendingOrder,
  PendingOrderType,
  TradingAccountState,
} from '../types/trading';
import { INSTRUMENT_SPREAD_CONFIG } from '../modules/spreadEngine';
import {
  computeAvailableTradeBalanceUSD,
  computeMaxAffordableLot,
  DEMO_ACCOUNT_LEVERAGE,
  evaluatePoorAccountBalance,
  formatOrderTypeLabel,
} from '../modules/tradingEngine';
import { formatPrice, MARKETS } from '../modules/timeframeManager';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

interface PendingOrdersScreenProps {
  open: boolean;
  account: TradingAccountState;
  selectedMarket: MarketSymbol;
  quotes: Partial<Record<MarketSymbol, MarketBidAskQuote | null>>;
  initialLotSize: number;
  onSelectPendingOrderTypeOnChart: (orderType: PendingOrderType, lotSize: number) => void;
  onModifyPendingOrder: (params: {
    orderId: string;
    entryPrice: number;
    limitPrice: number | null;
    sl: number | null;
    tp: number | null;
  }) => { ok: boolean; error?: string };
  onCancelPendingOrder: (orderId: string) => void;
  onOpenSetBalance?: () => void;
  onClose: () => void;
}

const ALL_PENDING_TYPES: PendingOrderType[] = [
  'BUY_LIMIT',
  'SELL_LIMIT',
  'BUY_STOP',
  'SELL_STOP',
  'BUY_STOP_LIMIT',
  'SELL_STOP_LIMIT',
];

function parseOptionalPrice(raw: string): { valid: boolean; value: number | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return { valid: false, value: null };
  return { valid: true, value: n };
}

function formatExpirationText(expiresAt: number | null): string {
  if (expiresAt === null) return 'GTC';
  const d = new Date(expiresAt);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`;
}

export const PendingOrdersScreen: React.FC<PendingOrdersScreenProps> = React.memo(({
  open,
  account,
  selectedMarket,
  quotes,
  initialLotSize,
  onSelectPendingOrderTypeOnChart,
  onModifyPendingOrder,
  onCancelPendingOrder,
  onOpenSetBalance,
  onClose,
}) => {
  const { shouldRender, isClosing } = useAnimatedPresence(open, 165);

  const [lotInput, setLotInput] = useState(() => initialLotSize.toFixed(2));
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  // Modify active pending order modal state
  const [modifyOrderId, setModifyOrderId] = useState<string | null>(null);
  const [modEntryInput, setModEntryInput] = useState('');
  const [modLimitInput, setModLimitInput] = useState('');
  const [modSlInput, setModSlInput] = useState('');
  const [modTpInput, setModTpInput] = useState('');
  const [modifyFeedback, setModifyFeedback] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  const activeQuote = quotes[selectedMarket] ?? null;
  const cfg = INSTRUMENT_SPREAD_CONFIG[selectedMarket];

  useEffect(() => {
    if (open) {
      setFeedback(null);
      setLotInput(initialLotSize.toFixed(2));
    }
  }, [open, initialLotSize, selectedMarket]);

  useEffect(() => {
    if (!shouldRender) {
      setModifyOrderId(null);
      setModifyFeedback(null);
      setFeedback(null);
    }
  }, [shouldRender]);

  const modifyTargetOrder = useMemo(
    () => account.pendingOrders.find((o) => o.id === modifyOrderId) ?? null,
    [account.pendingOrders, modifyOrderId]
  );

  const lastModifyOrderRef = useRef<PendingOrder | null>(modifyTargetOrder);
  if (modifyTargetOrder) {
    lastModifyOrderRef.current = modifyTargetOrder;
  }
  const modifyModalAnim = useAnimatedPresence(Boolean(modifyOrderId && modifyTargetOrder), 165);
  const activeModifyOrder = modifyTargetOrder ?? lastModifyOrderRef.current;

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

  if (!shouldRender) return null;

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

  const handleTapOrderType = (orderType: PendingOrderType) => {
    setFeedback(null);
    if (!activeQuote) {
      setFeedback({ kind: 'error', text: 'Waiting for live market quote.' });
      return;
    }
    if (poorStatus.isPoor) {
      setFeedback({ kind: 'error', text: 'POOR ACCOUNT BALANCE LEVEL SET BALANCE TO CONTINUE' });
      return;
    }
    const parsedLot = Number(lotInput);
    const validLot =
      Number.isFinite(parsedLot) && parsedLot >= 0.01 && parsedLot <= 1000
        ? Math.round(parsedLot * 100) / 100
        : 0.1;
    if (maxAffordableLot >= 0.01 && validLot > maxAffordableLot) {
      setFeedback({
        kind: 'error',
        text: `Lot exceeds max affordable ${maxAffordableLot.toFixed(2)} lot (1:${DEMO_ACCOUNT_LEVERAGE}) for current balance.`,
      });
      return;
    }
    onSelectPendingOrderTypeOnChart(orderType, validLot);
  };

  const openModify = (ord: PendingOrder) => {
    const dec = MARKETS[ord.symbol].decimals;
    setModifyOrderId(ord.id);
    setModEntryInput(ord.entryPrice.toFixed(dec));
    setModLimitInput(ord.limitPrice !== null ? ord.limitPrice.toFixed(dec) : '');
    setModSlInput(ord.sl !== null ? ord.sl.toFixed(dec) : '');
    setModTpInput(ord.tp !== null ? ord.tp.toFixed(dec) : '');
    setModifyFeedback(null);
  };

  const handleSaveModify = () => {
    if (!modifyTargetOrder) return;
    setModifyFeedback(null);
    const entryVal = Number(modEntryInput);
    if (!Number.isFinite(entryVal) || entryVal <= 0) {
      setModifyFeedback({ kind: 'error', text: 'Enter a valid entry price.' });
      return;
    }
    const isModStopLimit =
      modifyTargetOrder.orderType === 'BUY_STOP_LIMIT' ||
      modifyTargetOrder.orderType === 'SELL_STOP_LIMIT';
    let limitVal: number | null = null;
    if (isModStopLimit) {
      const parsedLimit = Number(modLimitInput);
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        setModifyFeedback({ kind: 'error', text: 'Enter a valid Limit price.' });
        return;
      }
      limitVal = parsedLimit;
    }
    const slParsed = parseOptionalPrice(modSlInput);
    const tpParsed = parseOptionalPrice(modTpInput);
    if (!slParsed.valid || !tpParsed.valid) {
      setModifyFeedback({ kind: 'error', text: 'Invalid SL or TP input.' });
      return;
    }

    const res = onModifyPendingOrder({
      orderId: modifyTargetOrder.id,
      entryPrice: entryVal,
      limitPrice: limitVal,
      sl: slParsed.value,
      tp: tpParsed.value,
    });
    if (!res.ok) {
      setModifyFeedback({ kind: 'error', text: res.error || 'Unable to save order changes.' });
      return;
    }
    setModifyOrderId(null);
    setModifyFeedback(null);
    setFeedback({ kind: 'ok', text: `${modifyTargetOrder.symbol} pending order updated.` });
  };

  return (
    <div
      role="dialog"
      aria-label="Pending Orders Bottom Drawer"
      data-testid="pending-orders-screen"
      className={`${
        isClosing ? 'animate-lv-fade-out pointer-events-none' : 'animate-lv-fade-in'
      } fixed inset-0 z-40 flex flex-col justify-end bg-black/55`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* MT5-Style Bottom Slide-Up Popup Drawer keeping chart visible above */}
      <div
        className={`${
          isClosing ? 'animate-lv-sheet-down' : 'animate-lv-sheet-up'
        } mx-auto flex max-h-[74dvh] w-full max-w-3xl flex-col rounded-t-2xl border-t border-x border-neutral-700 bg-[#0A0A0E] text-white shadow-2xl`}
      >
        {/* Handle Bar */}
        <div className="pt-2 pb-1 flex justify-center shrink-0">
          <span className="h-1 w-10 rounded-full bg-neutral-700" />
        </div>

        {/* Drawer Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-3.5 pb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <AlarmClock className="w-4 h-4 text-white shrink-0" />
            <span className="text-sm font-bold tracking-wide text-[#D4AF37]">Pending Orders</span>
            <span className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {selectedMarket}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {activeQuote && (
              <div className="hidden sm:flex items-center gap-2 font-mono-num text-xs">
                <span className="text-[#22C55E]">
                  BID {formatPrice(activeQuote.bid, cfg.decimals)}
                </span>
                <span className="text-[#EF4444]">
                  ASK {formatPrice(activeQuote.ask, cfg.decimals)}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Pending Orders"
              data-testid="pending-back-btn"
              className="flex h-10 w-10 items-center justify-center rounded-md text-white hover:bg-white/10 active:scale-95 transition-transform cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Scrollable Drawer Body */}
        <div className="lv-scroll-smooth flex-1 overflow-y-auto px-3.5 py-3 flex flex-col gap-3">
          {poorStatus.isPoor && (
            <div
              data-testid="pending-poor-balance-banner"
              className="animate-lv-panel-in flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E54855]/70 bg-[#2A0B10] px-3 py-2 text-[11px]"
            >
              <span className="font-bold tracking-wide text-[#FCA5A5]">
                POOR ACCOUNT BALANCE LEVEL SET BALANCE TO CONTINUE
              </span>
              {onOpenSetBalance && (
                <button
                  type="button"
                  onClick={onOpenSetBalance}
                  className="rounded-md bg-[#D4AF37] px-2.5 py-1 text-[10px] font-bold text-black hover:bg-[#E5C158] cursor-pointer"
                >
                  Set Balance
                </button>
              )}
            </div>
          )}

          {/* Mobile live Bid/Ask strip */}
          <div className="flex sm:hidden items-center justify-between rounded-lg border border-neutral-800 bg-[#060608] px-3 py-1.5 font-mono-num text-xs">
            <div>
              <span className="text-[10px] text-[#22C55E] mr-1">BID</span>
              <span className="font-bold text-white">
                {activeQuote ? formatPrice(activeQuote.bid, cfg.decimals) : '—'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-[#EF4444] mr-1">ASK</span>
              <span className="font-bold text-white">
                {activeQuote ? formatPrice(activeQuote.ask, cfg.decimals) : '—'}
              </span>
            </div>
          </div>

          {/* Lot selector + Direct On-Chart Pending Order Types */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-300">
                  <Crosshair className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
                  <span className="truncate">Tap order type for chart line</span>
                </div>
                <button
                  type="button"
                  disabled={maxAffordableLot < 0.01}
                  onClick={() => {
                    if (maxAffordableLot >= 0.01) {
                      setLotInput(maxAffordableLot.toFixed(2));
                    }
                  }}
                  className="mt-0.5 font-mono-num text-[10px] font-semibold text-[#D4AF37] hover:underline disabled:text-neutral-500 cursor-pointer"
                >
                  Max {maxAffordableLot.toFixed(2)} lot (1:{DEMO_ACCOUNT_LEVERAGE})
                </button>
              </div>
              <div className="flex h-10 w-[144px] shrink-0 items-center rounded-lg border border-neutral-700 bg-[#121216]">
                <button
                  type="button"
                  onClick={() => adjustLot(-0.01)}
                  aria-label="Decrease lot"
                  className="flex h-full w-9 items-center justify-center border-r border-neutral-800 text-white hover:bg-white/10 active:scale-95 cursor-pointer"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  max={1000}
                  step="0.01"
                  aria-label="Pending Lot Size"
                  value={lotInput}
                  onChange={(e) => setLotInput(e.target.value)}
                  data-testid="pending-lot-input"
                  className="h-full w-full bg-transparent px-1 text-center font-mono-num text-xs font-bold text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  onClick={() => adjustLot(0.01)}
                  aria-label="Increase lot"
                  className="flex h-full w-9 items-center justify-center border-l border-neutral-800 text-white hover:bg-white/10 active:scale-95 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* All 6 MetaTrader Pending Order Types (Tap opens interactive line + Top Modify/Execute bar) */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ALL_PENDING_TYPES.map((t) => {
                const isBuy = t.startsWith('BUY');
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={!activeQuote}
                    onClick={() => handleTapOrderType(t)}
                    data-testid={`pending-type-${t}`}
                    className={`flex h-11 items-center justify-between rounded-lg border px-3 text-xs font-bold transition-transform active:scale-95 disabled:opacity-45 whitespace-nowrap cursor-pointer ${
                      isBuy
                        ? 'border-[#22C55E]/45 bg-[#091F14] text-[#4ADE80] hover:border-[#22C55E] hover:bg-[#0E2C1D]'
                        : 'border-[#F43F5E]/40 bg-[#220B11] text-[#FDA4AF] hover:border-[#F43F5E] hover:bg-[#2E0F17]'
                    }`}
                  >
                    <span>{formatOrderTypeLabel(t)}</span>
                    <ChevronRight className="w-3.5 h-3.5 opacity-75 shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>

          {feedback && (
            <div
              data-testid="pending-feedback-msg"
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                feedback.kind === 'error'
                  ? 'border-[#E54855]/50 bg-[#E54855]/10 text-[#F87171]'
                  : 'border-[#19B87D]/50 bg-[#19B87D]/10 text-[#19B87D]'
              }`}
            >
              {feedback.text}
            </div>
          )}

          {/* Active Pending Orders List inside bottom drawer */}
          <div className="rounded-xl border border-neutral-800 bg-[#0D0D12]">
            <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#D4AF37]">
                Active Pending ({account.pendingOrders.length})
              </span>
              <span className="text-[10px] text-neutral-500">Triggers on Bid/Ask</span>
            </div>

            {account.pendingOrders.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-neutral-500">
                No active pending orders.
              </div>
            ) : (
              <div className="divide-y divide-neutral-800">
                {account.pendingOrders.map((ord) => {
                  const dec = MARKETS[ord.symbol].decimals;
                  return (
                    <div
                      key={ord.id}
                      data-testid={`pending-row-${ord.id}`}
                      className="flex items-center justify-between gap-2 px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-bold text-white">{ord.symbol}</span>
                          <span
                            className={`text-xs font-bold ${
                              ord.direction === 'BUY' ? 'text-[#22C55E]' : 'text-[#F43F5E]'
                            }`}
                          >
                            {formatOrderTypeLabel(ord.orderType)} {ord.lotSize.toFixed(2)}
                          </span>
                          {ord.stopTriggered && (
                            <span className="rounded bg-[#D4AF37]/20 px-1 py-0.5 text-[9px] font-bold text-[#D4AF37]">
                              ARMED
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 font-mono-num text-[11px] text-neutral-300">
                          Entry: {formatPrice(ord.entryPrice, dec)}
                          {ord.limitPrice !== null && (
                            <span className="ml-2 text-[#D4AF37]">
                              Limit: {formatPrice(ord.limitPrice, dec)}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-2 font-mono-num text-[10px] text-neutral-500">
                          <span>SL: {ord.sl !== null ? formatPrice(ord.sl, dec) : '—'}</span>
                          <span>TP: {ord.tp !== null ? formatPrice(ord.tp, dec) : '—'}</span>
                          <span>Exp: {formatExpirationText(ord.expiresAt)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openModify(ord)}
                          aria-label={`Modify pending order ${ord.id}`}
                          data-testid={`modify-pending-arrow-${ord.id}`}
                          className="flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-800 bg-[#141419] text-white hover:border-[#D4AF37] active:scale-95 transition-transform cursor-pointer"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onCancelPendingOrder(ord.id)}
                          aria-label={`Cancel pending order ${ord.id}`}
                          data-testid={`cancel-pending-btn-${ord.id}`}
                          className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#E54855]/35 bg-[#E54855]/10 text-[#F87171] hover:bg-[#E54855]/25 active:scale-95 transition-transform cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modify Existing Pending Order Modal */}
      {modifyModalAnim.shouldRender && activeModifyOrder && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setModifyOrderId(null);
              setModifyFeedback(null);
            }
          }}
          className={`${
            modifyModalAnim.isClosing ? 'animate-lv-fade-out pointer-events-none' : 'animate-lv-fade-in'
          } fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 sm:items-center`}
        >
          <div
            data-testid="modify-pending-modal"
            className={`${
              modifyModalAnim.isClosing ? 'animate-lv-sheet-down' : 'animate-lv-sheet-up'
            } w-full max-w-md rounded-2xl border border-neutral-700 bg-[#0E0E12] p-4 shadow-2xl`}
          >
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#D4AF37]">
                  Modify {formatOrderTypeLabel(activeModifyOrder.orderType)} ·{' '}
                  {activeModifyOrder.symbol}
                </h3>
                <p className="mt-0.5 text-xs text-neutral-400">
                  Lot {activeModifyOrder.lotSize.toFixed(2)} ({activeModifyOrder.direction})
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModifyOrderId(null);
                  setModifyFeedback(null);
                }}
                aria-label="Close modify modal"
                className="flex h-10 w-10 items-center justify-center rounded-md text-white hover:bg-white/10 active:scale-95 transition-transform cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-neutral-300">
                  Entry Price
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step={INSTRUMENT_SPREAD_CONFIG[activeModifyOrder.symbol].pointStep}
                  value={modEntryInput}
                  onChange={(e) => setModEntryInput(e.target.value)}
                  data-testid="mod-pending-entry-input"
                  className="h-11 w-full rounded-lg border border-neutral-700 bg-[#141419] px-3 font-mono-num text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                />
              </div>

              {(activeModifyOrder.orderType === 'BUY_STOP_LIMIT' ||
                activeModifyOrder.orderType === 'SELL_STOP_LIMIT') && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-neutral-300">
                    Stop Limit Price
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step={INSTRUMENT_SPREAD_CONFIG[activeModifyOrder.symbol].pointStep}
                    value={modLimitInput}
                    onChange={(e) => setModLimitInput(e.target.value)}
                    data-testid="mod-pending-limit-input"
                    className="h-11 w-full rounded-lg border border-neutral-700 bg-[#141419] px-3 font-mono-num text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-neutral-300">
                    Stop Loss (SL)
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step={INSTRUMENT_SPREAD_CONFIG[activeModifyOrder.symbol].pointStep}
                    placeholder="Blank to clear"
                    value={modSlInput}
                    onChange={(e) => setModSlInput(e.target.value)}
                    data-testid="mod-pending-sl-input"
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
                    step={INSTRUMENT_SPREAD_CONFIG[activeModifyOrder.symbol].pointStep}
                    placeholder="Blank to clear"
                    value={modTpInput}
                    onChange={(e) => setModTpInput(e.target.value)}
                    data-testid="mod-pending-tp-input"
                    className="h-11 w-full rounded-lg border border-neutral-700 bg-[#141419] px-3 font-mono-num text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {modifyFeedback && (
              <div className="mt-3 rounded-lg border border-[#E54855]/50 bg-[#E54855]/10 px-3 py-2 text-xs text-[#F87171]">
                {modifyFeedback.text}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setModifyOrderId(null);
                  setModifyFeedback(null);
                }}
                className="h-11 flex-1 rounded-lg border border-neutral-700 bg-[#141419] text-xs font-bold text-white active:scale-95 transition-transform cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveModify}
                data-testid="mod-pending-save-btn"
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

PendingOrdersScreen.displayName = 'PendingOrdersScreen';
