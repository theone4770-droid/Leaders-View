import React from 'react';
import { Activity, Bell, Rewind } from 'lucide-react';

interface ThreeDotsMenuProps {
  open: boolean;
  activeAlertsCount: number;
  isReplayActive: boolean;
  onOpenIndicators: () => void;
  onOpenAlerts: () => void;
  onStartReplay: () => void;
  onClose: () => void;
}

export const ThreeDotsMenu: React.FC<ThreeDotsMenuProps> = React.memo(({
  open,
  activeAlertsCount,
  isReplayActive,
  onOpenIndicators,
  onOpenAlerts,
  onStartReplay,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div
        className="absolute bottom-14 left-3 sm:left-56 w-52 rounded-lg border border-[#141311]/30 dark:border-[#FFFFFF]/35 bg-[#FFFFFF] dark:bg-[#101012] p-1.5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="menu"
        aria-label="Chart tools menu"
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onOpenIndicators();
            onClose();
          }}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-xs font-bold tracking-[0.1em] text-[#141311] dark:text-[#F5F5F7] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/12 hover:text-[#141311] dark:hover:text-[#FFFFFF] transition-colors cursor-pointer"
        >
          <Activity className="w-4 h-4 text-[#141311] dark:text-[#FFFFFF]" />
          <span>INDICATORS</span>
        </button>

        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onOpenAlerts();
            onClose();
          }}
          className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-xs font-bold tracking-[0.1em] text-[#141311] dark:text-[#F5F5F7] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/12 hover:text-[#141311] dark:hover:text-[#FFFFFF] transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2.5">
            <Bell className="w-4 h-4 text-[#141311] dark:text-[#FFFFFF]" />
            <span>ALERT</span>
          </span>
          {activeAlertsCount > 0 && (
            <span className="font-mono-num text-[11px] font-semibold text-[#141311] dark:text-[#FFFFFF]">
              {activeAlertsCount}
            </span>
          )}
        </button>

        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onStartReplay();
            onClose();
          }}
          className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-xs font-bold tracking-[0.1em] text-[#141311] dark:text-[#F5F5F7] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/12 hover:text-[#141311] dark:hover:text-[#FFFFFF] transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2.5">
            <Rewind className="w-4 h-4 text-[#141311] dark:text-[#FFFFFF]" />
            <span>BAR REPLAY</span>
          </span>
          {isReplayActive && (
            <span className="text-[10px] font-mono-num font-semibold text-[#141311] dark:text-[#FFFFFF]">
              ON
            </span>
          )}
        </button>
      </div>
    </div>
  );
});

ThreeDotsMenu.displayName = 'ThreeDotsMenu';
