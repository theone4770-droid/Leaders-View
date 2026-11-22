import { TradingAccountState } from '../types/trading';

const TRADING_STORAGE_KEY = 'lv_demo_trading_account_v1';
const DEFAULT_DEMO_BALANCE = 10_000;

export function createInitialTradingState(initialBalance = DEFAULT_DEMO_BALANCE): TradingAccountState {
  const now = Date.now();
  return {
    version: 1,
    balanceUSD: initialBalance,
    initialBalanceUSD: initialBalance,
    activeBuySell: true,
    openPositions: [],
    pendingOrders: [],
    positionHistory: [],
    orderHistory: [],
    dealHistory: [],
    ledger: [
      {
        id: 'ledger_init_demo',
        timestamp: now,
        type: 'INITIAL_DEMO',
        symbol: 'USD',
        description: 'Initial Demo Account Balance',
        amount: initialBalance,
        balanceAfter: initialBalance,
      },
    ],
  };
}

export function loadTradingAccountState(): TradingAccountState {
  const fallback = createInitialTradingState();
  try {
    const raw = localStorage.getItem(TRADING_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<TradingAccountState>;
    if (!parsed || typeof parsed !== 'object') return fallback;

    const balanceUSD =
      typeof parsed.balanceUSD === 'number' && Number.isFinite(parsed.balanceUSD)
        ? Math.round(parsed.balanceUSD * 100) / 100
        : DEFAULT_DEMO_BALANCE;
    const initialBalanceUSD =
      typeof parsed.initialBalanceUSD === 'number' &&
      Number.isFinite(parsed.initialBalanceUSD) &&
      parsed.initialBalanceUSD > 0
        ? Math.round(parsed.initialBalanceUSD * 100) / 100
        : DEFAULT_DEMO_BALANCE;

    return {
      version: 1,
      balanceUSD,
      initialBalanceUSD,
      activeBuySell: parsed.activeBuySell !== false,
      openPositions: Array.isArray(parsed.openPositions) ? parsed.openPositions : [],
      pendingOrders: Array.isArray(parsed.pendingOrders) ? parsed.pendingOrders : [],
      positionHistory: Array.isArray(parsed.positionHistory) ? parsed.positionHistory : [],
      orderHistory: Array.isArray(parsed.orderHistory) ? parsed.orderHistory : [],
      dealHistory: Array.isArray(parsed.dealHistory) ? parsed.dealHistory : [],
      ledger:
        Array.isArray(parsed.ledger) && parsed.ledger.length > 0
          ? parsed.ledger
          : fallback.ledger,
    };
  } catch {
    return fallback;
  }
}

export function saveTradingAccountState(state: TradingAccountState): void {
  try {
    localStorage.setItem(TRADING_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage quota or restricted environment
  }
}

export function exportBalanceSheetCSV(state: TradingAccountState): string {
  const header = ['Timestamp', 'Date', 'Time', 'Type', 'Symbol', 'Description', 'Amount (USD)', 'Balance After (USD)'];
  const rows = [...state.ledger]
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((entry) => {
      const d = new Date(entry.timestamp);
      const dateStr = d.toLocaleDateString('en-CA');
      const timeStr = d.toLocaleTimeString('en-GB', { hour12: false });
      return [
        String(entry.timestamp),
        dateStr,
        timeStr,
        entry.type,
        entry.symbol,
        `"${entry.description.replace(/"/g, '""')}"`,
        entry.amount.toFixed(2),
        entry.balanceAfter.toFixed(2),
      ].join(',');
    });
  return [header.join(','), ...rows].join('\n');
}
