import {
  ClosedPositionRecord,
  DealHistoryRecord,
  HistorySymbolFilter,
  HistoryTab,
  OrderHistoryRecord,
} from '../types/trading';
import { formatOrderTypeLabel } from './tradingEngine';
import { formatPrice, MARKETS } from './timeframeManager';

export interface GeneratedHistoryJpgPage {
  filename: string;
  dataUrl: string;
  blob: Blob;
  pageNumber: number;
  totalPages: number;
}

export interface HistoryExportInput {
  activeTab: HistoryTab;
  dateRangeLabel: string;
  symbolFilter: HistorySymbolFilter;
  balanceUSD: number;
  positions: ClosedPositionRecord[];
  orders: OrderHistoryRecord[];
  deals: DealHistoryRecord[];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatDateTimeShort(ts: number): string {
  const d = new Date(ts);
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return `${date} ${time}`;
}

function formatUSD(val: number, signed = false): string {
  const abs = Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (val < 0) return `-$${abs}`;
  if (signed && val > 0) return `+$${abs}`;
  return `$${abs}`;
}

function canvasToJpgBlob(canvas: HTMLCanvasElement): Promise<{ dataUrl: string; blob: Blob }> {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.94);
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve({ dataUrl, blob });
        } else {
          // Fallback dataUrl -> Blob
          const byteString = atob(dataUrl.split(',')[1] || '');
          const arr = new Uint8Array(byteString.length);
          for (let i = 0; i < byteString.length; i++) arr[i] = byteString.charCodeAt(i);
          resolve({ dataUrl, blob: new Blob([arr], { type: 'image/jpeg' }) });
        }
      },
      'image/jpeg',
      0.94
    );
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}

export async function generateHistoryJpgPages(
  input: HistoryExportInput
): Promise<GeneratedHistoryJpgPage[]> {
  const { activeTab, dateRangeLabel, symbolFilter, balanceUSD, positions, orders, deals } = input;
  const rows =
    activeTab === 'POSITION' ? positions : activeTab === 'ORDERS' ? orders : deals;

  const WIDTH = 1080;
  const PADDING = 44;
  const HEADER_H = 264;
  const ROW_H = 74;
  const FOOTER_H = 68;
  const ROWS_PER_PAGE = 16;

  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const pages: GeneratedHistoryJpgPage[] = [];

  const tabTitle =
    activeTab === 'POSITION'
      ? 'POSITION HISTORY'
      : activeTab === 'ORDERS'
        ? 'ORDERS HISTORY'
        : 'DEALS HISTORY';

  const slugTab = activeTab.toLowerCase();
  const stamp = new Date().toISOString().slice(0, 10);

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const slice = rows.slice(pageIdx * ROWS_PER_PAGE, (pageIdx + 1) * ROWS_PER_PAGE);
    const bodyRowsCount = Math.max(1, slice.length);
    const height = HEADER_H + bodyRowsCount * ROW_H + FOOTER_H;

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    // Classic Black MetaTrader-inspired background
    ctx.fillStyle = '#070709';
    ctx.fillRect(0, 0, WIDTH, height);

    // Subtle top gold accent line
    ctx.fillStyle = '#D4AF37';
    ctx.fillRect(0, 0, WIDTH, 4);

    // Brand + Report Title
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 28px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText('LEADERS VIEW', PADDING, 30);

    ctx.fillStyle = '#D4AF37';
    ctx.font = '700 22px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText(tabTitle, PADDING, 68);

    // Right side meta info (Period + Symbol Filter + Demo badge)
    ctx.textAlign = 'right';
    ctx.fillStyle = '#A1A1AA';
    ctx.font = '500 18px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText(`Period: ${dateRangeLabel}`, WIDTH - PADDING, 32);
    ctx.fillText(
      `Symbol: ${symbolFilter === 'ALL' ? 'All Symbols' : symbolFilter} · Demo Account`,
      WIDTH - PADDING,
      62
    );

    // Summary Card (strictly matching active tab rules — NO Swap/Commission)
    const cardY = 116;
    const cardH = 92;
    drawRoundedRect(ctx, PADDING, cardY, WIDTH - PADDING * 2, cardH, 12);
    ctx.fillStyle = '#111115';
    ctx.fill();
    ctx.strokeStyle = '#2A2A32';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'left';
    if (activeTab === 'POSITION' || activeTab === 'DEALS') {
      const totalProfit =
        activeTab === 'POSITION'
          ? positions.reduce((sum, p) => sum + p.profitLoss, 0)
          : deals.reduce((sum, d) => sum + (d.profitLoss ?? 0), 0);

      ctx.fillStyle = '#A1A1AA';
      ctx.font = '600 17px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Profit', PADDING + 28, cardY + 18);
      ctx.fillStyle = totalProfit >= 0 ? '#19B87D' : '#E54855';
      ctx.font = '700 28px "JetBrains Mono", monospace';
      ctx.fillText(formatUSD(totalProfit, true), PADDING + 28, cardY + 46);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#A1A1AA';
      ctx.font = '600 17px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Balance (USD)', WIDTH - PADDING - 28, cardY + 18);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 28px "JetBrains Mono", monospace';
      ctx.fillText(formatUSD(balanceUSD, false), WIDTH - PADDING - 28, cardY + 46);
    } else {
      const filledCount = orders.filter((o) => o.status === 'Filled').length;
      const cancelledCount = orders.filter((o) => o.status === 'Cancelled').length;
      const totalCount = orders.length;
      const colW = (WIDTH - PADDING * 2) / 3;

      const drawStat = (idx: number, label: string, val: number, color: string) => {
        const cx = PADDING + idx * colW + 28;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#A1A1AA';
        ctx.font = '600 17px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(label, cx, cardY + 18);
        ctx.fillStyle = color;
        ctx.font = '700 28px "JetBrains Mono", monospace';
        ctx.fillText(String(val), cx, cardY + 46);
      };
      drawStat(0, 'Filled', filledCount, '#19B87D');
      drawStat(1, 'Cancelled', cancelledCount, '#E54855');
      drawStat(2, 'Total', totalCount, '#D4AF37');
    }

    // Section header bar above rows
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8E8E98';
    ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(
      activeTab === 'POSITION'
        ? 'SYMBOL / SIDE / LOTS'
        : activeTab === 'ORDERS'
          ? 'SYMBOL / ORDER TYPE / LOTS'
          : 'SYMBOL / DEAL / LOTS',
      PADDING,
      232
    );
    ctx.textAlign = 'right';
    ctx.fillText(
      activeTab === 'POSITION'
        ? 'ENTRY → EXIT / PROFIT'
        : activeTab === 'ORDERS'
          ? 'REQ → EXEC / STATUS'
          : 'PRICE / P&L',
      WIDTH - PADDING,
      232
    );

    ctx.strokeStyle = '#2A2A32';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING, HEADER_H - 4);
    ctx.lineTo(WIDTH - PADDING, HEADER_H - 4);
    ctx.stroke();

    if (slice.length === 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#71717A';
      ctx.font = '500 20px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('No records for selected date range and symbol filter.', WIDTH / 2, HEADER_H + 24);
    } else {
      slice.forEach((row, idx) => {
        const ry = HEADER_H + idx * ROW_H;
        // Row separator
        ctx.strokeStyle = '#1E1E24';
        ctx.beginPath();
        ctx.moveTo(PADDING, ry + ROW_H);
        ctx.lineTo(WIDTH - PADDING, ry + ROW_H);
        ctx.stroke();

        if (activeTab === 'POSITION') {
          const p = row as ClosedPositionRecord;
          const dec = MARKETS[p.symbol].decimals;
          ctx.textAlign = 'left';
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '700 20px "Plus Jakarta Sans", sans-serif';
          ctx.fillText(`${p.symbol}`, PADDING, ry + 12);
          const symW = ctx.measureText(`${p.symbol} `).width;
          ctx.fillStyle = p.direction === 'BUY' ? '#38BDF8' : '#F87171';
          ctx.fillText(`${p.direction.toLowerCase()} ${p.lotSize.toFixed(2)}`, PADDING + symW + 6, ry + 12);

          ctx.fillStyle = '#A1A1AA';
          ctx.font = '500 16px "JetBrains Mono", monospace';
          ctx.fillText(
            `${formatPrice(p.entryPrice, dec)} → ${formatPrice(p.exitPrice, dec)}`,
            PADDING,
            ry + 42
          );

          ctx.textAlign = 'right';
          ctx.fillStyle = p.profitLoss >= 0 ? '#19B87D' : '#E54855';
          ctx.font = '700 21px "JetBrains Mono", monospace';
          ctx.fillText(formatUSD(p.profitLoss, true), WIDTH - PADDING, ry + 12);

          ctx.fillStyle = '#8E8E98';
          ctx.font = '500 15px "JetBrains Mono", monospace';
          ctx.fillText(formatDateTimeShort(p.closedAt), WIDTH - PADDING, ry + 43);
        } else if (activeTab === 'ORDERS') {
          const o = row as OrderHistoryRecord;
          const dec = MARKETS[o.symbol].decimals;
          ctx.textAlign = 'left';
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '700 20px "Plus Jakarta Sans", sans-serif';
          ctx.fillText(`${o.symbol}`, PADDING, ry + 12);
          const symW = ctx.measureText(`${o.symbol} `).width;
          ctx.fillStyle = o.direction === 'BUY' ? '#38BDF8' : '#F87171';
          ctx.fillText(
            `${formatOrderTypeLabel(o.orderType)} ${o.lotSize.toFixed(2)}`,
            PADDING + symW + 6,
            ry + 12
          );

          ctx.fillStyle = '#A1A1AA';
          ctx.font = '500 16px "JetBrains Mono", monospace';
          const priceStr = o.executedPrice
            ? `Req ${formatPrice(o.requestedPrice, dec)} → Exec ${formatPrice(o.executedPrice, dec)}`
            : `Req ${formatPrice(o.requestedPrice, dec)}`;
          ctx.fillText(priceStr, PADDING, ry + 42);

          ctx.textAlign = 'right';
          ctx.fillStyle =
            o.status === 'Filled'
              ? '#19B87D'
              : o.status === 'Cancelled' || o.status === 'Rejected' || o.status === 'Expired'
                ? '#E54855'
                : '#D4AF37';
          ctx.font = '700 19px "Plus Jakarta Sans", sans-serif';
          ctx.fillText(o.status.toUpperCase(), WIDTH - PADDING, ry + 13);

          ctx.fillStyle = '#8E8E98';
          ctx.font = '500 15px "JetBrains Mono", monospace';
          ctx.fillText(formatDateTimeShort(o.updatedAt), WIDTH - PADDING, ry + 43);
        } else {
          const d = row as DealHistoryRecord;
          const dec = MARKETS[d.symbol].decimals;
          ctx.textAlign = 'left';
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '700 20px "Plus Jakarta Sans", sans-serif';
          ctx.fillText(`${d.symbol}`, PADDING, ry + 12);
          const symW = ctx.measureText(`${d.symbol} `).width;
          ctx.fillStyle = d.direction === 'BUY' ? '#38BDF8' : '#F87171';
          ctx.fillText(
            `${d.direction.toLowerCase()} · ${d.dealType} · ${d.lotSize.toFixed(2)}`,
            PADDING + symW + 6,
            ry + 12
          );

          ctx.fillStyle = '#A1A1AA';
          ctx.font = '500 16px "JetBrains Mono", monospace';
          ctx.fillText(`@ ${formatPrice(d.executedPrice, dec)}`, PADDING, ry + 42);

          ctx.textAlign = 'right';
          if (d.profitLoss !== null) {
            ctx.fillStyle = d.profitLoss >= 0 ? '#19B87D' : '#E54855';
            ctx.font = '700 21px "JetBrains Mono", monospace';
            ctx.fillText(formatUSD(d.profitLoss, true), WIDTH - PADDING, ry + 12);
          } else {
            ctx.fillStyle = '#A1A1AA';
            ctx.font = '600 18px "JetBrains Mono", monospace';
            ctx.fillText('ENTRY (IN)', WIDTH - PADDING, ry + 13);
          }

          ctx.fillStyle = '#8E8E98';
          ctx.font = '500 15px "JetBrains Mono", monospace';
          ctx.fillText(formatDateTimeShort(d.executedAt), WIDTH - PADDING, ry + 43);
        }
      });
    }

    // Footer
    const fy = height - FOOTER_H + 22;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#71717A';
    ctx.font = '500 15px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(
      `Generated ${formatDateTimeShort(Date.now())} · Simulated Demo Trading Report`,
      PADDING,
      fy
    );
    ctx.textAlign = 'right';
    ctx.fillText(`Page ${pageIdx + 1} of ${totalPages}`, WIDTH - PADDING, fy);

    const { dataUrl, blob } = await canvasToJpgBlob(canvas);
    const pageSuffix = totalPages > 1 ? `-p${pageIdx + 1}` : '';
    const filename = `leaders-view-${slugTab}-history-${stamp}${pageSuffix}.jpg`;
    pages.push({
      filename,
      dataUrl,
      blob,
      pageNumber: pageIdx + 1,
      totalPages,
    });
  }

  return pages;
}

export function triggerJpgDownloads(pages: GeneratedHistoryJpgPage[]): void {
  pages.forEach((p, idx) => {
    window.setTimeout(() => {
      const a = document.createElement('a');
      a.href = p.dataUrl;
      a.download = p.filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, idx * 180);
  });
}

export async function shareHistoryJpgs(
  pages: GeneratedHistoryJpgPage[],
  title: string
): Promise<'shared' | 'fallback_downloaded'> {
  try {
    const files = pages.map((p) => new File([p.blob], p.filename, { type: 'image/jpeg' }));
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files })
    ) {
      await navigator.share({
        title,
        text: `${title} (${pages.length} JPG)`,
        files,
      });
      return 'shared';
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return 'shared';
    }
  }
  triggerJpgDownloads(pages);
  return 'fallback_downloaded';
}
