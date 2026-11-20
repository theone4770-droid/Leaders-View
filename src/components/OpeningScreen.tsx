import React, { useEffect, useRef, useState } from 'react';

interface OpeningScreenProps {
  isReady?: boolean;
  onComplete: () => void;
}

export const OpeningScreen: React.FC<OpeningScreenProps> = ({ isReady = false, onComplete }) => {
  const [exiting, setExiting] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const minTimer = window.setTimeout(() => setMinElapsed(true), 220);
    // Hard safety cap so opening screen never lingers even on slow networks
    const capTimer = window.setTimeout(() => setExiting(true), 500);
    return () => {
      clearTimeout(minTimer);
      clearTimeout(capTimer);
    };
  }, []);

  useEffect(() => {
    if (minElapsed && isReady) {
      setExiting(true);
    }
  }, [minElapsed, isReady]);

  useEffect(() => {
    if (!exiting) return;
    const doneTimer = window.setTimeout(() => onCompleteRef.current(), 200);
    return () => clearTimeout(doneTimer);
  }, [exiting]);

  return (
    <div
      onClick={onComplete}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onComplete();
      }}
      aria-label="Enter LEADERS VIEW"
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#060607] select-none cursor-pointer transition-opacity duration-200 ${
        exiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Subtle architectural white grid frame */}
      <div
        className="pointer-events-none absolute inset-6 border border-[#FFFFFF]/20"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 45%, rgba(255, 255, 255, 0.1) 0%, rgba(8, 8, 8, 0) 58%)',
        }}
        aria-hidden="true"
      />

      <div className="relative flex flex-col items-center gap-6 px-8 text-center">
        {/* App Logo */}
        <div className="relative flex h-24 w-24 items-center justify-center rounded-2xl border border-[#D4AF37]/35 bg-[#080808] shadow-[0_0_40px_rgba(212,175,55,0.2)] overflow-hidden">
          <img
            src="/assets/aistudio/file_000000001a488208b6099279793e33f1_d26a340a.png"
            alt="LEADERS VIEW Logo"
            className="h-full w-full object-cover"
          />
        </div>

        {/* Brand Wordmark */}
        <div className="space-y-2.5">
          <h1 className="font-brand text-3xl sm:text-5xl font-bold tracking-[0.26em] text-transparent bg-clip-text bg-gradient-to-b from-[#FFFFFF] via-[#E5E5E7] to-[#9A9892]">
            LEADERS VIEW
          </h1>
          <p className="text-xs sm:text-sm tracking-[0.28em] text-[#9A9892] uppercase">
            PRECISION MARKET CHARTING
          </p>
        </div>

        {/* Minimal white shimmer progress bar */}
        <div className="mt-2 h-[2px] w-48 overflow-hidden bg-[#FFFFFF]/15">
          <div className="h-full w-2/5 bg-gradient-to-r from-transparent via-[#FFFFFF] to-transparent animate-lv-shimmer" />
        </div>
      </div>
    </div>
  );
};
