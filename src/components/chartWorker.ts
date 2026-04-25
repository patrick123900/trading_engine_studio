// Web Worker: all chart drawing runs off the main thread via OffscreenCanvas.

interface Band { startIndex: number; endIndex: number; direction: 'long' | 'short'; }

let ctx: OffscreenCanvasRenderingContext2D | null = null;
// Stored normalized data (transferred in as ArrayBuffers, held here).
let candlesF32: Float32Array | null = null;   // [open, high, low, close] × n
let equityF32: Float32Array | null = null;    // [equity] × n
let previewBuffers: Float32Array[] = [];
let previewColors: string[] = [];
let bands: Band[] = [];

function sy(v: number, h: number, min: number, max: number): number {
  return h - ((v - min) / ((max - min) || 1)) * h;
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as Record<string, unknown>;

  if (msg.type === 'init') {
    ctx = (msg.canvas as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D;
    return;
  }

  if (msg.type === 'setData') {
    candlesF32 = new Float32Array(msg.candleBuffer as ArrayBuffer);
    equityF32  = new Float32Array(msg.equityBuffer as ArrayBuffer);
    bands = msg.bands as Band[];
    return;
  }

  if (msg.type === 'setPreview') {
    const items = msg.previews as Array<{ buf: ArrayBuffer; color: string }>;
    previewBuffers = items.map(p => new Float32Array(p.buf));
    previewColors  = items.map(p => p.color);
    return;
  }

  if (msg.type === 'render') {
    renderFrame(msg as unknown as RenderMsg);
  }
};

interface RenderMsg {
  w: number; h: number; dpr: number;
  mode: 'candles' | 'preview';
  // candles mode
  visStart: number; visEnd: number;
  eVisStart: number; eVisEnd: number;
  min: number; max: number; candleW: number;
  // preview mode
  previewRanges: Array<{ visStart: number; visEnd: number }>;
  previewMin: number; previewMax: number;
  // shared
  tickRatios: number[];
}

function renderFrame(m: RenderMsg) {
  if (!ctx) return;
  const { w, h, dpr } = m;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  const c = ctx.canvas;
  if (c.width !== pw || c.height !== ph) {
    c.width  = pw;
    c.height = ph;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // ── Horizontal grid lines ────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const r of [0, 0.5, 1]) {
    const y = Math.round(h * r) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  // ── Vertical time grid lines (dashed) ────────────────────────────────────
  if (m.tickRatios.length) {
    ctx.strokeStyle = 'rgba(148,163,184,0.16)';
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    for (const r of m.tickRatios) {
      const x = Math.round(r * w) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (m.mode === 'candles' && candlesF32) {
    const span = Math.max(1, m.visEnd - m.visStart);

    // ── Position bands ──────────────────────────────────────────────────────
    for (const band of bands) {
      if (band.endIndex < m.visStart || band.startIndex > m.visEnd) continue;
      const bs = Math.max(band.startIndex, m.visStart);
      const be = Math.min(band.endIndex, m.visEnd);
      const x  = ((bs - m.visStart) / span) * w;
      const xe = ((be - m.visStart) / span) * w;
      ctx.fillStyle = band.direction === 'long' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';
      ctx.fillRect(x, 0, Math.max(2, xe - x), h);
    }

    // ── Candles ─────────────────────────────────────────────────────────────
    for (let i = m.visStart; i <= m.visEnd; i++) {
      const b  = i * 4;
      const o  = candlesF32[b];
      const hi = candlesF32[b + 1];
      const lo = candlesF32[b + 2];
      const cl = candlesF32[b + 3];
      if (!Number.isFinite(o)) continue;

      const xc    = ((i - m.visStart) / span) * w;
      const oy    = sy(o,  h, m.min, m.max);
      const cy    = sy(cl, h, m.min, m.max);
      const highY = sy(hi, h, m.min, m.max);
      const lowY  = sy(lo, h, m.min, m.max);
      const isUp  = cl >= o;
      const bodyY = Math.min(oy, cy);
      const bodyH = Math.max(1.5, Math.abs(cy - oy));

      // wick
      ctx.strokeStyle = 'rgba(148,163,184,0.72)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(xc, highY);
      ctx.lineTo(xc, lowY);
      ctx.stroke();

      // body
      ctx.fillStyle   = isUp ? 'rgba(52,211,153,0.62)' : 'rgba(248,113,113,0.58)';
      ctx.strokeStyle = 'rgba(15,17,22,0.45)';
      ctx.lineWidth   = 0.8;
      ctx.beginPath();
      const rx = xc - m.candleW / 2;
      if (typeof (ctx as OffscreenCanvasRenderingContext2D & { roundRect?: (...args: number[]) => void }).roundRect === 'function') {
        (ctx as OffscreenCanvasRenderingContext2D & { roundRect: (...args: number[]) => void }).roundRect(rx, bodyY, m.candleW, bodyH, 1.2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(rx, bodyY, m.candleW, bodyH);
        ctx.strokeRect(rx, bodyY, m.candleW, bodyH);
      }
    }

    // ── Equity / strategy line ───────────────────────────────────────────────
    if (equityF32 && equityF32.length > 0) {
      const eSpan = Math.max(1, m.eVisEnd - m.eVisStart);
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth   = 1.25;
      ctx.lineJoin    = 'miter';
      ctx.lineCap     = 'butt';
      ctx.beginPath();
      let started = false;
      for (let i = m.eVisStart; i <= m.eVisEnd; i++) {
        const v = equityF32[i];
        if (!Number.isFinite(v)) continue;
        const x = ((i - m.eVisStart) / eSpan) * w;
        const y = sy(v, h, m.min, m.max);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

  } else if (m.mode === 'preview') {
    for (let pi = 0; pi < previewBuffers.length; pi++) {
      const vals = previewBuffers[pi];
      if (!vals || vals.length === 0) continue;
      const range = m.previewRanges[pi];
      if (!range) continue;
      const pvSpan = Math.max(1, range.visEnd - range.visStart);
      ctx.strokeStyle = previewColors[pi];
      ctx.lineWidth   = 1.25;
      ctx.lineCap     = 'butt';
      ctx.beginPath();
      let started = false;
      for (let i = range.visStart; i <= range.visEnd; i++) {
        const v = vals[i];
        if (!Number.isFinite(v)) continue;
        const x = ((i - range.visStart) / pvSpan) * w;
        const y = sy(v, h, m.previewMin, m.previewMax);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}
