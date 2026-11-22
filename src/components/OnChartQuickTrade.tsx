import React, { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { MarketSymbol } from '../types/chart';
import { MarketBidAskQuote, TradeDirection } from '../types/trading';
import { formatPrice, MARKETS } from '../modules/timeframeManager';

interface OnChartQuickTradeProps {
  visible: boolean;
  market: MarketSymbol;
  quote: MarketBidAskQuote | null;
  lotSize: number;
  onChangeLotSize: (nextLot: number) => void;
  onExecuteQuickOrder: (params: {
    symbol: MarketSymbol;
    direction: TradeDirection;
    lotSize: number;
    sl: number | null;
    tp: number | null;
  }) => { ok: boolean; error?: string };
}

export const OnChartQuickTrade: React.FC<OnChartQuickTradeProps> = React.memo(
  ({ visible, market, quote, lotSize, onChangeLotSize, onExecuteQuickOrder }) => {
    const [lotText, setLotText] = useState<string>(() => lotSize.toFixed(2));
    const [flashMsg, setFlashMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const isFocusedRef = useRef(false);
    const flashTimerRef = useRef<number | null>(null);

    useEffect(() => {
      if (!isFocusedRef.current) {
        setLotText(lotSize.toFixed(2));
      }
    }, [lotSize]);

    useEffect(() => {
      return () => {
        if (flashTimerRef.current !== null) {
          window.clearTimeout(flashTimerRef.current);
        }
      };
    }, []);

    if (!visible) return null;

    const decimals = MARKETS[market].decimals;

    const adjustLot = (delta: number) => {
      const parsed = Number(lotText);
      const base = Number.isFinite(parsed) && parsed > 0 ? parsed : lotSize;
      const clamped = Math.min(1000, Math.max(0.01, Math.round((base + delta) * 100) / 100));
      setLotText(clamped.toFixed(2));
      onChangeLotSize(clamped);
    };

    const handleLotInputChange = (raw: string) => {
      setLotText(raw);
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0.01 && parsed <= 1000) {
        onChangeLotSize(Math.round(parsed * 100) / 100);
      }
    };

    const handleLotBlur = () => {
      const parsed = Number(lotText);
      if (!Number.isFinite(parsed) || parsed < 0.01) {
        setLotText('0.01');
        onChangeLotSize(0.01);
      } else if (parsed > 1000) {
        setLotText('1000.00');
        onChangeLotSize(1000);
      } else {
        const clean = Math.round(parsed * 100) / 100;
        setLotText(clean.toFixed(2));
        onChangeLotSize(clean);
      }
    };

    const handleTrade = (direction: TradeDirection) => {
      const parsed = Number(lotText);
      const effectiveLot = Number.isFinite(parsed) ? parsed : lotSize;
      const res = onExecuteQuickOrder({
        symbol: market,
        direction,
        lotSize: effectiveLot,
        sl: null,
        tp: null,
      });
      if (!res.ok) {
        setFlashMsg({ kind: 'err', text: res.error || 'Order rejected' });
      } else {
        setFlashMsg({
          kind: 'ok',
          text: `${direction} ${effectiveLot.toFixed(2)} @ ${
            quote ? formatPrice(direction === 'BUY' ? quote.ask : quote.bid, decimals) : ''
          }`,
        });
      }
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
      flashTimerRef.current = window.setTimeout(() => {
        setFlashMsg(null);
        flashTimerRef.current = null;
      }, 1800);
    };

    return (
      <div
        data-testid="onchart-quick-trade"
        className="absolute top-[56px] left-2.5 z-20 flex flex-col gap-1"
      >
        <div className="flex items-stretch overflow-hidden rounded-lg border border-white/25 bg-[#0B0B10]/92 shadow-2xl backdrop-blur-md">
          {/* SELL Button */}
          <button
            type="button"
            disabled={!quote}
            onClick={() => handleTrade('SELL')}
            data-testid="onchart-sell-btn"
            className="flex min-w-[78px] flex-col items-center justify-center bg-[#E54855] px-2.5 py-1 text-white hover:bg-[#D63946] active:scale-[0.98] disabled:opacity-45 transition-all cursor-pointer"
          >
            <span className="text-[9px] font-bold tracking-wider uppercase leading-none">
              SELL
            </span>
            <span className="mt-0.5 font-mono-num text-[11px] font-bold leading-none">
              {quote ? formatPrice(quote.bid, decimals) : '—'}
            </span>
          </button>

          {/* Center Lot Size Stepper & Input */}
          <div className="flex items-center border-x border-white/15 bg-[#121218] px-0.5">
            <button
              type="button"
              onClick={() => adjustLot(-0.01)}
              aria-label="Decrease quick lot size"
              data-testid="onchart-lot-minus"
              className="flex h-9 w-7 items-center justify-center text-white hover:bg-white/10 cursor-pointer"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <input
              type="number"
              inputMode="decimal"
              min={0.01}
              max={1000}
              step="0.01"
              aria-label="Quick Lot Size"
              data-testid="onchart-lot-input"
              value={lotText}
              onFocus={() => {
                isFocusedRef.current = true;
              }}
              onChange={(e) => handleLotInputChange(e.target.value)}
              onBlur={() => {
                isFocusedRef.current = false;
                handleLotBlur();
              }}
              className="h-9 w-14 bg-transparent text-center font-mono-num text-xs font-bold text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              type="button"
              onClick={() => adjustLot(0.01)}
              aria-label="Increase quick lot size"
              data-testid="onchart-lot-plus"
              className="flex h-9 w-7 items-center justify-center text-white hover:bg-white/10 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* BUY Button */}
          <button
            type="button"
            disabled={!quote}
            onClick={() => handleTrade('BUY')}
            data-testid="onchart-buy-btn"
            className="flex min-w-[78px] flex-col items-center justify-center bg-[#0284C7] px-2.5 py-1 text-white hover:bg-[#0369A1] active:scale-[0.98] disabled:opacity-45 transition-all cursor-pointer"
          >
            <span className="text-[9px] font-bold tracking-wider uppercase leading-none">
              BUY
            </span>
            <span className="mt-0.5 font-mono-num text-[11px] font-bold leading-none">
              {quote ? formatPrice(quote.ask, decimals) : '—'}
            </span>
          </button>
        </div>

        {flashMsg && (
          <div
            className={`self-start rounded px-2 py-0.5 font-mono-num text-[10px] font-bold shadow ${
              flashMsg.kind === 'err'
                ? 'bg-[#E54855] text-white'
                : 'bg-[#19B87D] text-black'
            }`}
          >
            {flashMsg.text}
          </div>
        )}
      </div>
    );
  }
);

OnChartQuickTrade.displayName = 'OnChartQuickTrade';
