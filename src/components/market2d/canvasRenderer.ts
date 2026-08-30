import { Candle3D } from "../market3d/types";
import { calculateNiceTicks, formatPrice, formatVolume, formatAxisTime } from "../market3d/dataService";

export interface DepthSnapshot {
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
}

export const HEATMAP_CAPACITY = 160;
const HEATMAP_ROWS = 48;
const AXIS_W = 64;
const VOL_FRAC = 0.18;
const GAP = 6;

export function pushDepthSnapshot(buf: DepthSnapshot[], bids: Array<[string, string]>, asks: Array<[string, string]>) {
  buf.push({
    bids: bids.map(([p, q]) => [Number(p), Number(q)] as [number, number]),
    asks: asks.map(([p, q]) => [Number(p), Number(q)] as [number, number]),
  });
  if (buf.length > HEATMAP_CAPACITY) buf.shift();
}

interface DrawOpts {
  candles: Candle3D[];
  depthHistory: DepthSnapshot[];
  showHeatmap: boolean;
  showVolume: boolean;
  hover: { x: number; y: number } | null;
}

function priceRange(candles: Candle3D[], depthHistory: DepthSnapshot[]): [number, number] {
  let min = Infinity, max = -Infinity;
  for (const c of candles) { min = Math.min(min, c.l); max = Math.max(max, c.h); }
  for (const s of depthHistory) {
    for (const [p] of s.bids) { min = Math.min(min, p); max = Math.max(max, p); }
    for (const [p] of s.asks) { min = Math.min(min, p); max = Math.max(max, p); }
  }
  if (!isFinite(min) || !isFinite(max) || min === max) return [0, 1];
  const pad = (max - min) * 0.08 || max * 0.01;
  return [min - pad, max + pad];
}

function drawHeatmap(ctx: CanvasRenderingContext2D, history: DepthSnapshot[], chartW: number, priceH: number, min: number, max: number) {
  const colW = chartW / HEATMAP_CAPACITY;
  const rowH = priceH / HEATMAP_ROWS;
  let maxSize = 1e-9;
  const buckets = history.map((snap) => {
    const bidRows = new Array(HEATMAP_ROWS).fill(0);
    const askRows = new Array(HEATMAP_ROWS).fill(0);
    for (const [p, q] of snap.bids) {
      const row = Math.floor(((p - min) / (max - min)) * HEATMAP_ROWS);
      if (row >= 0 && row < HEATMAP_ROWS) { bidRows[row] += q; maxSize = Math.max(maxSize, bidRows[row]); }
    }
    for (const [p, q] of snap.asks) {
      const row = Math.floor(((p - min) / (max - min)) * HEATMAP_ROWS);
      if (row >= 0 && row < HEATMAP_ROWS) { askRows[row] += q; maxSize = Math.max(maxSize, askRows[row]); }
    }
    return { bidRows, askRows };
  });

  const startX = chartW - history.length * colW;
  buckets.forEach(({ bidRows, askRows }, i) => {
    const x = startX + i * colW;
    for (let row = 0; row < HEATMAP_ROWS; row++) {
      const y = priceH - (row + 1) * rowH;
      const bidA = (bidRows[row] / maxSize) * 0.55;
      const askA = (askRows[row] / maxSize) * 0.55;
      if (bidA > 0.02) { ctx.fillStyle = `rgba(0, 224, 164, ${bidA})`; ctx.fillRect(x, y, colW + 0.5, rowH + 0.5); }
      if (askA > 0.02) { ctx.fillStyle = `rgba(255, 79, 110, ${askA})`; ctx.fillRect(x, y, colW + 0.5, rowH + 0.5); }
    }
  });
}

function drawCandlesAndVolume(ctx: CanvasRenderingContext2D, candles: Candle3D[], chartW: number, priceH: number, volTop: number, volH: number, min: number, max: number, showVolume: boolean) {
  const n = candles.length || 1;
  const spacing = chartW / n;
  const bodyW = Math.max(1, spacing * 0.62);
  const py = (p: number) => priceH - ((p - min) / (max - min)) * priceH;
  const maxVol = showVolume ? Math.max(1e-9, ...candles.map((c) => c.v)) : 1;

  candles.forEach((c, i) => {
    const x = spacing * i + spacing / 2;
    const bull = c.c >= c.o;
    const color = bull ? "#00e0a4" : "#ff4f6e";

    if (showVolume) {
      const vh = Math.max(1, (c.v / maxVol) * volH);
      ctx.fillStyle = bull ? "rgba(0,224,164,0.75)" : "rgba(255,79,110,0.75)";
      ctx.fillRect(x - bodyW / 2, volTop + volH - vh, bodyW, vh);
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, py(c.h));
    ctx.lineTo(x, py(c.l));
    ctx.stroke();

    ctx.fillStyle = color;
    const top = py(Math.max(c.o, c.c));
    const bot = py(Math.min(c.o, c.c));
    ctx.fillRect(x - bodyW / 2, top, bodyW, Math.max(1, bot - top));
  });

  return { spacing, py };
}

function drawAxes(ctx: CanvasRenderingContext2D, candles: Candle3D[], chartW: number, priceH: number, w: number, min: number, max: number) {
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.fillStyle = "#5c6f95";
  ctx.font = "10px var(--font-mono), monospace";
  ctx.textBaseline = "middle";
  const ticks = calculateNiceTicks(min, max, 6);
  for (const t of ticks) {
    const y = priceH - ((t - min) / (max - min)) * priceH;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
    ctx.fillText(formatPrice(t), chartW + 8, y);
  }

  if (candles.length > 1) {
    const spacing = chartW / candles.length;
    const step = Math.max(1, Math.floor(candles.length / 6));
    for (let i = 0; i < candles.length; i += step) {
      const x = spacing * i + spacing / 2;
      ctx.fillText(formatAxisTime(candles[i].t, "1h"), Math.min(x, chartW - 40), priceH + 14);
    }
  }
}

function drawCrosshair(ctx: CanvasRenderingContext2D, candles: Candle3D[], hover: { x: number; y: number }, chartW: number, priceH: number, spacing: number, min: number, max: number) {
  const idx = Math.min(candles.length - 1, Math.max(0, Math.floor(hover.x / spacing)));
  const c = candles[idx];
  if (!c) return;

  ctx.strokeStyle = "rgba(148,163,184,0.4)";
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(hover.x, 0); ctx.lineTo(hover.x, priceH);
  ctx.moveTo(0, hover.y); ctx.lineTo(chartW, hover.y);
  ctx.stroke();
  ctx.setLineDash([]);

  const price = max - (hover.y / priceH) * (max - min);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(chartW, hover.y - 9, AXIS_W, 18);
  ctx.fillStyle = "#5ff2c8";
  ctx.fillText(formatPrice(price), chartW + 8, hover.y);

  const lines = [`O ${formatPrice(c.o)}`, `H ${formatPrice(c.h)}`, `L ${formatPrice(c.l)}`, `C ${formatPrice(c.c)}`, `V ${formatVolume(c.v)}`];
  const boxX = Math.min(hover.x + 12, chartW - 100);
  ctx.fillStyle = "rgba(10,15,28,0.9)";
  ctx.fillRect(boxX, 8, 92, lines.length * 14 + 8);
  ctx.fillStyle = "#cbd5e1";
  lines.forEach((line, i) => ctx.fillText(line, boxX + 8, 8 + 12 + i * 14));
}

export function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, opts: DrawOpts) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, 0, w, h);
  if (opts.candles.length === 0) return;

  const chartW = w - AXIS_W;
  const priceH = h * (1 - VOL_FRAC) - GAP;
  const volTop = priceH + GAP;
  const volH = h - volTop;
  const [min, max] = priceRange(opts.candles, opts.showHeatmap ? opts.depthHistory : []);

  if (opts.showHeatmap && opts.depthHistory.length > 0) {
    drawHeatmap(ctx, opts.depthHistory, chartW, priceH, min, max);
  }
  ctx.textAlign = "left";
  drawAxes(ctx, opts.candles, chartW, priceH, w, min, max);
  if (opts.showVolume) {
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath(); ctx.moveTo(0, volTop); ctx.lineTo(chartW, volTop); ctx.stroke();
  }
  const { spacing } = drawCandlesAndVolume(ctx, opts.candles, chartW, priceH, volTop, volH, min, max, opts.showVolume);

  if (opts.hover && opts.hover.x >= 0 && opts.hover.x <= chartW && opts.hover.y >= 0 && opts.hover.y <= priceH) {
    drawCrosshair(ctx, opts.candles, opts.hover, chartW, priceH, spacing, min, max);
  }
}
