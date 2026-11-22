import { MarketSymbol } from '../types/chart';
import {
  CalendarFilterState,
  ClosedPositionRecord,
  DealHistoryRecord,
  HistorySortOption,
  HistorySymbolFilter,
  MarketBidAskQuote,
  OpenPosition,
  OrderHistoryRecord,
  PendingOrder,
  PendingOrderType,
  TradeDirection,
  TradingAccountState,
} from '../types/trading';
import {
  computeClosedPnL,
  INSTRUMENT_SPREAD_CONFIG,
  roundToInstrument,
  roundUSD,
} from './spreadEngine';

let idSeq = 0;
function makeId(prefix: string): string {
  idSeq += 1;
  return `${prefix}_${Date.now()}_${idSeq}_${Math.random().toString(36).slice(2, 6)}`;
}

export function getDirectionForPendingType(type: PendingOrderType): TradeDirection {
  return type.startsWith('BUY') ? 'BUY' : 'SELL';
}

export function formatOrderTypeLabel(type: string): string {
  switch (type) {
    case 'BUY':
      return 'Market Buy';
    case 'SELL':
      return 'Market Sell';
    case 'BUY_STOP':
      return 'Buy Stop';
    case 'SELL_STOP':
      return 'Sell Stop';
    case 'BUY_LIMIT':
      return 'Buy Limit';
    case 'SELL_LIMIT':
      return 'Sell Limit';
    case 'BUY_STOP_LIMIT':
      return 'Buy Stop Limit';
    case 'SELL_STOP_LIMIT':
      return 'Sell Stop Limit';
    default:
      return type;
  }
}

export function validateLotSize(lot: number): { valid: boolean; normalized: number; error?: string } {
  if (!Number.isFinite(lot) || lot <= 0) {
    return { valid: false, normalized: 0, error: 'Enter a valid lot size (0.01 – 1000).' };
  }
  const normalized = Math.round(lot * 100) / 100;
  if (normalized < 0.01 || normalized > 1000) {
    return { valid: false, normalized, error: 'Lot size must be between 0.01 and 1000.' };
  }
  return { valid: true, normalized };
}

export function validateSlTp(
  direction: TradeDirection,
  referencePrice: number,
  sl: number | null,
  tp: number | null
): { valid: boolean; error?: string } {
  if (sl !== null) {
    if (!Number.isFinite(sl) || sl <= 0) {
      return { valid: false, error: 'Stop Loss price must be greater than 0.' };
    }
    if (direction === 'BUY' && sl >= referencePrice) {
      return { valid: false, error: 'For BUY, Stop Loss must be below price.' };
    }
    if (direction === 'SELL' && sl <= referencePrice) {
      return { valid: false, error: 'For SELL, Stop Loss must be above price.' };
    }
  }
  if (tp !== null) {
    if (!Number.isFinite(tp) || tp <= 0) {
      return { valid: false, error: 'Take Profit price must be greater than 0.' };
    }
    if (direction === 'BUY' && tp <= referencePrice) {
      return { valid: false, error: 'For BUY, Take Profit must be above price.' };
    }
    if (direction === 'SELL' && tp >= referencePrice) {
      return { valid: false, error: 'For SELL, Take Profit must be below price.' };
    }
  }
  return { valid: true };
}

export function executeMarketOrder(
  state: TradingAccountState,
  params: {
    symbol: MarketSymbol;
    direction: TradeDirection;
    lotSize: number;
    sl: number | null;
    tp: number | null;
    quote: MarketBidAskQuote;
    nowMs?: number;
  }
): { ok: boolean; nextState: TradingAccountState; position?: OpenPosition; error?: string } {
  if (!state.activeBuySell) {
    return { ok: false, nextState: state, error: 'Active BUY/SELL is OFF. Turn it ON to trade.' };
  }
  const lotCheck = validateLotSize(params.lotSize);
  if (!lotCheck.valid) {
    return { ok: false, nextState: state, error: lotCheck.error };
  }

  const now = params.nowMs ?? Date.now();
  const cfg = INSTRUMENT_SPREAD_CONFIG[params.symbol];
  // MetaTrader execution: BUY opens at ASK, SELL opens at BID
  const execPrice = roundToInstrument(
    params.direction === 'BUY' ? params.quote.ask : params.quote.bid,
    cfg.decimals
  );
  const cleanSl = params.sl !== null ? roundToInstrument(params.sl, cfg.decimals) : null;
  const cleanTp = params.tp !== null ? roundToInstrument(params.tp, cfg.decimals) : null;

  const slTpCheck = validateSlTp(params.direction, execPrice, cleanSl, cleanTp);
  if (!slTpCheck.valid) {
    return { ok: false, nextState: state, error: slTpCheck.error };
  }

  const orderId = makeId('ord');
  const posId = makeId('pos');
  const dealId = makeId('deal');

  const position: OpenPosition = {
    id: posId,
    symbol: params.symbol,
    direction: params.direction,
    lotSize: lotCheck.normalized,
    entryPrice: execPrice,
    sl: cleanSl,
    tp: cleanTp,
    openedAt: now,
    sourceOrderId: orderId,
  };

  const orderRec: OrderHistoryRecord = {
    id: orderId,
    symbol: params.symbol,
    direction: params.direction,
    orderType: params.direction,
    lotSize: lotCheck.normalized,
    requestedPrice: execPrice,
    limitPrice: null,
    executedPrice: execPrice,
    sl: cleanSl,
    tp: cleanTp,
    createdAt: now,
    updatedAt: now,
    status: 'Filled',
    note: `Spread ${params.quote.spread.toFixed(cfg.decimals)} (Simulated Standard)`,
  };

  const dealRec: DealHistoryRecord = {
    id: dealId,
    orderId,
    positionId: posId,
    symbol: params.symbol,
    direction: params.direction,
    dealType: 'IN',
    lotSize: lotCheck.normalized,
    executedPrice: execPrice,
    executedAt: now,
    profitLoss: null,
  };

  return {
    ok: true,
    position,
    nextState: {
      ...state,
      openPositions: [position, ...state.openPositions],
      orderHistory: [orderRec, ...state.orderHistory],
      dealHistory: [dealRec, ...state.dealHistory],
    },
  };
}

export function closeOpenPosition(
  state: TradingAccountState,
  params: {
    positionId: string;
    quote: MarketBidAskQuote;
    reason?: 'MANUAL' | 'SL' | 'TP';
    overrideExitPrice?: number;
    nowMs?: number;
  }
): { ok: boolean; nextState: TradingAccountState; closed?: ClosedPositionRecord; error?: string } {
  const pos = state.openPositions.find((p) => p.id === params.positionId);
  if (!pos) {
    return { ok: false, nextState: state, error: 'Position not found.' };
  }
  const now = params.nowMs ?? Date.now();
  const cfg = INSTRUMENT_SPREAD_CONFIG[pos.symbol];
  // MetaTrader execution: BUY closes at BID, SELL closes at ASK
  const rawExit =
    typeof params.overrideExitPrice === 'number' && Number.isFinite(params.overrideExitPrice)
      ? params.overrideExitPrice
      : pos.direction === 'BUY'
        ? params.quote.bid
        : params.quote.ask;
  const exitPrice = roundToInstrument(rawExit, cfg.decimals);
  const pnl = computeClosedPnL(pos.symbol, pos.direction, pos.lotSize, pos.entryPrice, exitPrice);
  const nextBalance = roundUSD(state.balanceUSD + pnl);

  const closeOrderId = makeId('ord');
  const closeDealId = makeId('deal');
  const closedRec: ClosedPositionRecord = {
    id: makeId('histpos'),
    positionId: pos.id,
    symbol: pos.symbol,
    direction: pos.direction,
    lotSize: pos.lotSize,
    entryPrice: pos.entryPrice,
    exitPrice,
    sl: pos.sl,
    tp: pos.tp,
    openedAt: pos.openedAt,
    closedAt: now,
    profitLoss: pnl,
    closeReason: params.reason ?? 'MANUAL',
  };

  const closeDirection: TradeDirection = pos.direction === 'BUY' ? 'SELL' : 'BUY';
  const closeOrderRec: OrderHistoryRecord = {
    id: closeOrderId,
    symbol: pos.symbol,
    direction: closeDirection,
    orderType: closeDirection,
    lotSize: pos.lotSize,
    requestedPrice: exitPrice,
    limitPrice: null,
    executedPrice: exitPrice,
    sl: null,
    tp: null,
    createdAt: now,
    updatedAt: now,
    status: 'Filled',
    note: `Close ${pos.direction} (${params.reason ?? 'MANUAL'})`,
  };

  const closeDealRec: DealHistoryRecord = {
    id: closeDealId,
    orderId: closeOrderId,
    positionId: pos.id,
    symbol: pos.symbol,
    direction: closeDirection,
    dealType: 'OUT',
    lotSize: pos.lotSize,
    executedPrice: exitPrice,
    executedAt: now,
    profitLoss: pnl,
  };

  const ledgerEntry = {
    id: makeId('ledger'),
    timestamp: now,
    type: 'REALIZED_PNL' as const,
    symbol: pos.symbol,
    description: `${pos.symbol} ${pos.direction} ${pos.lotSize.toFixed(2)} Closed (${params.reason ?? 'MANUAL'})`,
    amount: pnl,
    balanceAfter: nextBalance,
  };

  return {
    ok: true,
    closed: closedRec,
    nextState: {
      ...state,
      balanceUSD: nextBalance,
      openPositions: state.openPositions.filter((p) => p.id !== pos.id),
      positionHistory: [closedRec, ...state.positionHistory],
      orderHistory: [closeOrderRec, ...state.orderHistory],
      dealHistory: [closeDealRec, ...state.dealHistory],
      ledger: [ledgerEntry, ...state.ledger],
    },
  };
}

export function modifyOpenPositionSlTp(
  state: TradingAccountState,
  params: {
    positionId: string;
    sl: number | null;
    tp: number | null;
    quote: MarketBidAskQuote | null;
  }
): { ok: boolean; nextState: TradingAccountState; error?: string } {
  const pos = state.openPositions.find((p) => p.id === params.positionId);
  if (!pos) {
    return { ok: false, nextState: state, error: 'Open position not found.' };
  }
  const cfg = INSTRUMENT_SPREAD_CONFIG[pos.symbol];
  const cleanSl = params.sl !== null ? roundToInstrument(params.sl, cfg.decimals) : null;
  const cleanTp = params.tp !== null ? roundToInstrument(params.tp, cfg.decimals) : null;

  const refPrice = params.quote
    ? pos.direction === 'BUY'
      ? params.quote.bid
      : params.quote.ask
    : pos.entryPrice;

  const check = validateSlTp(pos.direction, refPrice, cleanSl, cleanTp);
  if (!check.valid) {
    return { ok: false, nextState: state, error: check.error };
  }

  return {
    ok: true,
    nextState: {
      ...state,
      openPositions: state.openPositions.map((p) =>
        p.id === pos.id ? { ...p, sl: cleanSl, tp: cleanTp } : p
      ),
    },
  };
}

export function validatePendingPrices(params: {
  orderType: PendingOrderType;
  entryPrice: number;
  limitPrice: number | null;
  sl: number | null;
  tp: number | null;
  quote: MarketBidAskQuote;
}): { valid: boolean; error?: string } {
  const { orderType, entryPrice, limitPrice, sl, tp, quote } = params;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return { valid: false, error: 'Entry price must be greater than 0.' };
  }

  switch (orderType) {
    case 'BUY_LIMIT':
      if (entryPrice >= quote.ask) {
        return { valid: false, error: 'Buy Limit price must be below current Ask.' };
      }
      break;
    case 'SELL_LIMIT':
      if (entryPrice <= quote.bid) {
        return { valid: false, error: 'Sell Limit price must be above current Bid.' };
      }
      break;
    case 'BUY_STOP':
      if (entryPrice <= quote.ask) {
        return { valid: false, error: 'Buy Stop price must be above current Ask.' };
      }
      break;
    case 'SELL_STOP':
      if (entryPrice >= quote.bid) {
        return { valid: false, error: 'Sell Stop price must be below current Bid.' };
      }
      break;
    case 'BUY_STOP_LIMIT':
      if (entryPrice <= quote.ask) {
        return { valid: false, error: 'Buy Stop Limit trigger price must be above current Ask.' };
      }
      if (limitPrice === null || !Number.isFinite(limitPrice) || limitPrice <= 0) {
        return { valid: false, error: 'Enter a valid Limit price for Buy Stop Limit.' };
      }
      if (limitPrice >= entryPrice) {
        return { valid: false, error: 'Buy Stop Limit price must be below trigger price.' };
      }
      break;
    case 'SELL_STOP_LIMIT':
      if (entryPrice >= quote.bid) {
        return { valid: false, error: 'Sell Stop Limit trigger price must be below current Bid.' };
      }
      if (limitPrice === null || !Number.isFinite(limitPrice) || limitPrice <= 0) {
        return { valid: false, error: 'Enter a valid Limit price for Sell Stop Limit.' };
      }
      if (limitPrice <= entryPrice) {
        return { valid: false, error: 'Sell Stop Limit price must be above trigger price.' };
      }
      break;
  }

  const direction = getDirectionForPendingType(orderType);
  const execRef =
    orderType === 'BUY_STOP_LIMIT' || orderType === 'SELL_STOP_LIMIT'
      ? (limitPrice ?? entryPrice)
      : entryPrice;

  return validateSlTp(direction, execRef, sl, tp);
}

export function createPendingOrder(
  state: TradingAccountState,
  params: {
    symbol: MarketSymbol;
    orderType: PendingOrderType;
    lotSize: number;
    entryPrice: number;
    limitPrice: number | null;
    sl: number | null;
    tp: number | null;
    expiresAt: number | null;
    quote: MarketBidAskQuote;
    nowMs?: number;
  }
): { ok: boolean; nextState: TradingAccountState; order?: PendingOrder; error?: string } {
  const lotCheck = validateLotSize(params.lotSize);
  if (!lotCheck.valid) {
    return { ok: false, nextState: state, error: lotCheck.error };
  }

  const now = params.nowMs ?? Date.now();
  const cfg = INSTRUMENT_SPREAD_CONFIG[params.symbol];
  const entryPrice = roundToInstrument(params.entryPrice, cfg.decimals);
  const isStopLimit =
    params.orderType === 'BUY_STOP_LIMIT' || params.orderType === 'SELL_STOP_LIMIT';
  const limitPrice =
    isStopLimit && params.limitPrice !== null
      ? roundToInstrument(params.limitPrice, cfg.decimals)
      : null;
  const cleanSl = params.sl !== null ? roundToInstrument(params.sl, cfg.decimals) : null;
  const cleanTp = params.tp !== null ? roundToInstrument(params.tp, cfg.decimals) : null;

  if (params.expiresAt !== null && params.expiresAt <= now) {
    return { ok: false, nextState: state, error: 'Expiration time must be in the future.' };
  }

  const priceCheck = validatePendingPrices({
    orderType: params.orderType,
    entryPrice,
    limitPrice,
    sl: cleanSl,
    tp: cleanTp,
    quote: params.quote,
  });
  if (!priceCheck.valid) {
    return { ok: false, nextState: state, error: priceCheck.error };
  }

  const direction = getDirectionForPendingType(params.orderType);
  const orderId = makeId('pord');

  const pendingOrder: PendingOrder = {
    id: orderId,
    symbol: params.symbol,
    orderType: params.orderType,
    direction,
    lotSize: lotCheck.normalized,
    entryPrice,
    limitPrice,
    stopTriggered: false,
    sl: cleanSl,
    tp: cleanTp,
    expiresAt: params.expiresAt,
    createdAt: now,
    status: 'Pending',
  };

  const orderHistRec: OrderHistoryRecord = {
    id: orderId,
    symbol: params.symbol,
    direction,
    orderType: params.orderType,
    lotSize: lotCheck.normalized,
    requestedPrice: entryPrice,
    limitPrice,
    executedPrice: null,
    sl: cleanSl,
    tp: cleanTp,
    createdAt: now,
    updatedAt: now,
    status: 'Pending',
  };

  return {
    ok: true,
    order: pendingOrder,
    nextState: {
      ...state,
      pendingOrders: [pendingOrder, ...state.pendingOrders],
      orderHistory: [orderHistRec, ...state.orderHistory],
    },
  };
}

export function modifyPendingOrder(
  state: TradingAccountState,
  params: {
    orderId: string;
    entryPrice: number;
    limitPrice: number | null;
    sl: number | null;
    tp: number | null;
    quote: MarketBidAskQuote | null;
    nowMs?: number;
  }
): { ok: boolean; nextState: TradingAccountState; error?: string } {
  const existing = state.pendingOrders.find((o) => o.id === params.orderId);
  if (!existing) {
    return { ok: false, nextState: state, error: 'Pending order no longer active.' };
  }

  const cfg = INSTRUMENT_SPREAD_CONFIG[existing.symbol];
  const entryPrice = roundToInstrument(params.entryPrice, cfg.decimals);
  const isStopLimit =
    existing.orderType === 'BUY_STOP_LIMIT' || existing.orderType === 'SELL_STOP_LIMIT';
  const limitPrice =
    isStopLimit && params.limitPrice !== null
      ? roundToInstrument(params.limitPrice, cfg.decimals)
      : existing.limitPrice;
  const cleanSl = params.sl !== null ? roundToInstrument(params.sl, cfg.decimals) : null;
  const cleanTp = params.tp !== null ? roundToInstrument(params.tp, cfg.decimals) : null;

  if (params.quote) {
    const check = validatePendingPrices({
      orderType: existing.orderType,
      entryPrice,
      limitPrice,
      sl: cleanSl,
      tp: cleanTp,
      quote: params.quote,
    });
    if (!check.valid) {
      return { ok: false, nextState: state, error: check.error };
    }
  } else {
    const slTp = validateSlTp(existing.direction, limitPrice ?? entryPrice, cleanSl, cleanTp);
    if (!slTp.valid) {
      return { ok: false, nextState: state, error: slTp.error };
    }
  }

  const now = params.nowMs ?? Date.now();
  return {
    ok: true,
    nextState: {
      ...state,
      pendingOrders: state.pendingOrders.map((o) =>
        o.id === existing.id
          ? {
              ...o,
              entryPrice,
              limitPrice,
              stopTriggered: o.entryPrice === entryPrice ? o.stopTriggered : false,
              sl: cleanSl,
              tp: cleanTp,
            }
          : o
      ),
      orderHistory: state.orderHistory.map((h) =>
        h.id === existing.id
          ? {
              ...h,
              requestedPrice: entryPrice,
              limitPrice,
              sl: cleanSl,
              tp: cleanTp,
              updatedAt: now,
            }
          : h
      ),
    },
  };
}

export function cancelPendingOrder(
  state: TradingAccountState,
  orderId: string,
  nowMs: number = Date.now()
): { ok: boolean; nextState: TradingAccountState } {
  const existing = state.pendingOrders.find((o) => o.id === orderId);
  if (!existing) {
    return { ok: false, nextState: state };
  }

  return {
    ok: true,
    nextState: {
      ...state,
      pendingOrders: state.pendingOrders.filter((o) => o.id !== orderId),
      orderHistory: state.orderHistory.map((h) =>
        h.id === orderId ? { ...h, status: 'Cancelled', updatedAt: nowMs } : h
      ),
    },
  };
}

export function depositOrResetDemoBalance(
  state: TradingAccountState,
  mode: 'RESET' | 'DEPOSIT',
  amount: number = 10_000,
  nowMs: number = Date.now()
): TradingAccountState {
  if (!Number.isFinite(amount) || amount <= 0) return state;
  const cleanAmount = roundUSD(amount);
  const nextBalance = mode === 'RESET' ? cleanAmount : roundUSD(state.balanceUSD + cleanAmount);
  const entry = {
    id: makeId('ledger'),
    timestamp: nowMs,
    type: mode === 'RESET' ? ('DEMO_RESET' as const) : ('DEMO_DEPOSIT' as const),
    symbol: 'USD' as const,
    description:
      mode === 'RESET'
        ? `Demo Balance Set to $${cleanAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `Demo Virtual Deposit +$${cleanAmount.toFixed(2)}`,
    amount: mode === 'RESET' ? roundUSD(cleanAmount - state.balanceUSD) : cleanAmount,
    balanceAfter: nextBalance,
  };
  return {
    ...state,
    balanceUSD: nextBalance,
    initialBalanceUSD: mode === 'RESET' ? cleanAmount : state.initialBalanceUSD,
    ledger: [entry, ...state.ledger],
  };
}

export interface TradingTickTriggerEvent {
  kind: 'PENDING_FILLED' | 'PENDING_EXPIRED' | 'POSITION_SL' | 'POSITION_TP';
  symbol: MarketSymbol;
  message: string;
}

/**
 * Evaluates live/simulated Bid & Ask against active Pending Orders and Open Positions (SL/TP).
 * Strictly returns the original state reference when nothing changed to avoid unneeded React renders.
 */
export function evaluateMarketTickForTrading(
  state: TradingAccountState,
  quotes: Partial<Record<MarketSymbol, MarketBidAskQuote | null>>,
  nowMs: number = Date.now()
): { nextState: TradingAccountState; changed: boolean; events: TradingTickTriggerEvent[] } {
  if (state.pendingOrders.length === 0 && state.openPositions.length === 0) {
    return { nextState: state, changed: false, events: [] };
  }

  let curState = state;
  let changed = false;
  const events: TradingTickTriggerEvent[] = [];

  // 1. Evaluate Pending Orders
  if (curState.pendingOrders.length > 0) {
    const remainingPending: PendingOrder[] = [];
    const filledPositions: OpenPosition[] = [];
    const newDeals: DealHistoryRecord[] = [];
    const historyPatchMap = new Map<string, Partial<OrderHistoryRecord>>();

    for (const order of curState.pendingOrders) {
      // Expiration check
      if (order.expiresAt !== null && nowMs >= order.expiresAt) {
        changed = true;
        historyPatchMap.set(order.id, { status: 'Expired', updatedAt: nowMs });
        events.push({
          kind: 'PENDING_EXPIRED',
          symbol: order.symbol,
          message: `${order.symbol} ${formatOrderTypeLabel(order.orderType)} expired`,
        });
        continue;
      }

      const quote = quotes[order.symbol];
      if (!quote) {
        remainingPending.push(order);
        continue;
      }

      let shouldFill = false;
      let updatedOrder = order;
      const cfg = INSTRUMENT_SPREAD_CONFIG[order.symbol];
      const execPrice = roundToInstrument(
        order.direction === 'BUY' ? quote.ask : quote.bid,
        cfg.decimals
      );

      switch (order.orderType) {
        case 'BUY_LIMIT':
          if (quote.ask <= order.entryPrice) shouldFill = true;
          break;
        case 'SELL_LIMIT':
          if (quote.bid >= order.entryPrice) shouldFill = true;
          break;
        case 'BUY_STOP':
          if (quote.ask >= order.entryPrice) shouldFill = true;
          break;
        case 'SELL_STOP':
          if (quote.bid <= order.entryPrice) shouldFill = true;
          break;
        case 'BUY_STOP_LIMIT':
          if (!order.stopTriggered && quote.ask >= order.entryPrice) {
            updatedOrder = { ...order, stopTriggered: true };
            changed = true;
          }
          if (
            updatedOrder.stopTriggered &&
            updatedOrder.limitPrice !== null &&
            quote.ask <= updatedOrder.limitPrice
          ) {
            shouldFill = true;
          }
          break;
        case 'SELL_STOP_LIMIT':
          if (!order.stopTriggered && quote.bid <= order.entryPrice) {
            updatedOrder = { ...order, stopTriggered: true };
            changed = true;
          }
          if (
            updatedOrder.stopTriggered &&
            updatedOrder.limitPrice !== null &&
            quote.bid >= updatedOrder.limitPrice
          ) {
            shouldFill = true;
          }
          break;
      }

      if (shouldFill) {
        changed = true;
        const posId = makeId('pos');
        const dealId = makeId('deal');
        filledPositions.push({
          id: posId,
          symbol: order.symbol,
          direction: order.direction,
          lotSize: order.lotSize,
          entryPrice: execPrice,
          sl: order.sl,
          tp: order.tp,
          openedAt: nowMs,
          sourceOrderId: order.id,
        });
        newDeals.push({
          id: dealId,
          orderId: order.id,
          positionId: posId,
          symbol: order.symbol,
          direction: order.direction,
          dealType: 'IN',
          lotSize: order.lotSize,
          executedPrice: execPrice,
          executedAt: nowMs,
          profitLoss: null,
        });
        historyPatchMap.set(order.id, {
          status: 'Filled',
          executedPrice: execPrice,
          updatedAt: nowMs,
        });
        events.push({
          kind: 'PENDING_FILLED',
          symbol: order.symbol,
          message: `${order.symbol} ${formatOrderTypeLabel(order.orderType)} ${order.lotSize.toFixed(2)} filled @ ${execPrice.toFixed(cfg.decimals)}`,
        });
      } else {
        remainingPending.push(updatedOrder);
      }
    }

    if (changed) {
      curState = {
        ...curState,
        pendingOrders: remainingPending,
        openPositions: [...filledPositions, ...curState.openPositions],
        dealHistory: [...newDeals, ...curState.dealHistory],
        orderHistory: curState.orderHistory.map((h) => {
          const patch = historyPatchMap.get(h.id);
          return patch ? { ...h, ...patch } : h;
        }),
      };
    }
  }

  // 2. Evaluate Open Positions SL/TP (after pending fills, check pre-existing + just-opened cleanly)
  if (curState.openPositions.length > 0) {
    const positionsToCheck = [...curState.openPositions];
    for (const pos of positionsToCheck) {
      const quote = quotes[pos.symbol];
      if (!quote) continue;

      let triggerReason: 'SL' | 'TP' | null = null;
      let exitPrice = 0;

      if (pos.direction === 'BUY') {
        if (pos.sl !== null && quote.bid <= pos.sl) {
          triggerReason = 'SL';
          exitPrice = quote.bid;
        } else if (pos.tp !== null && quote.bid >= pos.tp) {
          triggerReason = 'TP';
          exitPrice = quote.bid;
        }
      } else {
        if (pos.sl !== null && quote.ask >= pos.sl) {
          triggerReason = 'SL';
          exitPrice = quote.ask;
        } else if (pos.tp !== null && quote.ask <= pos.tp) {
          triggerReason = 'TP';
          exitPrice = quote.ask;
        }
      }

      if (triggerReason) {
        const res = closeOpenPosition(curState, {
          positionId: pos.id,
          quote,
          reason: triggerReason,
          overrideExitPrice: exitPrice,
          nowMs,
        });
        if (res.ok && res.closed) {
          curState = res.nextState;
          changed = true;
          events.push({
            kind: triggerReason === 'SL' ? 'POSITION_SL' : 'POSITION_TP',
            symbol: pos.symbol,
            message: `${pos.symbol} ${pos.direction} closed by ${triggerReason} (${res.closed.profitLoss >= 0 ? '+' : ''}$${res.closed.profitLoss.toFixed(2)})`,
          });
        }
      }
    }
  }

  return { nextState: curState, changed, events };
}

/** Local timezone inclusive date range bounds [startMs, endMs] */
export function resolveCalendarRange(
  filter: CalendarFilterState,
  nowMs: number = Date.now()
): { startMs: number; endMs: number; label: string } {
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();

  switch (filter.preset) {
    case 'TODAY':
      return { startMs: startOfToday, endMs: endOfToday, label: 'Today' };
    case 'YESTERDAY': {
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      return {
        startMs: new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0, 0).getTime(),
        endMs: new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59, 999).getTime(),
        label: 'Yesterday',
      };
    }
    case 'LAST_WEEK': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0).getTime();
      return { startMs: start, endMs: endOfToday, label: 'Last Week' };
    }
    case 'LAST_MONTH': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate(), 0, 0, 0, 0).getTime();
      return { startMs: start, endMs: endOfToday, label: 'Last Month' };
    }
    case 'LAST_3_MONTHS': {
      const start = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate(), 0, 0, 0, 0).getTime();
      return { startMs: start, endMs: endOfToday, label: 'Last 3 Months' };
    }
    case 'CUSTOM': {
      const sParts = filter.customStartDate.split('-').map(Number);
      const eParts = filter.customEndDate.split('-').map(Number);
      const sDate =
        sParts.length === 3
          ? new Date(sParts[0], sParts[1] - 1, sParts[2], 0, 0, 0, 0)
          : new Date(startOfToday);
      const eDate =
        eParts.length === 3
          ? new Date(eParts[0], eParts[1] - 1, eParts[2], 23, 59, 59, 999)
          : new Date(endOfToday);
      const startMs = Number.isNaN(sDate.getTime()) ? startOfToday : sDate.getTime();
      const endMs = Number.isNaN(eDate.getTime()) ? endOfToday : eDate.getTime();
      return {
        startMs: Math.min(startMs, endMs),
        endMs: Math.max(startMs, endMs),
        label: `${filter.customStartDate} to ${filter.customEndDate}`,
      };
    }
  }
}

export function filterAndSortPositions(
  items: ClosedPositionRecord[],
  symbolFilter: HistorySymbolFilter,
  range: { startMs: number; endMs: number },
  sort: HistorySortOption
): ClosedPositionRecord[] {
  const filtered = items.filter(
    (item) =>
      (symbolFilter === 'ALL' || item.symbol === symbolFilter) &&
      item.closedAt >= range.startMs &&
      item.closedAt <= range.endMs
  );
  return filtered.sort((a, b) => {
    switch (sort) {
      case 'NEWEST':
        return b.closedAt - a.closedAt;
      case 'OLDEST':
        return a.closedAt - b.closedAt;
      case 'HIGHEST_PROFIT':
        return b.profitLoss - a.profitLoss || b.closedAt - a.closedAt;
      case 'LOWEST_PROFIT':
        return a.profitLoss - b.profitLoss || b.closedAt - a.closedAt;
    }
  });
}

export function filterAndSortOrders(
  items: OrderHistoryRecord[],
  symbolFilter: HistorySymbolFilter,
  range: { startMs: number; endMs: number },
  sort: HistorySortOption
): OrderHistoryRecord[] {
  const filtered = items.filter(
    (item) =>
      (symbolFilter === 'ALL' || item.symbol === symbolFilter) &&
      item.updatedAt >= range.startMs &&
      item.updatedAt <= range.endMs
  );
  return filtered.sort((a, b) => {
    switch (sort) {
      case 'NEWEST':
        return b.updatedAt - a.updatedAt;
      case 'OLDEST':
        return a.updatedAt - b.updatedAt;
      case 'HIGHEST_PROFIT':
        return b.updatedAt - a.updatedAt;
      case 'LOWEST_PROFIT':
        return a.updatedAt - b.updatedAt;
    }
  });
}

export function filterAndSortDeals(
  items: DealHistoryRecord[],
  symbolFilter: HistorySymbolFilter,
  range: { startMs: number; endMs: number },
  sort: HistorySortOption
): DealHistoryRecord[] {
  const seen = new Set<string>();
  const filtered: DealHistoryRecord[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (
      (symbolFilter === 'ALL' || item.symbol === symbolFilter) &&
      item.executedAt >= range.startMs &&
      item.executedAt <= range.endMs
    ) {
      filtered.push(item);
    }
  }
  return filtered.sort((a, b) => {
    switch (sort) {
      case 'NEWEST':
        return b.executedAt - a.executedAt;
      case 'OLDEST':
        return a.executedAt - b.executedAt;
      case 'HIGHEST_PROFIT':
        return (b.profitLoss ?? 0) - (a.profitLoss ?? 0) || b.executedAt - a.executedAt;
      case 'LOWEST_PROFIT':
        return (a.profitLoss ?? 0) - (b.profitLoss ?? 0) || b.executedAt - a.executedAt;
    }
  });
}
