import React from 'react';
import { Check, X } from 'lucide-react';
import { ConnectionStatus, MarketSymbol, TickerData } from '../types/chart';
import { formatPrice, MARKETS } from '../modules/timeframeManager';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

interface MarketSelectorModalProps {
  open: boolean;
  selectedMarket: MarketSymbol;
  tickers: Partial<Record<MarketSymbol, TickerData>>;
  connectionStatus: ConnectionStatus;
  onSelect: (market: MarketSymbol) => void;
  onClose: () => void;
}

const MARKET_ORDER: MarketSymbol[] = ['XAUUSD', 'BTCUSD'];

export const MarketSelectorModal: React.FC<MarketSelectorModalProps> = React.memo(({
  open,
  selectedMarket,
  tickers,
  connectionStatus,
  onSelect,
  onClose,
}) => {
  const { shouldRender, isClosing } = useAnimatedPresence(open, 155);

  if (!shouldRender) return null;

  return (
    <div
      className={`${
        isClosing ? 'animate-lv-fade-out pointer-events-none' : 'animate-lv-fade-in'
      } fixed inset-0 z-50 flex items-end justify-center sm:justify-start bg-black/60 p-3 pb-14 sm:pl-4`}
      onClick={onClose}
    >
      <div
        className={`${
          isClosing ? 'animate-lv-modal-out' : 'animate-lv-modal-in'
        } w-full max-w-md max-h-[calc(100dvh-68px)] overflow-y-auto rounded-lg border border-[#141311]/30 dark:border-[#FFFFFF]/35 bg-[#FFFFFF] dark:bg-[#101012] shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#141311]/15 dark:border-[#FFFFFF]/15">
          <div>
            <h2 className="text-xs font-bold tracking-[0.16em] text-[#141311] dark:text-[#FFFFFF]">
              MARKETS
            </h2>
            <p className="text-[11px] text-[#625D52] dark:text-[#9A9892] mt-0.5">
              FEED STATUS ·{' '}
              <span
                className={
                  connectionStatus === 'LIVE'
                    ? 'text-[#0F9D68] dark:text-[#19B87D] font-semibold'
                    : connectionStatus === 'DELAYED'
                      ? 'text-[#141311] dark:text-[#FFFFFF] font-semibold'
                      : 'text-[#D63946] dark:text-[#E54855] font-semibold'
                }
              >
                {connectionStatus}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Market Selector"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#625D52] dark:text-[#9A9892] hover:text-[#141311] dark:hover:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="divide-y divide-[#141311]/12 dark:divide-[#FFFFFF]/12">
          {MARKET_ORDER.map((sym) => {
            const meta = MARKETS[sym];
            const t = tickers[sym];
            const isSelected = sym === selectedMarket;
            const change = t?.change ?? 0;
            const changePct = t?.changePercent ?? 0;
            const isUp = change >= 0;

            return (
              <button
                key={sym}
                type="button"
                onClick={() => {
                  onSelect(sym);
                  onClose();
                }}
                className={`w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[#141311]/10 dark:bg-[#FFFFFF]/12'
                    : 'hover:bg-[#F4F0E5] dark:hover:bg-[#19191E]'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold tracking-wide text-[#141311] dark:text-[#F5F5F7]">
                      {meta.symbol}
                    </span>
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-[#141311] dark:text-[#FFFFFF]" />
                    )}
                  </div>
                  <p className="text-[11px] font-medium text-[#625D52] dark:text-[#9A9892] truncate mt-0.5">
                    {meta.description}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <div className="font-mono-num text-sm font-semibold text-[#141311] dark:text-[#F5F5F7]">
                    {t ? formatPrice(t.price, meta.decimals) : '—'}
                  </div>
                  <div
                    className={`font-mono-num text-[11px] font-medium mt-0.5 ${
                      !t
                        ? 'text-[#625D52] dark:text-[#9A9892]'
                        : isUp
                          ? 'text-[#0F9D68] dark:text-[#19B87D]'
                          : 'text-[#D63946] dark:text-[#E54855]'
                    }`}
                  >
                    {t
                      ? `${isUp ? '+' : ''}${formatPrice(change, meta.decimals)} (${
                          isUp ? '+' : ''
                        }${changePct.toFixed(2)}%)`
                      : 'CONNECTING...'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});

MarketSelectorModal.displayName = 'MarketSelectorModal';
