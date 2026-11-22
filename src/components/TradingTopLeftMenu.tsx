import React from 'react';
import { AlarmClock, History } from 'lucide-react';
import { TradingScreen } from '../types/trading';

interface TradingTopLeftMenuProps {
  activeScreen: TradingScreen;
  onSelectScreen: (screen: TradingScreen) => void;
}

/** Custom MetaTrader-style Trade icon: two vertical up/down arrows flanking a dollar symbol */
const TradeArrowsDollarIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {/* Left Up Arrow */}
    <path d="M5 19V5" />
    <path d="M2.5 7.5L5 5l2.5 2.5" />
    {/* Center Dollar Sign */}
    <path d="M12 6v12" />
    <path d="M14.4 8.7c0-1.1-1.05-1.95-2.4-1.95s-2.4.85-2.4 1.95c0 1.25 1.15 1.75 2.4 2.15 1.25.4 2.4.95 2.4 2.2 0 1.2-1.05 2.05-2.4 2.05s-2.4-.85-2.4-2.05" />
    {/* Right Down Arrow */}
    <path d="M19 5v14" />
    <path d="M16.5 16.5L19 19l2.5-2.5" />
  </svg>
);

export const TradingTopLeftMenu: React.FC<TradingTopLeftMenuProps> = React.memo(
  ({ activeScreen, onSelectScreen }) => {
    const toggle = (target: Exclude<TradingScreen, 'NONE'>) => {
      onSelectScreen(activeScreen === target ? 'NONE' : target);
    };

    const btnClass = (target: Exclude<TradingScreen, 'NONE'>) =>
      `relative flex h-10 w-10 items-center justify-center rounded-md transition-colors cursor-pointer text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
        activeScreen === target ? 'bg-white/15 ring-1 ring-[#D4AF37]' : ''
      }`;

    return (
      <nav
        aria-label="Trading Top-Left Menu"
        data-testid="trading-top-left-menu"
        className="absolute top-2.5 left-2.5 z-30 flex items-center gap-0.5 rounded-lg border border-white/25 bg-[#0C0C0F]/85 p-0.5 shadow-xl backdrop-blur-md"
      >
        {/* 1. Trade Icon: Two vertical up/down arrows with dollar symbol */}
        <button
          type="button"
          onClick={() => toggle('TRADE')}
          aria-label="Trade"
          title="Trade"
          data-testid="top-left-trade-btn"
          className={btnClass('TRADE')}
        >
          <TradeArrowsDollarIcon className="w-5 h-5 text-white" />
        </button>

        {/* 2. Pending Orders Icon: Normal alarm clock */}
        <button
          type="button"
          onClick={() => toggle('PENDING')}
          aria-label="Pending Orders"
          title="Pending Orders"
          data-testid="top-left-pending-btn"
          className={btnClass('PENDING')}
        >
          <AlarmClock className="w-[19px] h-[19px] text-white" strokeWidth={2} />
        </button>

        {/* 3. History Icon: Clock with circular curved arrow */}
        <button
          type="button"
          onClick={() => toggle('HISTORY')}
          aria-label="History"
          title="History"
          data-testid="top-left-history-btn"
          className={btnClass('HISTORY')}
        >
          <History className="w-[19px] h-[19px] text-white" strokeWidth={2} />
        </button>
      </nav>
    );
  }
);

TradingTopLeftMenu.displayName = 'TradingTopLeftMenu';
