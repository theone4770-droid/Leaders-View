import React, { useState } from 'react';
import { Activity, Bell, Download, Rewind, X } from 'lucide-react';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

interface ThreeDotsMenuProps {
  open: boolean;
  activeAlertsCount: number;
  isReplayActive: boolean;
  canInstallApp?: boolean;
  isInstalledApp?: boolean;
  isIOS?: boolean;
  onInstallApp?: () => Promise<boolean> | void;
  onOpenIndicators: () => void;
  onOpenAlerts: () => void;
  onStartReplay: () => void;
  onClose: () => void;
}

export const ThreeDotsMenu: React.FC<ThreeDotsMenuProps> = React.memo(({
  open,
  activeAlertsCount,
  isReplayActive,
  canInstallApp = false,
  isInstalledApp = false,
  isIOS = false,
  onInstallApp,
  onOpenIndicators,
  onOpenAlerts,
  onStartReplay,
  onClose,
}) => {
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const menuAnim = useAnimatedPresence(open, 155);
  const iosAnim = useAnimatedPresence(showIOSGuide, 155);

  const showInstallItem = !isInstalledApp && (canInstallApp || isIOS);

  return (
    <>
      {menuAnim.shouldRender && (
        <div
          className={`${
            menuAnim.isClosing ? 'animate-lv-fade-out pointer-events-none' : 'animate-lv-fade-in'
          } fixed inset-0 z-40`}
          onClick={onClose}
        >
          <div
            className={`${
              menuAnim.isClosing ? 'animate-lv-modal-out' : 'animate-lv-modal-in'
            } absolute bottom-14 left-3 sm:left-56 w-52 rounded-lg border border-[#141311]/30 dark:border-[#FFFFFF]/35 bg-[#FFFFFF] dark:bg-[#101012] p-1.5 shadow-2xl`}
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

            {showInstallItem && (
              <>
                <div className="my-1 h-px bg-[#141311]/15 dark:bg-[#FFFFFF]/15" />
                <button
                  type="button"
                  role="menuitem"
                  data-testid="pwa-install-btn"
                  onClick={() => {
                    onClose();
                    if (canInstallApp && onInstallApp) {
                      void onInstallApp();
                    } else if (isIOS) {
                      setShowIOSGuide(true);
                    }
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-xs font-bold tracking-[0.1em] text-[#B08618] dark:text-[#D4AF37] hover:bg-[#D4AF37]/12 transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>INSTALL APP</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {iosAnim.shouldRender && (
        <div
          className={`${
            iosAnim.isClosing ? 'animate-lv-fade-out pointer-events-none' : 'animate-lv-fade-in'
          } fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4`}
          onClick={() => setShowIOSGuide(false)}
        >
          <div
            className={`${
              iosAnim.isClosing ? 'animate-lv-modal-out' : 'animate-lv-modal-in'
            } w-full max-w-sm rounded-xl border border-[#D4AF37]/40 bg-[#101012] p-5 text-[#F5F5F7] shadow-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-[0.12em] text-[#D4AF37]">
                INSTALL LEADERS VIEW
              </h3>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                aria-label="Close Install Guide"
                className="rounded p-1 text-[#9A9892] hover:text-[#FFFFFF] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-[#D0CEC8]">
              1. Tap the <strong>Share</strong> icon in Safari toolbar.<br />
              2. Scroll down and tap <strong>Add to Home Screen</strong>.<br />
              3. Open from your Home Screen for full-screen mode without URL bar.
            </p>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="mt-4 w-full rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/15 py-2 text-xs font-bold tracking-wider text-[#D4AF37] hover:bg-[#D4AF37]/25 cursor-pointer"
            >
              GOT IT
            </button>
          </div>
        </div>
      )}
    </>
  );
});

ThreeDotsMenu.displayName = 'ThreeDotsMenu';
