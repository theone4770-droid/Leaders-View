import React, { useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  ChevronRight,
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
import { formatOrderTypeLabel, getDirectionForPendingType } from '../modules/tradingEngine';
import { formatPrice, MARKETS } from '../modules/timeframeManager';

interface PendingOrdersScreenProps {
  open: boolean;
  account: TradingAccountState;
  selectedMarket: MarketSymbol;
  quotes: Partial<Record<MarketSymbol, MarketBidAskQuote | null>>;
  onPlacePendingOrder: (params: {
    symbol: MarketSymbol;
    orderType: PendingOrderType;
    lotSize: number;
    entryPrice: number;
    limitPrice: number | null;
    sl: number | null;
    tp: number | null;
    expiresAt: number | null;
  }) => { ok: boolean; error?: string };
  onModifyPendingOrder: (params: {
    orderId: string;
    entryPrice: number;
    limitPrice: number | null;
    sl: number | null;
    tp: number | null;
  }) => { ok: boolean; error?: string };
  onCancelPendingOrder: (orderId: string) => void;
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

type ExpiryMode = 'GTC' | '1H' | 'TODAY' | 'CUSTOM';

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

export const PendingOrdersScreen: React.FC<PendingOrdersScreenProps> = ({
  open,
  account,
  selectedMarket,
  quotes,
  onPlacePendingOrder,
  onModifyPendingOrder,
  onCancelPendingOrder,
  onClose,
}) => {
  const [orderType, setOrderType] = useState<PendingOrderType>('BUY_LIMIT');
  const [lotInput, setLotInput] = useState('0.10');
  const [entryPriceInput, setEntryPriceInput] = useState('');
  const [limitPriceInput, setLimitPriceInput] = useState('');
  const [slInput, setSlInput] = useState('');
  const [tpInput, setTpInput] = useState('');
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>('GTC');
  const [customExpiryInput, setCustomExpiryInput] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  // Modify modal state
  const [modifyOrderId, setModifyOrderId] = useState<string | null>(null);
  const [modEntryInput, setModEntryInput] = useState('');
  const [modLimitInput, setModLimitInput] = useState('');
  const [modSlInput, setModSlInput] = useState('');
  const [modTpInput, setModTpInput] = useState('');

  const activeQuote = quotes[selectedMarket] ?? null;
  const cfg = INSTRUMENT_SPREAD_CONFIG[selectedMarket];
  const isStopLimit = orderType === 'BUY_STOP_LIMIT' || orderType === 'SELL_STOP_LIMIT';
  const direction = getDirectionForPendingType(orderType);

  useEffect(() => {
    setFeedback(null);
  }, [selectedMarket, orderType, open]);

  const modifyTargetOrder = useMemo(
    () => account.pendingOrders.find((o) => o.id === modifyOrderId) ?? null,
    [account.pendingOrders, modifyOrderId]
  );

  if (!open) return null;

  const adjustLot = (delta: number) => {
    const cur = Number(lotInput);
    const base = Number.isFinite(cur) && cur > 0 ? cur : 0.01;
    const next = Math.min(1000, Math.max(0.01, Math.round((base + delta) * 100) / 100));
    setLotInput(next.toFixed(2));
  };

  const resolveExpirationMs = (): { valid: boolean; expiresAt: number | null } => {
    const now = Date.now();
    if (expiryMode === 'GTC') return { valid: true, expiresAt: null };
    if (expiryMode === '1H') return { valid: true, expiresAt: now + 3_600_000 };
    if (expiryMode === 'TODAY') {
      const d = new Date(now);
      d.setHours(23, 59, 59, 999);
      return { valid: true, expiresAt: d.getTime() };
    }
    if (!customExpiryInput) return { valid: false, expiresAt: null };
    const parsed = new Date(customExpiryInput).getTime();
    if (!Number.isFinite(parsed) || parsed <= now) return { valid: false, expiresAt: null };
    return { valid: true, expiresAt: parsed };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const entryPrice = Number(entryPriceInput);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      setFeedback({ kind: 'error', text: 'Enter a valid entry price.' });
      return;
    }

    let limitPrice: number | null = null;
    if (isStopLimit) {
      const lp = Number(limitPriceInput);
      if (!Number.isFinite(lp) || lp <= 0) {
        setFeedback({ kind: 'error', text: 'Enter a valid Limit price for Stop Limit order.' });
        return;
      }
      limitPrice = lp;
    }

    const slParsed = parseOptionalPrice(slInput);
    const tpParsed = parseOptionalPrice(tpInput);
    if (!slParsed.valid || !tpParsed.valid) {
      setFeedback({ kind: 'error', text: 'Invalid SL or TP price.' });
      return;
    }

    const exp = resolveExpirationMs();
    if (!exp.valid) {
      setFeedback({ kind: 'error', text: 'Select a valid future expiration date/time.' });
      return;
    }

    const res = onPlacePendingOrder({
      symbol: selectedMarket,
      orderType,
      lotSize: Number(lotInput),
      entryPrice,
      limitPrice,
      sl: slParsed.value,
      tp: tpParsed.value,
      expiresAt: exp.expiresAt,
    });

    if (!res.ok) {
      setFeedback({ kind: 'error', text: res.error || 'Pending order rejected.' });
      return;
    }

    setFeedback({
      kind: 'ok',
      text: `${selectedMarket} ${formatOrderTypeLabel(orderType)} placed cleanly.`,
    });
    setEntryPriceInput('');
    setLimitPriceInput('');
    setSlInput('');
    setTpInput('');
  };

  const openModify = (ord: PendingOrder) => {
    const dec = MARKETS[ord.symbol].decimals;
    setModifyOrderId(ord.id);
    setModEntryInput(ord.entryPrice.toFixed(dec));
    setModLimitInput(ord.limitPrice !== null ? ord.limitPrice.toFixed(dec) : '');
    setModSlInput(ord.sl !== null ? ord.sl.toFixed(dec) : '');
    setModTpInput(ord.tp !== null ? ord.tp.toFixed(dec) : '');
    setFeedback(null);
  };

  const handleSaveModify = () => {
    if (!modifyTargetOrder) return;
    const entryVal = Number(modEntryInput);
    if (!Number.isFinite(entryVal) || entryVal <= 0) {
      setFeedback({ kind: 'error', text: 'Enter a valid entry price.' });
      return;
    }
    const isModStopLimit =
      modifyTargetOrder.orderType === 'BUY_STOP_LIMIT' ||
      modifyTargetOrder.orderType === 'SELL_STOP_LIMIT';
    let limitVal: number | null = null;
    if (isModStopLimit) {
      const parsedLimit = Number(modLimitInput);
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        setFeedback({ kind: 'error', text: 'Enter a valid Limit price.' });
        return;
      }
      limitVal = parsedLimit;
    }
    const slParsed = parseOptionalPrice(modSlInput);
    const tpParsed = parseOptionalPrice(modTpInput);
    if (!slParsed.valid || !tpParsed.valid) {
      setFeedback({ kind: 'error', text: 'Invalid SL or TP input.' });
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
      setFeedback({ kind: 'error', text: res.error || 'Unable to save order changes.' });
      return;
    }
    setModifyOrderId(null);
    setFeedback({ kind: 'ok', text: `${modifyTargetOrder.symbol} pending order updated.` });
  };

  return (
    <div
      role="dialog"
      aria-label="Pending Orders Bottom Popup"
      data-testid="pending-orders-screen"
      className="fixed inset-0 z-40 flex flex-col justify-end bg-black/45 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* MT5-Style Bottom Slide-Up Popup Sheet keeping chart visible above */}
      <div className="mx-auto flex max-h-[76dvh] w-full max-w-3xl flex-col rounded-t-2xl border-t border-x border-neutral-700 bg-[#0A0A0E] text-white shadow-2xl">
        {/* Drag affordance bar */}
        <div className="pt-2 pb-1 flex justify-center shrink-0">
          <span className="h-1 w-10 rounded-full bg-neutral-700" />
        </div>

        {/* Sheet Header */}
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
                <span className="text-[#F43F5E]">
                  BID {formatPrice(activeQuote.bid, cfg.decimals)}
                </span>
                <span className="text-[#38BDF8]">
                  ASK {formatPrice(activeQuote.ask, cfg.decimals)}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Pending Orders"
              data-testid="pending-back-btn"
              className="flex h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Scrollable Sheet Body */}
        <div className="flex-1 overflow-y-auto px-3.5 py-3 flex flex-col gap-3">
          {/* Mobile live Bid/Ask strip */}
          <div className="flex sm:hidden items-center justify-between rounded-lg border border-neutral-800 bg-[#060608] px-3 py-1.5 font-mono-num text-xs">
            <div>
              <span className="text-[10px] text-[#F43F5E] mr-1">BID</span>
              <span className="font-bold text-white">
                {activeQuote ? formatPrice(activeQuote.bid, cfg.decimals) : '—'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-[#38BDF8] mr-1">ASK</span>
              <span className="font-bold text-white">
                {activeQuote ? formatPrice(activeQuote.ask, cfg.decimals) : '—'}
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
            {/* All 6 Pending Order Types */}
            <div>
              <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                <span>
                  Order Type · Direction:{' '}
                  <span className={direction === 'BUY' ? 'text-[#38BDF8]' : 'text-[#F43F5E]'}>
                    {direction}
                  </span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {ALL_PENDING_TYPES.map((t) => {
                  const selected = orderType === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setOrderType(t)}
                      data-testid={`pending-type-${t}`}
                      className={`h-9 rounded-lg border px-2 text-xs font-bold transition-colors cursor-pointer ${
                        selected
                          ? 'border-[#D4AF37] bg-[#D4AF37]/15 text-[#D4AF37]'
                          : 'border-neutral-800 bg-[#141419] text-white hover:border-neutral-600'
                      }`}
                    >
                      {formatOrderTypeLabel(t)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Lot, Entry Price, Stop-Limit Price */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  Lot (0.01 – 1000)
                </label>
                <div className="flex h-10 items-center rounded-lg border border-neutral-700 bg-[#121216]">
                  <button
                    type="button"
                    onClick={() => adjustLot(-0.01)}
                    aria-label="Decrease lot"
                    className="flex h-full w-9 items-center justify-center border-r border-neutral-800 text-white hover:bg-white/10 cursor-pointer"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0.01}
                    max={1000}
                    step="0.01"
                    value={lotInput}
                    onChange={(e) => setLotInput(e.target.value)}
                    data-testid="pending-lot-input"
                    className="h-full w-full bg-transparent px-2 text-center font-mono-num text-xs font-bold text-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => adjustLot(0.01)}
                    aria-label="Increase lot"
                    className="flex h-full w-9 items-center justify-center border-l border-neutral-800 text-white hover:bg-white/10 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  {isStopLimit ? 'Trigger Price (Stop)' : 'Entry Price'}
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step={cfg.pointStep}
                  placeholder={activeQuote ? formatPrice(activeQuote.ask, cfg.decimals) : 'Price'}
                  value={entryPriceInput}
                  onChange={(e) => setEntryPriceInput(e.target.value)}
                  data-testid="pending-entry-input"
                  className="h-10 w-full rounded-lg border border-neutral-700 bg-[#121216] px-2.5 font-mono-num text-xs text-white placeholder:text-neutral-600 focus:border-[#D4AF37] focus:outline-none"
                />
              </div>

              {isStopLimit ? (
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                    Stop Limit Price
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step={cfg.pointStep}
                    placeholder="Limit execution price"
                    value={limitPriceInput}
                    onChange={(e) => setLimitPriceInput(e.target.value)}
                    data-testid="pending-limit-input"
                    className="h-10 w-full rounded-lg border border-neutral-700 bg-[#121216] px-2.5 font-mono-num text-xs text-white placeholder:text-neutral-600 focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                    Expiration
                  </label>
                  <select
                    value={expiryMode}
                    onChange={(e) => setExpiryMode(e.target.value as ExpiryMode)}
                    data-testid="pending-expiry-select"
                    className="h-10 w-full rounded-lg border border-neutral-700 bg-[#121216] px-2.5 text-xs text-white focus:border-[#D4AF37] focus:outline-none"
                  >
                    <option value="GTC">GTC (Until Cancelled)</option>
                    <option value="1H">1 Hour</option>
                    <option value="TODAY">End of Today</option>
                    <option value="CUSTOM">Custom Date &amp; Time</option>
                  </select>
                </div>
              )}
            </div>

            {/* SL, TP */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  Stop Loss (SL)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step={cfg.pointStep}
                  placeholder="Optional SL"
                  value={slInput}
                  onChange={(e) => setSlInput(e.target.value)}
                  data-testid="pending-sl-input"
                  className="h-10 w-full rounded-lg border border-neutral-700 bg-[#121216] px-2.5 font-mono-num text-xs text-white placeholder:text-neutral-600 focus:border-[#D4AF37] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  Take Profit (TP)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step={cfg.pointStep}
                  placeholder="Optional TP"
                  value={tpInput}
                  onChange={(e) => setTpInput(e.target.value)}
                  data-testid="pending-tp-input"
                  className="h-10 w-full rounded-lg border border-neutral-700 bg-[#121216] px-2.5 font-mono-num text-xs text-white placeholder:text-neutral-600 focus:border-[#D4AF37] focus:outline-none"
                />
              </div>
            </div>

            {isStopLimit && (
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  Expiration
                </label>
                <select
                  value={expiryMode}
                  onChange={(e) => setExpiryMode(e.target.value as ExpiryMode)}
                  className="h-10 w-full rounded-lg border border-neutral-700 bg-[#121216] px-2.5 text-xs text-white focus:border-[#D4AF37] focus:outline-none"
                >
                  <option value="GTC">GTC (Until Cancelled)</option>
                  <option value="1H">1 Hour</option>
                  <option value="TODAY">End of Today</option>
                  <option value="CUSTOM">Custom Date &amp; Time</option>
                </select>
              </div>
            )}

            {expiryMode === 'CUSTOM' && (
              <input
                type="datetime-local"
                value={customExpiryInput}
                onChange={(e) => setCustomExpiryInput(e.target.value)}
                className="h-10 w-full rounded-lg border border-neutral-700 bg-[#121216] px-2.5 text-xs text-white focus:border-[#D4AF37] focus:outline-none"
              />
            )}

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

            <button
              type="submit"
              disabled={!activeQuote}
              data-testid="place-pending-order-btn"
              className="h-11 w-full rounded-lg bg-[#D4AF37] text-xs font-bold tracking-wide text-black hover:bg-[#E5C158] disabled:opacity-45 cursor-pointer"
            >
              Place {formatOrderTypeLabel(orderType)} Order
            </button>
          </form>

          {/* Active Pending Orders List inside bottom sheet */}
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
                              ord.direction === 'BUY' ? 'text-[#38BDF8]' : 'text-[#F43F5E]'
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

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openModify(ord)}
                          aria-label={`Modify pending order ${ord.id}`}
                          data-testid={`modify-pending-arrow-${ord.id}`}
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-800 bg-[#141419] text-white hover:border-[#D4AF37] cursor-pointer"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onCancelPendingOrder(ord.id)}
                          aria-label={`Cancel pending order ${ord.id}`}
                          data-testid={`cancel-pending-btn-${ord.id}`}
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E54855]/35 bg-[#E54855]/10 text-[#F87171] hover:bg-[#E54855]/25 cursor-pointer"
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

      {/* Modify Pending Order Panel */}
      {modifyTargetOrder && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 sm:items-center">
          <div
            data-testid="modify-pending-modal"
            className="w-full max-w-md rounded-2xl border border-neutral-700 bg-[#0E0E12] p-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#D4AF37]">
                  Modify {formatOrderTypeLabel(modifyTargetOrder.orderType)} ·{' '}
                  {modifyTargetOrder.symbol}
                </h3>
                <p className="mt-0.5 text-xs text-neutral-400">
                  Lot {modifyTargetOrder.lotSize.toFixed(2)} ({modifyTargetOrder.direction})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModifyOrderId(null)}
                aria-label="Close modify modal"
                className="flex h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10 cursor-pointer"
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
                  step={INSTRUMENT_SPREAD_CONFIG[modifyTargetOrder.symbol].pointStep}
                  value={modEntryInput}
                  onChange={(e) => setModEntryInput(e.target.value)}
                  data-testid="mod-pending-entry-input"
                  className="h-11 w-full rounded-lg border border-neutral-700 bg-[#141419] px-3 font-mono-num text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                />
              </div>

              {(modifyTargetOrder.orderType === 'BUY_STOP_LIMIT' ||
                modifyTargetOrder.orderType === 'SELL_STOP_LIMIT') && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-neutral-300">
                    Stop Limit Price
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step={INSTRUMENT_SPREAD_CONFIG[modifyTargetOrder.symbol].pointStep}
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
                    step={INSTRUMENT_SPREAD_CONFIG[modifyTargetOrder.symbol].pointStep}
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
                    step={INSTRUMENT_SPREAD_CONFIG[modifyTargetOrder.symbol].pointStep}
                    placeholder="Blank to clear"
                    value={modTpInput}
                    onChange={(e) => setModTpInput(e.target.value)}
                    data-testid="mod-pending-tp-input"
                    className="h-11 w-full rounded-lg border border-neutral-700 bg-[#141419] px-3 font-mono-num text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {feedback && (
              <div className="mt-3 rounded-lg border border-[#E54855]/50 bg-[#E54855]/10 px-3 py-2 text-xs text-[#F87171]">
                {feedback.text}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setModifyOrderId(null)}
                className="h-11 flex-1 rounded-lg border border-neutral-700 bg-[#141419] text-xs font-bold text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveModify}
                data-testid="mod-pending-save-btn"
                className="h-11 flex-1 rounded-lg bg-[#D4AF37] text-xs font-bold text-black hover:bg-[#E5C158] cursor-pointer"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
