import React, { useRef } from 'react';
import { Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { ReplaySpeed, ReplayState } from '../types/chart';
import { REPLAY_SPEEDS } from '../modules/barReplayManager';
import { useAnimatedPresence } from '../hooks/useAnimatedPresence';

interface BarReplayControlsProps {
  replay: ReplayState;
  totalCandles: number;
  onPlay: () => void;
  onPause: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onChangeSpeed: (speed: ReplaySpeed) => void;
  onExit: () => void;
}

export const BarReplayControls: React.FC<BarReplayControlsProps> = React.memo(({
  replay,
  totalCandles,
  onPlay,
  onPause,
  onStepForward,
  onStepBackward,
  onChangeSpeed,
  onExit,
}) => {
  const { shouldRender, isClosing } = useAnimatedPresence(replay.mode !== 'OFF', 145);
  const lastModeRef = useRef<ReplayState['mode']>(replay.mode);
  if (replay.mode !== 'OFF') {
    lastModeRef.current = replay.mode;
  }
  const activeMode = replay.mode !== 'OFF' ? replay.mode : lastModeRef.current;

  if (!shouldRender || activeMode === 'OFF') return null;

  if (activeMode === 'SELECTING') {
    return (
      <div
        data-testid="bar-replay-select-banner"
        className={`lv-gpu-layer ${
          isClosing ? 'animate-lv-panel-out pointer-events-none' : 'animate-lv-panel-in'
        } fixed top-3 left-1/2 -translate-x-1/2 z-30 flex flex-nowrap items-center gap-2.5 w-max max-w-[calc(100vw-16px)] overflow-x-auto no-scrollbar whitespace-nowrap rounded-lg border border-[#FFFFFF]/45 bg-[#0D0D10]/96 px-3.5 py-1.5 text-xs text-[#F5F5F7] shadow-2xl select-none`}
      >
        <span className="shrink-0 font-bold tracking-[0.14em] text-[#FFFFFF]">BAR REPLAY</span>
        <span className="shrink-0 text-[#C7C4BC]">TAP OR CLICK ANY HISTORICAL CANDLE TO SET START POINT</span>
        <button
          type="button"
          onClick={onExit}
          className="flex shrink-0 items-center gap-1 rounded border border-[#FFFFFF]/35 px-2 py-1 text-[11px] font-bold text-[#FFFFFF] hover:bg-[#FFFFFF]/15 active:scale-95 transition-transform cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
          <span>CANCEL</span>
        </button>
      </div>
    );
  }

  const isPlaying = activeMode === 'PLAYING';
  const currentBar = (replay.cutIndex ?? 0) + 1;

  return (
    <div
      data-testid="bar-replay-controls"
      className={`lv-gpu-layer ${
        isClosing ? 'animate-lv-panel-out pointer-events-none' : 'animate-lv-panel-in'
      } fixed bottom-14 left-1/2 -translate-x-1/2 z-30 flex flex-nowrap items-center gap-1.5 w-max max-w-[calc(100vw-16px)] overflow-x-auto no-scrollbar whitespace-nowrap rounded-lg border border-[#141311]/30 dark:border-[#FFFFFF]/40 bg-[#FFFFFF]/96 dark:bg-[#0E0E11]/96 px-3 py-1.5 shadow-2xl select-none`}
    >
      <span className="shrink-0 text-[10.5px] font-bold tracking-[0.14em] text-[#141311] dark:text-[#FFFFFF] mr-0.5">
        BAR REPLAY
      </span>

      {/* STEP BACKWARD */}
      <button
        type="button"
        onClick={onStepBackward}
        title="STEP BACKWARD"
        aria-label="Step Backward"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#141311]/25 dark:border-[#FFFFFF]/25 text-[#141311] dark:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/15 cursor-pointer"
      >
        <SkipBack className="w-3.5 h-3.5" />
      </button>

      {/* PLAY / PAUSE */}
      <button
        type="button"
        onClick={isPlaying ? onPause : onPlay}
        title={isPlaying ? 'PAUSE' : 'PLAY'}
        aria-label={isPlaying ? 'Pause Replay' : 'Play Replay'}
        className="flex h-7 shrink-0 items-center gap-1.5 px-2.5 rounded-md bg-[#141311] hover:bg-[#2A2824] dark:bg-[#FFFFFF] dark:hover:bg-[#E5E5E7] text-[#FFFFFF] dark:text-[#080808] text-[11px] font-bold tracking-wider cursor-pointer"
      >
        {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        <span>{isPlaying ? 'PAUSE' : 'PLAY'}</span>
      </button>

      {/* STEP FORWARD */}
      <button
        type="button"
        onClick={onStepForward}
        title="STEP FORWARD"
        aria-label="Step Forward"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#141311]/25 dark:border-[#FFFFFF]/25 text-[#141311] dark:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/15 cursor-pointer"
      >
        <SkipForward className="w-3.5 h-3.5" />
      </button>

      {/* SPEED SELECTOR (EXACT 9 SPEEDS: 0.1X .. 10X) */}
      <select
        value={replay.speed}
        onChange={(e) => onChangeSpeed(Number(e.target.value) as ReplaySpeed)}
        aria-label="Replay Speed"
        data-testid="replay-speed-select"
        className="h-7 shrink-0 px-2 rounded-md border border-[#141311]/30 dark:border-[#FFFFFF]/30 bg-[#FBF9F4] dark:bg-[#17171B] font-mono-num text-[11px] font-bold text-[#141311] dark:text-[#FFFFFF] focus:outline-none focus:border-[#141311] dark:focus:border-[#FFFFFF] cursor-pointer"
      >
        {REPLAY_SPEEDS.map((sp) => (
          <option key={sp} value={sp}>
            {sp}X
          </option>
        ))}
      </select>

      <span className="shrink-0 font-mono-num text-[11px] text-[#625D52] dark:text-[#9A9892] px-1">
        {currentBar}/{totalCandles}
      </span>

      {/* EXIT REPLAY */}
      <button
        type="button"
        onClick={onExit}
        className="flex h-7 shrink-0 items-center gap-1 px-2 rounded-md border border-[#D63946]/45 text-[#D63946] dark:text-[#E54855] hover:bg-[#E54855]/12 text-[10.5px] font-bold tracking-wider cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
        <span>EXIT REPLAY</span>
      </button>
    </div>
  );
});

BarReplayControls.displayName = 'BarReplayControls';
