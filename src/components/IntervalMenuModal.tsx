import React from 'react';
import { X } from 'lucide-react';
import { TimeframeId } from '../types/chart';
import { INTERVAL_SECTIONS } from '../modules/timeframeManager';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

interface IntervalMenuModalProps {
  open: boolean;
  selectedInterval: TimeframeId;
  onSelectInterval: (tf: TimeframeId) => void;
  onClose: () => void;
}

export const IntervalMenuModal: React.FC<IntervalMenuModalProps> = React.memo(({
  open,
  selectedInterval,
  onSelectInterval,
  onClose,
}) => {
  const { shouldRender, isClosing } = useAnimatedPresence(open, 155);

  if (!shouldRender) return null;

  return (
    <div
      className={`${
        isClosing ? 'animate-lv-fade-out pointer-events-none' : 'animate-lv-fade-in'
      } fixed inset-0 z-50 flex items-end justify-center sm:justify-start bg-black/60 p-3 pb-14 sm:pl-24`}
      onClick={onClose}
    >
      <div
        className={`${
          isClosing ? 'animate-lv-modal-out' : 'animate-lv-modal-in'
        } w-full max-w-sm max-h-[calc(100dvh-68px)] flex flex-col rounded-lg border border-[#141311]/30 dark:border-[#FFFFFF]/35 bg-[#FFFFFF] dark:bg-[#101012] shadow-2xl overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#141311]/15 dark:border-[#FFFFFF]/15 shrink-0">
          <h2 className="text-xs font-bold tracking-[0.18em] text-[#141311] dark:text-[#FFFFFF]">
            INTERVAL
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Interval Menu"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#625D52] dark:text-[#9A9892] hover:text-[#141311] dark:hover:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-3 space-y-4">
          {INTERVAL_SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="px-1.5 pb-1.5 text-[10.5px] font-bold tracking-[0.14em] text-[#625D52] dark:text-[#9A9892]">
                {section.title}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {section.items.map((item) => {
                  const active = item.id === selectedInterval;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelectInterval(item.id);
                        onClose();
                      }}
                      className={`px-3 py-2 text-left text-xs font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                        active
                          ? 'border-[#141311] dark:border-[#FFFFFF] bg-[#141311]/12 dark:bg-[#FFFFFF]/15 text-[#141311] dark:text-[#FFFFFF] font-semibold'
                          : 'border-[#141311]/15 dark:border-[#FFFFFF]/15 bg-[#FBF9F4] dark:bg-[#151519] text-[#141311] dark:text-[#E5E4E0] hover:border-[#141311]/50 dark:hover:border-[#FFFFFF]/55'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

IntervalMenuModal.displayName = 'IntervalMenuModal';
