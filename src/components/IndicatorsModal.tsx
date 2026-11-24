import React, { useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  BUILT_IN_GROUPS,
  BuiltInIndicatorGroup,
  INDICATOR_ROOT_TABS,
  IndicatorRootTab,
} from '../modules/indicatorsManager';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

interface IndicatorsModalProps {
  open: boolean;
  onClose: () => void;
}

export const IndicatorsModal: React.FC<IndicatorsModalProps> = React.memo(({ open, onClose }) => {
  const { shouldRender, isClosing } = useAnimatedPresence(open, 155);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<IndicatorRootTab>('BUILT-IN');
  const [builtInGroup, setBuiltInGroup] = useState<BuiltInIndicatorGroup>('TECHNICAL');

  if (!shouldRender) return null;

  return (
    <div
      className={`${
        isClosing ? 'animate-lv-fade-out pointer-events-none' : 'animate-lv-fade-in'
      } fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3`}
      onClick={onClose}
    >
      <div
        className={`${
          isClosing ? 'animate-lv-modal-out' : 'animate-lv-modal-in'
        } w-full max-w-xl h-[min(460px,calc(100dvh-24px))] flex flex-col rounded-lg border border-[#141311]/30 dark:border-[#FFFFFF]/35 bg-[#FFFFFF] dark:bg-[#0F0F12] shadow-2xl overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#141311]/15 dark:border-[#FFFFFF]/15">
          <h2 className="text-xs font-bold tracking-[0.18em] text-[#141311] dark:text-[#FFFFFF]">
            INDICATORS
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Indicators"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#625D52] dark:text-[#9A9892] hover:text-[#141311] dark:hover:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Field */}
        <div className="px-4 py-2.5 border-b border-[#141311]/12 dark:border-[#FFFFFF]/12">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#625D52] dark:text-[#9A9892]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SEARCH"
              aria-label="Search indicators"
              className="w-full h-9 pl-9 pr-3 text-xs rounded-md border border-[#141311]/20 dark:border-[#FFFFFF]/25 bg-[#FBF9F4] dark:bg-[#17171B] text-[#141311] dark:text-[#F5F5F7] placeholder:text-[#625D52] dark:placeholder:text-[#7E7B74] focus:outline-none focus:border-[#141311] dark:focus:border-[#FFFFFF]"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
          {/* Left Tabs: PERSONAL, FAVORITES, BUILT-IN */}
          <nav className="sm:w-44 border-b sm:border-b-0 sm:border-r border-[#141311]/15 dark:border-[#FFFFFF]/15 bg-[#F9F7F1] dark:bg-[#0B0B0D] p-2 flex sm:flex-col gap-1 shrink-0">
            {INDICATOR_ROOT_TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 sm:flex-none px-3 py-2 text-left text-[11px] font-bold tracking-[0.12em] rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'border-[#141311]/45 dark:border-[#FFFFFF]/50 bg-[#141311]/12 dark:bg-[#FFFFFF]/15 text-[#141311] dark:text-[#FFFFFF]'
                      : 'border-transparent text-[#555046] dark:text-[#9A9892] hover:bg-[#141311]/8 dark:hover:bg-[#FFFFFF]/10'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Right Pane */}
          <div className="flex-1 flex flex-col p-4 overflow-y-auto">
            {activeTab === 'BUILT-IN' && (
              <div className="flex items-center gap-2 pb-4 border-b border-[#141311]/12 dark:border-[#FFFFFF]/12">
                {BUILT_IN_GROUPS.map((grp) => {
                  const selected = builtInGroup === grp.id;
                  return (
                    <button
                      key={grp.id}
                      type="button"
                      onClick={() => setBuiltInGroup(grp.id)}
                      className={`px-3.5 py-1.5 text-xs font-bold tracking-[0.12em] rounded-md border transition-colors cursor-pointer ${
                        selected
                          ? 'border-[#141311] dark:border-[#FFFFFF] bg-[#141311]/12 dark:bg-[#FFFFFF]/15 text-[#141311] dark:text-[#FFFFFF]'
                          : 'border-[#141311]/20 dark:border-[#FFFFFF]/20 text-[#625D52] dark:text-[#9A9892] hover:border-[#141311]/50 dark:hover:border-[#FFFFFF]/50'
                      }`}
                    >
                      {grp.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Intentionally empty catalogue per specification until entries are added */}
            <div className="flex flex-1 flex-col items-center justify-center text-center px-6 py-10">
              <p className="text-xs font-bold tracking-[0.16em] text-[#141311] dark:text-[#FFFFFF]">
                {activeTab === 'BUILT-IN' ? builtInGroup : activeTab}
              </p>
              <p className="mt-2 max-w-xs text-xs leading-relaxed text-[#625D52] dark:text-[#9A9892]">
                {search.trim()
                  ? `No indicator entries matching "${search.trim()}" are configured yet.`
                  : 'No indicator entries are loaded in this category yet. Indicator entries will appear here once configured.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

IndicatorsModal.displayName = 'IndicatorsModal';
