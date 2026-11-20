import { DrawingObject, MarketSymbol } from '../types/chart';

export interface MarketHistoryStack {
  past: DrawingObject[][];
  present: DrawingObject[];
  future: DrawingObject[][];
}

export type AllMarketHistory = Record<MarketSymbol, MarketHistoryStack>;

const MAX_HISTORY_STEPS = 120;

function cloneDrawings(drawings: DrawingObject[]): DrawingObject[] {
  return drawings.map((d) => ({
    ...d,
    points: d.points.map((p) => ({ ...p })),
    style: { ...d.style },
    meta: d.meta ? { ...d.meta } : undefined,
  }));
}

export function createInitialHistory(
  xauDrawings: DrawingObject[],
  btcDrawings: DrawingObject[]
): AllMarketHistory {
  return {
    XAUUSD: { past: [], present: cloneDrawings(xauDrawings), future: [] },
    BTCUSD: { past: [], present: cloneDrawings(btcDrawings), future: [] },
  };
}

export function commitDrawingChange(
  history: AllMarketHistory,
  market: MarketSymbol,
  nextDrawings: DrawingObject[]
): AllMarketHistory {
  const current = history[market];
  const past = [...current.past, cloneDrawings(current.present)];
  if (past.length > MAX_HISTORY_STEPS) {
    past.shift();
  }
  return {
    ...history,
    [market]: {
      past,
      present: cloneDrawings(nextDrawings),
      future: [],
    },
  };
}

/** Update live drag/resize preview without pushing intermediate frames onto undo history */
export function replacePresentWithoutCommit(
  history: AllMarketHistory,
  market: MarketSymbol,
  nextDrawings: DrawingObject[]
): AllMarketHistory {
  const current = history[market];
  return {
    ...history,
    [market]: {
      ...current,
      present: cloneDrawings(nextDrawings),
    },
  };
}

/** Push a pre-captured snapshot onto past when finishing a drag/resize */
export function commitFromSnapshot(
  history: AllMarketHistory,
  market: MarketSymbol,
  beforeSnapshot: DrawingObject[],
  afterDrawings: DrawingObject[]
): AllMarketHistory {
  const current = history[market];
  const past = [...current.past, cloneDrawings(beforeSnapshot)];
  if (past.length > MAX_HISTORY_STEPS) {
    past.shift();
  }
  return {
    ...history,
    [market]: {
      past,
      present: cloneDrawings(afterDrawings),
      future: [],
    },
  };
}

export function undoMarketHistory(
  history: AllMarketHistory,
  market: MarketSymbol
): AllMarketHistory {
  const current = history[market];
  if (current.past.length === 0) return history;
  const previous = current.past[current.past.length - 1];
  const newPast = current.past.slice(0, -1);
  return {
    ...history,
    [market]: {
      past: newPast,
      present: cloneDrawings(previous),
      future: [cloneDrawings(current.present), ...current.future],
    },
  };
}

export function redoMarketHistory(
  history: AllMarketHistory,
  market: MarketSymbol
): AllMarketHistory {
  const current = history[market];
  if (current.future.length === 0) return history;
  const next = current.future[0];
  const newFuture = current.future.slice(1);
  return {
    ...history,
    [market]: {
      past: [...current.past, cloneDrawings(current.present)],
      present: cloneDrawings(next),
      future: newFuture,
    },
  };
}

export function canUndo(history: AllMarketHistory, market: MarketSymbol): boolean {
  return history[market].past.length > 0;
}

export function canRedo(history: AllMarketHistory, market: MarketSymbol): boolean {
  return history[market].future.length > 0;
}
