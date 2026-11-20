import { Candle, ReplaySpeed, ReplayState } from '../types/chart';

export const REPLAY_SPEEDS: ReplaySpeed[] = [0.1, 0.2, 0.3, 0.5, 1, 3, 5, 7, 10];

export const DEFAULT_REPLAY_STATE: ReplayState = {
  mode: 'OFF',
  cutIndex: null,
  speed: 1,
};

/** Interval in milliseconds between stepped historical candles at a given speed (1X = 1 candle/sec) */
export function getReplayStepIntervalMs(speed: ReplaySpeed): number {
  return Math.max(80, Math.round(1000 / speed));
}

export function getVisibleReplayCandles(allCandles: Candle[], replay: ReplayState): Candle[] {
  if (replay.mode === 'OFF' || replay.mode === 'SELECTING' || replay.cutIndex === null) {
    return allCandles;
  }
  const clamped = Math.max(1, Math.min(allCandles.length - 1, replay.cutIndex));
  return allCandles.slice(0, clamped + 1);
}

export function stepReplayForward(replay: ReplayState, totalCandles: number): ReplayState {
  if (replay.cutIndex === null) return replay;
  const maxIndex = Math.max(0, totalCandles - 1);
  if (replay.cutIndex >= maxIndex) {
    return { ...replay, cutIndex: maxIndex, mode: 'PAUSED' };
  }
  return {
    ...replay,
    cutIndex: replay.cutIndex + 1,
  };
}

export function stepReplayBackward(replay: ReplayState): ReplayState {
  if (replay.cutIndex === null) return replay;
  const nextIndex = Math.max(1, replay.cutIndex - 1);
  return {
    ...replay,
    mode: replay.mode === 'PLAYING' ? 'PAUSED' : replay.mode,
    cutIndex: nextIndex,
  };
}
