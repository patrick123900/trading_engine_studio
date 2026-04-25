import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { BacktestResult, CandlePoint, EquityPoint, SeriesPreview, TradeMarker } from "../core/types";

interface ResultsPanelProps {
  result: BacktestResult;
  selectedPreviews: SeriesPreview[];
  onPreferredHeightChange?: (height: number) => void;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMoney(value: number) {
  return `$${Math.round(value).toLocaleString()}`;
}

function formatMetric(value: number) {
  return value.toFixed(2);
}

function buildPath(points: EquityPoint[], width: number, height: number, min: number, max: number) {
  if (points.length === 0 || max === min) {
    return "";
  }

  return points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * width;
      const y = height - ((point.equity - min) / (max - min || 1)) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildLinePath(values: number[], width: number, height: number, min: number, max: number) {
  if (values.length === 0 || max === min) {
    return "";
  }

  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - ((value - min) / (max - min || 1)) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildPartialPath(
  values: number[],
  width: number,
  height: number,
  min: number,
  max: number,
  startIndex: number,
  endIndex: number,
) {
  if (values.length === 0 || max === min || endIndex < startIndex) {
    return "";
  }

  const span = Math.max(1, endIndex - startIndex);
  const clampedStart = Math.max(0, Math.min(startIndex, values.length - 1));
  const clampedEnd = Math.max(clampedStart, Math.min(endIndex, values.length - 1));
  const points: string[] = [];

  for (let index = clampedStart; index <= clampedEnd; index += 1) {
    const x = ((index - clampedStart) / span) * width;
    const y = height - ((values[index] - min) / (max - min || 1)) * height;
    points.push(`${index === clampedStart ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }

  return points.join(" ");
}

function scaleY(value: number, height: number, min: number, max: number) {
  return height - ((value - min) / (max - min || 1)) * height;
}

function formatNormalizedTick(value: number) {
  const delta = value - 100;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

function formatSeriesTick(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  const absolute = Math.abs(value);
  if (absolute >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  if (absolute >= 100) {
    return value.toFixed(1);
  }

  return value.toFixed(2);
}

function previewColor(index: number) {
  const palette = ["#60a5fa", "#f59e0b", "#34d399", "#f472b6", "#a78bfa", "#f87171"];
  return palette[index % palette.length];
}

interface TimeTick {
  key: string;
  label: string;
  ratio: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatTimeTickLabel(date: Date, spanMs: number, averageStepMs: number) {
  if (averageStepMs < MS_PER_DAY && spanMs <= 14 * MS_PER_DAY) {
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (spanMs <= 180 * MS_PER_DAY) {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  if (spanMs <= 3 * 365 * MS_PER_DAY) {
    return date.toLocaleDateString(undefined, {
      month: "short",
      year: "numeric",
    });
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
  });
}

function buildTimeTicks(candles: CandlePoint[], preferredTickCount: number) {
  if (candles.length === 0) {
    return [] as TimeTick[];
  }

  if (candles.length === 1) {
    const only = new Date(candles[0].timestamp);
    return [
      {
        key: `${candles[0].timestamp}-0`,
        label: formatTimeTickLabel(only, 0, 0),
        ratio: 0,
      },
    ];
  }

  const startMs = Date.parse(candles[0].timestamp);
  const endMs = Date.parse(candles[candles.length - 1].timestamp);
  const spanMs = Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;
  const averageStepMs = spanMs / Math.max(1, candles.length - 1);
  const tickCount = Math.max(2, Math.min(candles.length, preferredTickCount));
  const seen = new Set<number>();
  const ticks: TimeTick[] = [];

  for (let tickIndex = 0; tickIndex < tickCount; tickIndex += 1) {
    const rawIndex = (tickIndex / Math.max(1, tickCount - 1)) * (candles.length - 1);
    const candleIndex = Math.round(rawIndex);
    if (seen.has(candleIndex)) {
      continue;
    }

    seen.add(candleIndex);
    const candle = candles[candleIndex];
    const date = new Date(candle.timestamp);
    ticks.push({
      key: `${candle.timestamp}-${candleIndex}`,
      label: formatTimeTickLabel(date, spanMs, averageStepMs),
      ratio: candleIndex / Math.max(1, candles.length - 1),
    });
  }

  return ticks;
}

function buildTrades(markers: TradeMarker[], candles: CandlePoint[]) {
  const indexByTimestamp = new Map(candles.map((c, i) => [c.timestamp, i]));
  const candleByTimestamp = new Map(candles.map((c) => [c.timestamp, c]));
  const openByDirection: Partial<Record<"long" | "short", TradeMarker>> = {};
  const trades: Array<{
    entry: TradeMarker;
    exit: TradeMarker | null;
    entryCandle: CandlePoint | undefined;
    exitCandle: CandlePoint | undefined;
    entryBar: number;
    exitBar: number | null;
  }> = [];

  for (const marker of markers) {
    if (marker.event === "entry") {
      openByDirection[marker.direction] = marker;
    } else {
      const entry = openByDirection[marker.direction];
      if (entry) {
        trades.push({
          entry,
          exit: marker,
          entryCandle: candleByTimestamp.get(entry.timestamp),
          exitCandle: candleByTimestamp.get(marker.timestamp),
          entryBar: (indexByTimestamp.get(entry.timestamp) ?? -1) + 1,
          exitBar: (indexByTimestamp.get(marker.timestamp) ?? -1) + 1,
        });
        delete openByDirection[marker.direction];
      }
    }
  }

  for (const entry of Object.values(openByDirection)) {
    if (entry) {
      trades.push({
        entry,
        exit: null,
        entryCandle: candleByTimestamp.get(entry.timestamp),
        exitCandle: undefined,
        entryBar: (indexByTimestamp.get(entry.timestamp) ?? -1) + 1,
        exitBar: null,
      });
    }
  }

  return trades;
}

function exportTradesToCSV(result: BacktestResult) {
  const trades = buildTrades(result.tradeMarkers, result.priceSeries);

  const headers = [
    "ID", "Direction",
    "Entry Bar", "Entry Price", "Entry Open", "Entry High", "Entry Low", "Entry Close",
    "Exit Bar", "Exit Price", "Exit Open", "Exit High", "Exit Low", "Exit Close",
    "PnL", "Total Bars",
  ];

  const rows = trades.map((trade, index) => {
    const entryPrice = trade.entry.price;
    const exitPrice = trade.exit?.price ?? null;
    const pnlMoney =
      trade.exit !== null && trade.exit.pnl !== undefined
        ? trade.exit.pnl.toFixed(2)
        : exitPrice !== null
        ? trade.entry.direction === "long"
          ? ((exitPrice - entryPrice) * 1).toFixed(2)
          : ((entryPrice - exitPrice) * 1).toFixed(2)
        : "";
    const totalBars = trade.exitBar !== null ? trade.exitBar - trade.entryBar : "";

    return [
      index + 1,
      trade.entry.direction === "long" ? "Long" : "Short",
      trade.entryBar,
      entryPrice.toFixed(4),
      trade.entryCandle?.open.toFixed(4) ?? "",
      trade.entryCandle?.high.toFixed(4) ?? "",
      trade.entryCandle?.low.toFixed(4) ?? "",
      trade.entryCandle?.close.toFixed(4) ?? "",
      trade.exitBar ?? "",
      exitPrice !== null ? exitPrice.toFixed(4) : "",
      trade.exitCandle?.open.toFixed(4) ?? "",
      trade.exitCandle?.high.toFixed(4) ?? "",
      trade.exitCandle?.low.toFixed(4) ?? "",
      trade.exitCandle?.close.toFixed(4) ?? "",
      pnlMoney,
      totalBars,
    ];
  });

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${result.graphName || "backtest"}_trades.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function buildPositionBands(markers: TradeMarker[], candles: CandlePoint[], width: number) {
  const indexByTimestamp = new Map(candles.map((candle, index) => [candle.timestamp, index]));
  const sortedMarkers = [...markers]
    .map((marker) => ({ marker, index: indexByTimestamp.get(marker.timestamp) ?? -1 }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index);

  const bands: Array<{ startIndex: number; endIndex: number; direction: "long" | "short" }> = [];
  let active: { direction: "long" | "short"; startIndex: number } | null = null;

  for (const entry of sortedMarkers) {
    if (entry.marker.event === "entry") {
      active = { direction: entry.marker.direction, startIndex: entry.index };
      continue;
    }

    if (!active || active.direction !== entry.marker.direction) {
      continue;
    }

    bands.push({
      startIndex: active.startIndex,
      endIndex: entry.index,
      direction: active.direction,
    });
    active = null;
  }

  if (active) {
    bands.push({
      startIndex: active.startIndex,
      endIndex: Math.max(active.startIndex, candles.length - 1),
      direction: active.direction,
    });
  }

  return bands;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampWindow(window: { start: number; end: number }, minSpan: number) {
  const span = clamp(window.end - window.start, minSpan, 1);
  const maxStart = Math.max(0, 1 - span);
  const start = clamp(window.start, 0, maxStart);
  const end = start + span;
  return { start, end };
}

function indexRangeFromWindow(length: number, window: { start: number; end: number }) {
  if (length <= 1) {
    return { startIndex: 0, endIndex: Math.max(0, length - 1) };
  }

  const lastIndex = length - 1;
  const startIndex = clamp(Math.floor(window.start * lastIndex), 0, lastIndex - 1);
  const endIndex = clamp(Math.ceil(window.end * lastIndex), startIndex + 1, lastIndex);
  return { startIndex, endIndex };
}

function ResultsPanelComponent({ result, selectedPreviews, onPreferredHeightChange }: ResultsPanelProps) {
  const metricsShellRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerReadyRef = useRef(false);
  const canvasTransferredRef = useRef(false);
  const panStateRef = useRef<{ startX: number; start: number; span: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const [isWorkerActive, setIsWorkerActive] = useState(false);
  const chartWidth = 900;
  const chartHeight = 280;
  const hasPreviewSelection = selectedPreviews.length > 0;
  const [viewWindow, setViewWindow] = useState({ start: 0, end: 1 });
  const [isPanning, setIsPanning] = useState(false);

  // ── Worker init (once on mount) ──────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Dev mode (React strict effects / HMR) can replay mount effects and break
    // OffscreenCanvas transfer semantics. Keep worker mode for production builds.
    if (import.meta.env.DEV) {
      workerReadyRef.current = false;
      setIsWorkerActive(false);
      canvasTransferredRef.current = false;
      return;
    }

    if (!("transferControlToOffscreen" in canvas)) {
      workerReadyRef.current = false;
      setIsWorkerActive(false);
      canvasTransferredRef.current = false;
      return;
    }

    const worker = new Worker(new URL('./chartWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onerror = () => {
      workerReadyRef.current = false;
      setIsWorkerActive(false);
    };
    try {
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);
      workerReadyRef.current = true;
      canvasTransferredRef.current = true;
      setIsWorkerActive(true);
    } catch {
      worker.terminate();
      workerRef.current = null;
      workerReadyRef.current = false;
      canvasTransferredRef.current = false;
      setIsWorkerActive(false);
    }
    return () => {
      worker.terminate();
      workerRef.current = null;
      workerReadyRef.current = false;
      canvasTransferredRef.current = false;
      setIsWorkerActive(false);
    };
  }, []);

  // ── Send raw price/equity data to worker whenever result changes ──────────
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !workerReadyRef.current || !isWorkerActive) return;
    const priceBase  = result.priceSeries[0]?.close ?? 1;
    const equityBase = result.equityCurve[0]?.equity ?? 1;
    const n  = result.priceSeries.length;
    const eq = result.equityCurve.length;
    const candleF32 = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const p = result.priceSeries[i];
      candleF32[i * 4]     = (p.open  / priceBase)  * 100;
      candleF32[i * 4 + 1] = (p.high  / priceBase)  * 100;
      candleF32[i * 4 + 2] = (p.low   / priceBase)  * 100;
      candleF32[i * 4 + 3] = (p.close / priceBase)  * 100;
    }
    const equityF32 = new Float32Array(eq);
    for (let i = 0; i < eq; i++) {
      equityF32[i] = (result.equityCurve[i].equity / equityBase) * 100;
    }
    const bands = buildPositionBands(result.tradeMarkers, result.priceSeries, 1);
    worker.postMessage(
      { type: 'setData', candleBuffer: candleF32.buffer, equityBuffer: equityF32.buffer, bands },
      [candleF32.buffer, equityF32.buffer],
    );
  }, [result, isWorkerActive]);

  // ── Send preview data to worker whenever selection changes ────────────────
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !workerReadyRef.current || !isWorkerActive) return;
    const previews = selectedPreviews.map((preview, index) => {
      const f32 = new Float32Array(preview.values);
      return { buf: f32.buffer, color: previewColor(index) };
    });
    worker.postMessage({ type: 'setPreview', previews }, previews.map(p => p.buf));
  }, [selectedPreviews, isWorkerActive]);

  const totalBars = useMemo(() => {
    if (hasPreviewSelection) {
      return Math.max(...selectedPreviews.map((preview) => preview.values.length), result.priceSeries.length, 1);
    }

    return Math.max(result.priceSeries.length, result.equityCurve.length, 1);
  }, [hasPreviewSelection, result.equityCurve.length, result.priceSeries.length, selectedPreviews]);

  const minViewSpan = useMemo(() => {
    const minBars = 20;
    if (totalBars <= 1) {
      return 1;
    }

    return Math.min(1, Math.max(minBars / totalBars, 0.01));
  }, [totalBars]);

  useEffect(() => {
    setViewWindow((current) => clampWindow(current, minViewSpan));
  }, [minViewSpan]);

  useEffect(() => {
    setViewWindow({ start: 0, end: 1 });
  }, [result]);

  useEffect(() => {
    if (!isPanning) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const pan = panStateRef.current;
      const frame = frameRef.current;
      if (!pan || !frame) {
        return;
      }

      const width = frame.getBoundingClientRect().width;
      if (width <= 0) {
        return;
      }

      const deltaRatio = (event.clientX - pan.startX) / width;
      const nextStart = pan.start - deltaRatio * pan.span;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        setViewWindow(clampWindow({ start: nextStart, end: nextStart + pan.span }, minViewSpan));
        rafRef.current = null;
      });
    };

    const handleMouseUp = () => {
      panStateRef.current = null;
      setIsPanning(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isPanning, minViewSpan]);

  const handleChartWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }

    const cursorRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    setViewWindow((current) => {
      const span = current.end - current.start;
      const zoomFactor = Math.exp(event.deltaY * 0.003);
      const nextSpan = clamp(span * zoomFactor, minViewSpan, 1);
      const anchor = current.start + cursorRatio * span;
      const nextStart = anchor - cursorRatio * nextSpan;
      return clampWindow({ start: nextStart, end: nextStart + nextSpan }, minViewSpan);
    });
  };

  const handleChartMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const span = viewWindow.end - viewWindow.start;
    panStateRef.current = {
      startX: event.clientX,
      start: viewWindow.start,
      span,
    };
    setIsPanning(true);
  };

  const chartModel = useMemo(() => {
    const priceBase = result.priceSeries[0]?.close ?? 1;
    const equityBase = result.equityCurve[0]?.equity ?? 1;
    const normalizedCandles = result.priceSeries.map((point) => ({
      ...point,
      open: (point.open / priceBase) * 100,
      high: (point.high / priceBase) * 100,
      low: (point.low / priceBase) * 100,
      close: (point.close / priceBase) * 100,
    }));
    const normalizedEquityCurve = result.equityCurve.map((point) => ({
      ...point,
      equity: (point.equity / equityBase) * 100,
    }));
    const visibleCandleRange = indexRangeFromWindow(normalizedCandles.length, viewWindow);
    const visibleEquityRange = indexRangeFromWindow(normalizedEquityCurve.length, viewWindow);
    const visibleCandles = normalizedCandles.slice(visibleCandleRange.startIndex, visibleCandleRange.endIndex + 1);
    const visibleEquityValues = normalizedEquityCurve
      .slice(visibleEquityRange.startIndex, visibleEquityRange.endIndex + 1)
      .map((point) => point.equity);
    const normalizedLows = visibleCandles.map((point) => point.low);
    const normalizedHighs = visibleCandles.map((point) => point.high);
    const normalizedEquityValues = visibleEquityValues;
    const combinedMin = Math.min(...normalizedLows, ...normalizedEquityValues);
    const combinedMax = Math.max(...normalizedHighs, ...normalizedEquityValues);
    const normalizedMin = combinedMin - (combinedMax - combinedMin || 1) * 0.05;
    const normalizedMax = combinedMax + (combinedMax - combinedMin || 1) * 0.05;
    const totalVisibleCandles = Math.max(2, visibleCandleRange.endIndex - visibleCandleRange.startIndex + 1);

    return {
      visibleCandleRange,
      equityVisibleRange: visibleEquityRange,
      normalizedMin,
      normalizedMax,
      candleWidth: Math.max(3, chartWidth / Math.max(20, totalVisibleCandles) * 0.55),
      ticks: [normalizedMax, (normalizedMax + normalizedMin) / 2, normalizedMin],
    };
  }, [chartHeight, chartWidth, result, viewWindow]);

  const previewModel = useMemo(() => {
    const allPreviewValues = selectedPreviews.flatMap((preview) => {
      const range = indexRangeFromWindow(preview.values.length, viewWindow);
      return preview.values.slice(range.startIndex, range.endIndex + 1);
    });
    const previewMinBase = allPreviewValues.length > 0 ? Math.min(...allPreviewValues) : 0;
    const previewMaxBase = allPreviewValues.length > 0 ? Math.max(...allPreviewValues) : 1;
    const previewPadding = (previewMaxBase - previewMinBase || 1) * 0.05;
    const previewMin = previewMinBase - previewPadding;
    const previewMax = previewMaxBase + previewPadding;

    return {
      previewMin,
      previewMax,
      previewTicks: [previewMax, (previewMax + previewMin) / 2, previewMin],
      previewRanges: selectedPreviews.map((preview) => {
        const range = indexRangeFromWindow(preview.values.length, viewWindow);
        return { visStart: range.startIndex, visEnd: range.endIndex };
      }),
    };
  }, [chartHeight, chartWidth, selectedPreviews, viewWindow]);

  const timeTicks = useMemo(() => {
    const preferredTickCount = Math.max(4, Math.floor(chartWidth / 140));
    const priceRange = indexRangeFromWindow(result.priceSeries.length, viewWindow);
    const visiblePrices = result.priceSeries.slice(priceRange.startIndex, priceRange.endIndex + 1);
    return buildTimeTicks(visiblePrices, preferredTickCount);
  }, [chartWidth, result.priceSeries, viewWindow]);

  useEffect(() => {
    const element = metricsShellRef.current;
    if (!element || !onPreferredHeightChange) {
      return;
    }

    const reportHeight = () => {
      const rect = element.getBoundingClientRect();
      const contentStyle = window.getComputedStyle(element);
      const sidebar = element.closest(".results-sidebar");
      const sidebarStyle = sidebar ? window.getComputedStyle(sidebar) : null;
      const marginBottom = Number.parseFloat(contentStyle.marginBottom || "0");
      const paddingBottom = Number.parseFloat(sidebarStyle?.paddingBottom || "0");
      onPreferredHeightChange(Math.ceil(rect.height + marginBottom + paddingBottom));
    };

    reportHeight();

    const observer = new ResizeObserver(reportHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onPreferredHeightChange, result]);

  // ── Trigger a worker render whenever the view changes ────────────────────
  useEffect(() => {
    const worker = workerRef.current;
    const canvas = canvasRef.current;
    if (!worker || !workerReadyRef.current || !canvas || !isWorkerActive) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (hasPreviewSelection) {
      worker.postMessage({
        type: 'render',
        w: rect.width, h: rect.height, dpr,
        mode: 'preview',
        previewRanges: previewModel.previewRanges,
        previewMin: previewModel.previewMin,
        previewMax: previewModel.previewMax,
        tickRatios: timeTicks.map(t => t.ratio),
        // unused in preview mode but required by type
        visStart: 0, visEnd: 0, eVisStart: 0, eVisEnd: 0,
        min: previewModel.previewMin, max: previewModel.previewMax,
        candleW: 0,
      });
    } else {
      worker.postMessage({
        type: 'render',
        w: rect.width, h: rect.height, dpr,
        mode: 'candles',
        visStart:  chartModel.visibleCandleRange.startIndex,
        visEnd:    chartModel.visibleCandleRange.endIndex,
        eVisStart: chartModel.equityVisibleRange.startIndex,
        eVisEnd:   chartModel.equityVisibleRange.endIndex,
        min:       chartModel.normalizedMin,
        max:       chartModel.normalizedMax,
        candleW:   chartModel.candleWidth,
        tickRatios: timeTicks.map(t => t.ratio),
        previewRanges: [], previewMin: 0, previewMax: 1,
      });
    }
  }, [chartModel, previewModel, timeTicks, hasPreviewSelection, isWorkerActive]);

  // Fallback path: always render on main thread if worker mode is unavailable.
  useEffect(() => {
    if (isWorkerActive) {
      return;
    }

    // Once transferred to OffscreenCanvas, this DOM canvas can't be used by
    // getContext anymore.
    if (canvasTransferredRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(rect.width * dpr);
    const pixelHeight = Math.round(rect.height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const width = rect.width;
    const height = rect.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    [0, 0.5, 1].forEach((ratio) => {
      const y = Math.round(height * ratio) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    });
    ctx.stroke();

    ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    timeTicks.forEach((tick) => {
      const x = Math.round(tick.ratio * width) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    if (hasPreviewSelection) {
      selectedPreviews.forEach((preview, index) => {
        const range = previewModel.previewRanges[index];
        if (!range) {
          return;
        }

        const span = Math.max(1, range.visEnd - range.visStart);
        ctx.strokeStyle = previewColor(index);
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        let started = false;
        for (let bar = range.visStart; bar <= range.visEnd; bar += 1) {
          const value = preview.values[bar];
          if (!Number.isFinite(value)) {
            continue;
          }
          const x = ((bar - range.visStart) / span) * width;
          const y = scaleY(value, height, previewModel.previewMin, previewModel.previewMax);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      });
      return;
    }

    const visibleStart = chartModel.visibleCandleRange.startIndex;
    const visibleEnd = chartModel.visibleCandleRange.endIndex;
    const span = Math.max(1, visibleEnd - visibleStart);
    const positionBands = buildPositionBands(result.tradeMarkers, result.priceSeries, 1);

    positionBands.forEach((band) => {
      if (band.endIndex < visibleStart || band.startIndex > visibleEnd) {
        return;
      }
      const bandStart = Math.max(band.startIndex, visibleStart);
      const bandEnd = Math.min(band.endIndex, visibleEnd);
      const x = ((bandStart - visibleStart) / span) * width;
      const xEnd = ((bandEnd - visibleStart) / span) * width;
      ctx.fillStyle = band.direction === "long" ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)";
      ctx.fillRect(x, 0, Math.max(2, xEnd - x), height);
    });

    const priceBase = result.priceSeries[0]?.close ?? 1;
    for (let bar = visibleStart; bar <= visibleEnd; bar += 1) {
      const candle = result.priceSeries[bar];
      if (!candle) {
        continue;
      }

      const open = (candle.open / priceBase) * 100;
      const high = (candle.high / priceBase) * 100;
      const low = (candle.low / priceBase) * 100;
      const close = (candle.close / priceBase) * 100;
      const x = ((bar - visibleStart) / span) * width;
      const openY = scaleY(open, height, chartModel.normalizedMin, chartModel.normalizedMax);
      const closeY = scaleY(close, height, chartModel.normalizedMin, chartModel.normalizedMax);
      const highY = scaleY(high, height, chartModel.normalizedMin, chartModel.normalizedMax);
      const lowY = scaleY(low, height, chartModel.normalizedMin, chartModel.normalizedMax);
      const bodyY = Math.min(openY, closeY);
      const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));
      const bodyWidth = Math.max(2, chartModel.candleWidth * (width / chartWidth));
      const bodyX = x - bodyWidth / 2;
      const isUp = close >= open;

      ctx.strokeStyle = "rgba(148, 163, 184, 0.72)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      ctx.fillStyle = isUp ? "rgba(52, 211, 153, 0.62)" : "rgba(248, 113, 113, 0.58)";
      ctx.strokeStyle = "rgba(15, 17, 22, 0.45)";
      ctx.lineWidth = 0.8;
      ctx.fillRect(bodyX, bodyY, bodyWidth, bodyHeight);
      ctx.strokeRect(bodyX, bodyY, bodyWidth, bodyHeight);
    }

    const eqStart = chartModel.equityVisibleRange.startIndex;
    const eqEnd = chartModel.equityVisibleRange.endIndex;
    const eqSpan = Math.max(1, eqEnd - eqStart);
    const equityBase = result.equityCurve[0]?.equity ?? 1;
    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    let started = false;
    for (let bar = eqStart; bar <= eqEnd; bar += 1) {
      const point = result.equityCurve[bar];
      if (!point) {
        continue;
      }
      const equity = (point.equity / equityBase) * 100;
      const x = ((bar - eqStart) / eqSpan) * width;
      const y = scaleY(equity, height, chartModel.normalizedMin, chartModel.normalizedMax);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }, [
    chartModel,
    chartWidth,
    hasPreviewSelection,
    isWorkerActive,
    previewModel,
    result.equityCurve,
    result.priceSeries,
    result.tradeMarkers,
    selectedPreviews,
    timeTicks,
  ]);

  return (
    <section className="results-drawer">
      <aside className="results-sidebar">
        <div ref={metricsShellRef} className="results-sidebar-content">
          <div className="results-sidebar-header">
            <span className="results-eyebrow">Backtest Results</span>
            <h2>{result.graphName}</h2>
          </div>

          <div className="results-metrics">
            <article>
              <span>Total Trades</span>
              <strong>{result.summary.totalTrades}</strong>
            </article>
            <article>
              <span>Win Rate</span>
              <strong>{formatPercent(result.summary.winRate)}</strong>
            </article>
            <article>
              <span>Net Profit</span>
              <strong>{formatMoney(result.summary.netProfit)}</strong>
            </article>
            <article>
              <span>Ending Equity</span>
              <strong>{formatMoney(result.summary.endingEquity)}</strong>
            </article>
            <article>
              <span>Max Drawdown</span>
              <strong>{formatPercent(result.summary.maxDrawdown)}</strong>
            </article>
            <article>
              <span>Strategy Return</span>
              <strong>{formatPercent(result.summary.strategyReturn)}</strong>
            </article>
            <article>
              <span>Buy & Hold</span>
              <strong>{formatPercent(result.summary.buyHoldReturn)}</strong>
            </article>
            <article>
              <span>Sharpe Ratio</span>
              <strong>{formatMetric(result.summary.sharpeRatio)}</strong>
            </article>
          </div>
        </div>
      </aside>

      <div className="results-chart-panel">
        <div className="results-chart-header">
          {hasPreviewSelection ? (
            <div className="results-chart-legend">
              {selectedPreviews.map((preview, index) => (
                <span key={preview.edgeId} className="legend-chip">
                  <i
                    className="legend-swatch is-strategy"
                    style={{ background: previewColor(index) }}
                  />
                  {preview.sourceNodeTitle} · {preview.sourcePortLabel}
                </span>
              ))}
            </div>
          ) : (
            <div className="results-chart-legend">
              <span className="legend-chip">
                <i className="legend-swatch is-price" />
                Product Price
              </span>
              <span className="legend-chip">
                <i className="legend-swatch is-strategy" />
                Strategy
              </span>
              <span className="legend-chip">
                <i className="legend-swatch is-long-band" />
                Long Position
              </span>
              <span className="legend-chip">
                <i className="legend-swatch is-short-band" />
                Short Position
              </span>
            </div>
          )}
          <button
            className="export-csv-button"
            onClick={() => exportTradesToCSV(result)}
            title="Export trades as CSV"
          >
            Export CSV
          </button>
        </div>

        <div className="results-chart-stage">
          <div className="results-axis is-left">
            {(hasPreviewSelection ? previewModel.previewTicks : chartModel.ticks).map((tick) => (
              <span key={tick}>{hasPreviewSelection ? formatSeriesTick(tick) : formatNormalizedTick(tick)}</span>
            ))}
          </div>

          <div
            ref={frameRef}
            className={`results-chart-frame ${isPanning ? "is-panning" : ""}`}
            onWheel={handleChartWheel}
            onMouseDown={handleChartMouseDown}
            role="presentation"
          >
            <canvas ref={canvasRef} className="results-chart" aria-hidden="true" />

            <div className="results-time-axis" aria-hidden="true">
              {timeTicks.map((tick, index) => (
                <span
                  key={`time-label-${tick.key}`}
                  className={`results-time-tick ${index === 0 ? "is-start" : ""} ${index === timeTicks.length - 1 ? "is-end" : ""}`}
                  style={{ left: `${tick.ratio * 100}%` }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
          </div>

          <div className="results-axis is-right">
            {(hasPreviewSelection ? previewModel.previewTicks : chartModel.ticks).map((tick) => (
              <span key={tick}>{hasPreviewSelection ? formatSeriesTick(tick) : formatNormalizedTick(tick)}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function arePreviewArraysEqual(left: SeriesPreview[], right: SeriesPreview[]) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

export const ResultsPanel = memo(ResultsPanelComponent, (prev, next) => {
  return (
    prev.result === next.result &&
    prev.onPreferredHeightChange === next.onPreferredHeightChange &&
    arePreviewArraysEqual(prev.selectedPreviews, next.selectedPreviews)
  );
});
