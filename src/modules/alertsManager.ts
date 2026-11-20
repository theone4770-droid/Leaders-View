import { AlertCondition, MarketSymbol, PriceAlert } from '../types/chart';
import { loadAlerts, saveAlerts } from './drawingStorage';

export interface AlertTriggerResult {
  updatedAlerts: PriceAlert[];
  newlyTriggered: PriceAlert[];
}

export function initAlerts(): PriceAlert[] {
  return loadAlerts();
}

export function createAlert(
  alerts: PriceAlert[],
  params: {
    market: MarketSymbol;
    price: number;
    condition: AlertCondition;
    note: string;
    currentPrice?: number;
  }
): PriceAlert[] {
  const alert: PriceAlert = {
    id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    market: params.market,
    price: params.price,
    condition: params.condition,
    note: params.note.trim(),
    active: true,
    triggered: false,
    createdAt: Date.now(),
    lastCheckedPrice: params.currentPrice,
  };
  const next = [alert, ...alerts];
  saveAlerts(next);
  return next;
}

export function updateAlert(
  alerts: PriceAlert[],
  id: string,
  patch: Partial<Pick<PriceAlert, 'price' | 'condition' | 'note' | 'active' | 'triggered'>>
): PriceAlert[] {
  const next = alerts.map((a) =>
    a.id === id
      ? {
          ...a,
          ...patch,
          triggered: patch.active ? false : patch.triggered ?? a.triggered,
        }
      : a
  );
  saveAlerts(next);
  return next;
}

export function deleteAlert(alerts: PriceAlert[], id: string): PriceAlert[] {
  const next = alerts.filter((a) => a.id !== id);
  saveAlerts(next);
  return next;
}

/** Evaluate verified real market price against active alerts */
export function evaluateAlertsForPrice(
  alerts: PriceAlert[],
  market: MarketSymbol,
  livePrice: number
): AlertTriggerResult {
  if (!Number.isFinite(livePrice) || livePrice <= 0) {
    return { updatedAlerts: alerts, newlyTriggered: [] };
  }

  let changed = false;
  const newlyTriggered: PriceAlert[] = [];

  const updatedAlerts = alerts.map((alert) => {
    if (alert.market !== market || !alert.active || alert.triggered) {
      return alert;
    }

    const prev = alert.lastCheckedPrice;
    let shouldTrigger = false;

    if (alert.condition === 'GREATER_THAN') {
      shouldTrigger = livePrice >= alert.price;
    } else if (alert.condition === 'LESS_THAN') {
      shouldTrigger = livePrice <= alert.price;
    } else if (prev !== undefined) {
      if (alert.condition === 'CROSSING_UP') {
        shouldTrigger = prev < alert.price && livePrice >= alert.price;
      } else if (alert.condition === 'CROSSING_DOWN') {
        shouldTrigger = prev > alert.price && livePrice <= alert.price;
      } else if (alert.condition === 'CROSSING') {
        shouldTrigger =
          (prev < alert.price && livePrice >= alert.price) ||
          (prev > alert.price && livePrice <= alert.price) ||
          livePrice === alert.price;
      }
    }

    if (shouldTrigger) {
      changed = true;
      const triggeredAlert: PriceAlert = {
        ...alert,
        active: false,
        triggered: true,
        triggeredAt: Date.now(),
        lastCheckedPrice: livePrice,
      };
      newlyTriggered.push(triggeredAlert);
      return triggeredAlert;
    }

    if (prev !== livePrice) {
      return { ...alert, lastCheckedPrice: livePrice };
    }
    return alert;
  });

  if (changed) {
    saveAlerts(updatedAlerts);
  }
  return { updatedAlerts, newlyTriggered };
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestAlertNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function dispatchAlertNotification(alert: PriceAlert, triggeredPrice: number): void {
  // Play subtle Web Audio chime
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.14);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.46);
    }
  } catch {
    // Ignore audio context restriction
  }

  // Native Notification API if granted
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(`LEADERS VIEW — ${alert.market} PRICE ALERT`, {
        body: `${alert.market} reached ${triggeredPrice.toFixed(2)} (Target: ${alert.price.toFixed(2)})${alert.note ? ` · ${alert.note}` : ''}`,
        icon: '/assets/aistudio/file_000000001a488208b6099279793e33f1_d26a340a.png',
      });
    } catch {
      // Ignore notification failure in restricted contexts
    }
  }
}
