import React, { useEffect, useState } from 'react';
import { Bell, BellRing, Check, Edit3, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import {
  AlertCondition,
  ConnectionStatus,
  MarketSymbol,
  PriceAlert,
} from '../types/chart';
import { formatPrice, MARKETS } from '../modules/timeframeManager';
import {
  getNotificationPermission,
  requestAlertNotificationPermission,
} from '../modules/alertsManager';

interface AlertsModalProps {
  open: boolean;
  market: MarketSymbol;
  currentPrice?: number;
  connectionStatus: ConnectionStatus;
  alerts: PriceAlert[];
  onCreateAlert: (params: {
    market: MarketSymbol;
    price: number;
    condition: AlertCondition;
    note: string;
  }) => void;
  onUpdateAlert: (
    id: string,
    patch: Partial<Pick<PriceAlert, 'price' | 'condition' | 'note' | 'active' | 'triggered'>>
  ) => void;
  onDeleteAlert: (id: string) => void;
  onClose: () => void;
}

const CONDITION_LABELS: Record<AlertCondition, string> = {
  CROSSING: 'CROSSING',
  CROSSING_UP: 'CROSSING UP',
  CROSSING_DOWN: 'CROSSING DOWN',
  GREATER_THAN: 'GREATER THAN',
  LESS_THAN: 'LESS THAN',
};

export const AlertsModal: React.FC<AlertsModalProps> = React.memo(({
  open,
  market,
  currentPrice,
  connectionStatus,
  alerts,
  onCreateAlert,
  onUpdateAlert,
  onDeleteAlert,
  onClose,
}) => {
  const [priceInput, setPriceInput] = useState('');
  const [condition, setCondition] = useState<AlertCondition>('CROSSING');
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    getNotificationPermission()
  );

  useEffect(() => {
    if (open && !editingId && currentPrice !== undefined && !priceInput) {
      setPriceInput(currentPrice.toFixed(MARKETS[market].decimals));
    }
  }, [open, currentPrice, market, editingId, priceInput]);

  if (!open) return null;

  const meta = MARKETS[market];
  const marketAlerts = alerts.filter((a) => a.market === market);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numeric = Number(priceInput);
    if (!Number.isFinite(numeric) || numeric <= 0) return;

    if (editingId) {
      onUpdateAlert(editingId, { price: numeric, condition, note, active: true, triggered: false });
      setEditingId(null);
    } else {
      onCreateAlert({ market, price: numeric, condition, note });
    }
    setNote('');
  };

  const startEdit = (alert: PriceAlert) => {
    setEditingId(alert.id);
    setPriceInput(alert.price.toFixed(meta.decimals));
    setCondition(alert.condition);
    setNote(alert.note);
  };

  const handleRequestNotif = async () => {
    const result = await requestAlertNotificationPermission();
    setNotifPermission(result);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[calc(100dvh-20px)] flex flex-col rounded-lg border border-[#141311]/30 dark:border-[#FFFFFF]/35 bg-[#FFFFFF] dark:bg-[#0F0F12] shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#141311]/15 dark:border-[#FFFFFF]/15 shrink-0">
          <div>
            <h2 className="text-xs font-bold tracking-[0.18em] text-[#141311] dark:text-[#FFFFFF]">
              PRICE ALERTS · {market}
            </h2>
            <p className="mt-0.5 text-[11px] font-mono-num text-[#625D52] dark:text-[#9A9892]">
              FEED: {connectionStatus} · NOTIFICATIONS: {notifPermission.toUpperCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Price Alerts"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#625D52] dark:text-[#9A9892] hover:text-[#141311] dark:hover:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Notification permission bar */}
        {notifPermission !== 'granted' && notifPermission !== 'unsupported' && (
          <div className="flex items-center justify-between gap-2 px-4 py-2 bg-[#141311]/8 dark:bg-[#FFFFFF]/10 border-b border-[#141311]/15 dark:border-[#FFFFFF]/15 text-xs">
            <span className="text-[#4D4940] dark:text-[#DCD9D0]">
              Enable browser notifications to receive alerts outside the chart tab.
            </span>
            <button
              type="button"
              onClick={handleRequestNotif}
              className="px-2.5 py-1 rounded border border-[#141311] dark:border-[#FFFFFF] bg-[#141311] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#080808] text-[11px] font-bold tracking-wider whitespace-nowrap cursor-pointer"
            >
              ENABLE
            </button>
          </div>
        )}

        {/* Create / Edit Alert Form */}
        <form
          onSubmit={handleSubmit}
          className="p-4 border-b border-[#141311]/15 dark:border-[#FFFFFF]/15 space-y-3 shrink-0"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10.5px] font-bold tracking-[0.12em] text-[#625D52] dark:text-[#9A9892]">
                  TARGET PRICE
                </label>
                {currentPrice !== undefined && (
                  <button
                    type="button"
                    onClick={() => setPriceInput(currentPrice.toFixed(meta.decimals))}
                    className="text-[10px] font-mono-num text-[#141311] dark:text-[#FFFFFF] hover:underline cursor-pointer"
                  >
                    LAST: {formatPrice(currentPrice, meta.decimals)}
                  </button>
                )}
              </div>
              <input
                type="number"
                step="any"
                required
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder="Enter price..."
                className="w-full h-9 px-3 rounded-md border border-[#141311]/25 dark:border-[#FFFFFF]/25 bg-[#FBF9F4] dark:bg-[#17171B] font-mono-num text-sm text-[#141311] dark:text-[#F5F5F7] focus:outline-none focus:border-[#141311] dark:focus:border-[#FFFFFF]"
              />
            </div>

            <div>
              <label className="block mb-1 text-[10.5px] font-bold tracking-[0.12em] text-[#625D52] dark:text-[#9A9892]">
                CONDITION
              </label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as AlertCondition)}
                className="w-full h-9 px-2.5 rounded-md border border-[#141311]/25 dark:border-[#FFFFFF]/25 bg-[#FBF9F4] dark:bg-[#17171B] text-xs font-semibold text-[#141311] dark:text-[#F5F5F7] focus:outline-none focus:border-[#141311] dark:focus:border-[#FFFFFF]"
              >
                {(Object.keys(CONDITION_LABELS) as AlertCondition[]).map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional alert label or note..."
              className="flex-1 h-9 px-3 rounded-md border border-[#141311]/25 dark:border-[#FFFFFF]/25 bg-[#FBF9F4] dark:bg-[#17171B] text-xs text-[#141311] dark:text-[#F5F5F7] placeholder:text-[#625D52] dark:placeholder:text-[#7E7B74] focus:outline-none focus:border-[#141311] dark:focus:border-[#FFFFFF]"
            />
            <button
              type="submit"
              className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-[#141311] hover:bg-[#2A2824] dark:bg-[#FFFFFF] dark:hover:bg-[#E5E5E7] text-[#FFFFFF] dark:text-[#080808] text-xs font-bold tracking-[0.1em] transition-colors whitespace-nowrap cursor-pointer"
            >
              {editingId ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              <span>{editingId ? 'UPDATE' : 'CREATE ALERT'}</span>
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setNote('');
                }}
                className="h-9 px-2.5 rounded-md border border-[#141311]/25 dark:border-[#FFFFFF]/25 text-xs text-[#625D52] dark:text-[#9A9892] cursor-pointer"
              >
                CANCEL
              </button>
            )}
          </div>
        </form>

        {/* Active & Triggered Alerts List */}
        <div className="flex-1 min-h-[120px] overflow-y-auto p-3 space-y-2">
          {marketAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Bell className="w-6 h-6 text-[#141311]/45 dark:text-[#FFFFFF]/45 mb-2" />
              <p className="text-xs font-semibold text-[#625D52] dark:text-[#9A9892]">
                NO ACTIVE PRICE ALERTS FOR {market}
              </p>
            </div>
          ) : (
            marketAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 ${
                  alert.triggered
                    ? 'border-[#19B87D]/45 bg-[#19B87D]/8'
                    : 'border-[#141311]/20 dark:border-[#FFFFFF]/20 bg-[#FBF9F4] dark:bg-[#151519]'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {alert.triggered ? (
                      <BellRing className="w-3.5 h-3.5 text-[#0F9D68] dark:text-[#19B87D] shrink-0" />
                    ) : (
                      <Bell className="w-3.5 h-3.5 text-[#141311] dark:text-[#FFFFFF] shrink-0" />
                    )}
                    <span className="font-mono-num text-sm font-bold text-[#141311] dark:text-[#F5F5F7]">
                      {formatPrice(alert.price, meta.decimals)}
                    </span>
                    <span className="text-[10.5px] font-semibold text-[#625D52] dark:text-[#9A9892]">
                      {CONDITION_LABELS[alert.condition]}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#625D52] dark:text-[#9A9892] truncate">
                    {alert.triggered ? 'TRIGGERED' : 'ACTIVE'}
                    {alert.note ? ` · ${alert.note}` : ''}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {alert.triggered && (
                    <button
                      type="button"
                      onClick={() => onUpdateAlert(alert.id, { active: true, triggered: false })}
                      title="RE-ARM ALERT"
                      className="flex h-7 w-7 items-center justify-center rounded text-[#141311] dark:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/15 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => startEdit(alert)}
                    title="EDIT ALERT"
                    className="flex h-7 w-7 items-center justify-center rounded text-[#141311] dark:text-[#FFFFFF] hover:bg-[#141311]/10 dark:hover:bg-[#FFFFFF]/15 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteAlert(alert.id)}
                    title="DELETE ALERT"
                    className="flex h-7 w-7 items-center justify-center rounded text-[#D63946] dark:text-[#E54855] hover:bg-[#E54855]/15 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});

AlertsModal.displayName = 'AlertsModal';
