import React, { useEffect, useRef, useState } from 'react';
import { Check, SlidersHorizontal, X } from 'lucide-react';
import { MarketBidAskQuote, PendingOrderDraft } from '../types/trading';
import { INSTRUMENT_SPREAD_CONFIG, roundToInstrument } from '../modules/spreadEngine';
import { formatOrderTypeLabel, validatePendingPrices } from '../modules/tradingEngine';
import { formatPrice, MARKETS } from '../modules/timeframeManager';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

interface PendingOrderTopBarProps {
  draft: PendingOrderDraft | null;
  quote: MarketBidAskQuote | null;
  hasQuickTradeBar?: boolean;
  onUpdateDraft: (next: PendingOrderDraft) => void;
  onExecute: (draft: PendingOrderDraft) => { ok: boolean; error?: string };
  onCancel: () => void;
}

type ExpiryChoice = 'GTC' | '1H' | 'TODAY';

export const PendingOrderTopBar: React.FC<PendingOrderTopBarProps> = React.memo(
  ({ draft, quote, hasQuickTradeBar = false, onUpdateDraft, onExecute, onCancel }) => {
    const { shouldRender, isClosing } = useAnimatedPresence(Boolean(draft), 145);
    const lastDraftRef = useRef<PendingOrderDraft | null>(draft);
    if (draft) {
      lastDraftRef.current = draft;
    }
    const activeDraft = draft ?? lastDraftRef.current;

    const [showModify, setShowModify] = useState(false);
    const [lotText, setLotText] = useState('');
    const [entryText, setEntryText] = useState('');
    const [limitText, setLimitText] = useState('');
    const [slText, setSlText] = useState('');
    const [tpText, setTpText] = useState('');
    const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>('GTC');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
      if (!shouldRender) {
        setShowModify(false);
        setErrorMsg(null);
      }
    }, [shouldRender]);

    useEffect(() => {
      if (!draft) return;
      const dec = MARKETS[draft.symbol].decimals;
      setLotText(draft.lotSize.toFixed(2));
      setEntryText(draft.entryPrice.toFixed(dec));
      setLimitText(draft.limitPrice !== null ? draft.limitPrice.toFixed(dec) : '');
      setSlText(draft.sl !== null ? draft.sl.toFixed(dec) : '');
      setTpText(draft.tp !== null ? draft.tp.toFixed(dec) : '');
      setErrorMsg(null);
    }, [
      draft?.symbol,
      draft?.orderType,
      draft?.entryPrice,
      draft?.limitPrice,
      draft?.sl,
      draft?.tp,
      draft?.lotSize,
    ]);

    if (!shouldRender || !activeDraft) return null;

    const currentDraft = activeDraft;
    const cfg = INSTRUMENT_SPREAD_CONFIG[currentDraft.symbol];
    const isStopLimit =
      currentDraft.orderType === 'BUY_STOP_LIMIT' || currentDraft.orderType === 'SELL_STOP_LIMIT';

    const validation = quote
      ? validatePendingPrices({
          orderType: currentDraft.orderType,
          entryPrice: currentDraft.entryPrice,
          limitPrice: currentDraft.limitPrice,
          sl: currentDraft.sl,
          tp: currentDraft.tp,
          quote,
        })
      : { valid: false, error: 'Waiting for market quote.' };

    const handleApplyModify = (e: React.FormEvent) => {
      e.preventDefault();
      setErrorMsg(null);
      const parsedLot = Number(lotText);
      const parsedEntry = Number(entryText);
      if (!Number.isFinite(parsedLot) || parsedLot < 0.01 || parsedLot > 1000) {
        setErrorMsg('Lot size must be 0.01 – 1000.');
        return;
      }
      if (!Number.isFinite(parsedEntry) || parsedEntry <= 0) {
        setErrorMsg('Enter a valid price.');
        return;
      }
      let nextLimit: number | null = null;
      if (isStopLimit) {
        const l = Number(limitText);
        if (!Number.isFinite(l) || l <= 0) {
          setErrorMsg('Enter a valid Limit price.');
          return;
        }
        nextLimit = roundToInstrument(l, cfg.decimals);
      }
      const slTrim = slText.trim();
      const tpTrim = tpText.trim();
      const nextSl = slTrim ? Number(slTrim) : null;
      const nextTp = tpTrim ? Number(tpTrim) : null;
      if ((nextSl !== null && (!Number.isFinite(nextSl) || nextSl <= 0)) ||
          (nextTp !== null && (!Number.isFinite(nextTp) || nextTp <= 0))) {
        setErrorMsg('Invalid SL or TP price.');
        return;
      }

      let nextExpires: number | null = null;
      if (expiryChoice === '1H') nextExpires = Date.now() + 3_600_000;
      else if (expiryChoice === 'TODAY') {
        const d = new Date();
        d.setHours(23, 59, 59, 999);
        nextExpires = d.getTime();
      }

      onUpdateDraft({
        ...currentDraft,
        lotSize: Math.round(parsedLot * 100) / 100,
        entryPrice: roundToInstrument(parsedEntry, cfg.decimals),
        limitPrice: nextLimit,
        sl: nextSl !== null ? roundToInstrument(nextSl, cfg.decimals) : null,
        tp: nextTp !== null ? roundToInstrument(nextTp, cfg.decimals) : null,
        expiresAt: nextExpires,
      });
      setShowModify(false);
    };

    const handleExecuteClick = () => {
      setErrorMsg(null);
      const res = onExecute(currentDraft);
      if (!res.ok) {
        setErrorMsg(res.error || 'Unable to execute pending order.');
      }
    };

    return (
      <div
        data-testid="pending-draft-topbar"
        className={`${
          isClosing ? 'animate-lv-panel-out' : 'animate-lv-panel-in'
        } pointer-events-none absolute left-2.5 right-2.5 sm:top-2.5 sm:left-[148px] sm:right-auto sm:max-w-2xl z-30 flex flex-col gap-1.5 ${
          hasQuickTradeBar ? 'top-[102px]' : 'top-[58px]'
        }`}
      >
        <div
          className={`${
            isClosing ? 'pointer-events-none' : 'pointer-events-auto'
          } flex flex-wrap items-center justify-between gap-1.5 rounded-xl border border-[#D4AF37]/70 bg-[#0A0A0F]/96 px-2.5 py-1 text-white shadow-2xl`}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="rounded bg-[#D4AF37]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#D4AF37] whitespace-nowrap">
              {formatOrderTypeLabel(currentDraft.orderType)}
            </span>
            <div className="min-w-0 font-mono-num text-[11px] leading-tight">
              <span className="font-bold text-white">
                {formatPrice(currentDraft.entryPrice, cfg.decimals)}
              </span>
              {isStopLimit && currentDraft.limitPrice !== null && (
                <span className="ml-1.5 text-[#38BDF8]">
                  L:{formatPrice(currentDraft.limitPrice, cfg.decimals)}
                </span>
              )}
              <span className="ml-1.5 text-neutral-400">{currentDraft.lotSize.toFixed(2)} lot</span>
              {currentDraft.sl !== null && (
                <span data-testid="pending-draft-sl-tag" className="ml-1.5 text-[#F87171]">
                  SL:{formatPrice(currentDraft.sl, cfg.decimals)}
                </span>
              )}
              {currentDraft.tp !== null && (
                <span data-testid="pending-draft-tp-tag" className="ml-1.5 text-[#4ADE80]">
                  TP:{formatPrice(currentDraft.tp, cfg.decimals)}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setShowModify((v) => !v)}
              data-testid="pending-draft-modify-btn"
              className={`flex h-8 items-center gap-1 rounded-lg border px-2 text-[11px] font-bold transition-transform active:scale-95 whitespace-nowrap cursor-pointer ${
                showModify
                  ? 'border-[#D4AF37] bg-[#D4AF37]/20 text-[#D4AF37]'
                  : 'border-neutral-700 bg-[#14141A] text-white hover:border-[#D4AF37]'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Modify
            </button>
            <button
              type="button"
              onClick={handleExecuteClick}
              disabled={!validation.valid}
              data-testid="pending-draft-execute-btn"
              className="flex h-8 items-center gap-1 rounded-lg bg-[#D4AF37] px-2.5 text-[11px] font-bold text-black hover:bg-[#E5C158] active:scale-95 disabled:opacity-45 transition-transform whitespace-nowrap cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              Execute
            </button>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancel pending draft line"
              data-testid="pending-draft-cancel-btn"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 bg-[#14141A] text-neutral-300 hover:text-white active:scale-95 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status / Validation / Error hint */}
        {(errorMsg || !validation.valid) && (
          <div
            data-testid="pending-draft-status-msg"
            className={`${
              isClosing ? 'pointer-events-none' : 'pointer-events-auto'
            } self-start rounded-md border px-2.5 py-1 text-[10px] font-semibold shadow-lg ${
              errorMsg
                ? 'border-[#E54855]/60 bg-[#1F0B0E]/95 text-[#FCA5A5]'
                : 'border-amber-500/50 bg-[#1C1408]/95 text-amber-300'
            }`}
          >
            {errorMsg ?? validation.error}
          </div>
        )}

        {/* Expandable Modify Panel (exact manual inputs + Lot + SL/TP + Expiration) */}
        {showModify && (
          <form
            onSubmit={handleApplyModify}
            data-testid="pending-draft-modify-form"
            className={`${isClosing ? 'pointer-events-none' : 'animate-lv-panel-in pointer-events-auto'} rounded-xl border border-neutral-700 bg-[#0D0D13]/97 p-3 shadow-2xl`}
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  Lot (0.01–1000)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0.01}
                  max={1000}
                  value={lotText}
                  onChange={(e) => setLotText(e.target.value)}
                  data-testid="pending-draft-lot-input"
                  className="h-9 w-full rounded-md border border-neutral-700 bg-[#14141A] px-2 font-mono-num text-xs text-white focus:border-[#D4AF37] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  {isStopLimit ? 'Trigger Price' : 'Entry Price'}
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step={cfg.pointStep}
                  value={entryText}
                  onChange={(e) => setEntryText(e.target.value)}
                  data-testid="pending-draft-entry-input"
                  className="h-9 w-full rounded-md border border-neutral-700 bg-[#14141A] px-2 font-mono-num text-xs text-white focus:border-[#D4AF37] focus:outline-none"
                />
              </div>

              {isStopLimit ? (
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                    Limit Price
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step={cfg.pointStep}
                    value={limitText}
                    onChange={(e) => setLimitText(e.target.value)}
                    data-testid="pending-draft-limit-input"
                    className="h-9 w-full rounded-md border border-neutral-700 bg-[#14141A] px-2 font-mono-num text-xs text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                    Expiration
                  </label>
                  <select
                    value={expiryChoice}
                    onChange={(e) => setExpiryChoice(e.target.value as ExpiryChoice)}
                    className="h-9 w-full rounded-md border border-neutral-700 bg-[#14141A] px-2 text-xs text-white focus:border-[#D4AF37] focus:outline-none"
                  >
                    <option value="GTC">GTC</option>
                    <option value="1H">1 Hour</option>
                    <option value="TODAY">End of Today</option>
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  Stop Loss (SL)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step={cfg.pointStep}
                  placeholder="Optional"
                  value={slText}
                  onChange={(e) => setSlText(e.target.value)}
                  data-testid="pending-draft-sl-input"
                  className="h-9 w-full rounded-md border border-neutral-700 bg-[#14141A] px-2 font-mono-num text-xs text-white focus:border-[#D4AF37] focus:outline-none"
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
                  placeholder="Optional"
                  value={tpText}
                  onChange={(e) => setTpText(e.target.value)}
                  data-testid="pending-draft-tp-input"
                  className="h-9 w-full rounded-md border border-neutral-700 bg-[#14141A] px-2 font-mono-num text-xs text-white focus:border-[#D4AF37] focus:outline-none"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  data-testid="pending-draft-apply-btn"
                  className="h-9 w-full rounded-md bg-white px-3 text-xs font-bold text-black hover:bg-neutral-200 cursor-pointer"
                >
                  Apply to Line
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    );
  }
);

PendingOrderTopBar.displayName = 'PendingOrderTopBar';
