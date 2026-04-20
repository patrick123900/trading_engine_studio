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
  const panStateRef = useRef<{ startX: number; start: number; span: number } | null>(null);
  const chartWidth = 900;
  const chartHeight = 280;
  const hasPreviewSelection = selectedPreviews.length > 0;
  const [viewWindow, setViewWindow] = useState({ start: 0, end: 1 });
  const [isPanning, setIsPanning] = useState(false);

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
      setViewWindow(clampWindow({ start: nextStart, end: nextStart + pan.span }, minViewSpan));
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
      const zoomFactor = Math.exp(event.deltaY * 0.0012);
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
      normalizedCandles,
      visibleCandleRange,
      normalizedMin,
      normalizedMax,
      strategyPath: buildPartialPath(
        normalizedEquityCurve.map((point) => point.equity),
        chartWidth,
        chartHeight,
        normalizedMin,
        normalizedMax,
        visibleEquityRange.startIndex,
        visibleEquityRange.endIndex,
      ),
      candleWidth: Math.max(3, chartWidth / Math.max(20, totalVisibleCandles) * 0.55),
      ticks: [normalizedMax, (normalizedMax + normalizedMin) / 2, normalizedMin],
      positionBands: buildPositionBands(result.tradeMarkers, result.priceSeries, chartWidth),
    };
  }, [chartHeight, chartWidth, result, viewWindow]);

  const previewModel = useMemo(() => {
    const previewSlices = selectedPreviews
      .map((preview) => {
        const range = indexRangeFromWindow(preview.values.length, viewWindow);
        return {
          preview,
          range,
          values: preview.values.slice(range.startIndex, range.endIndex + 1),
        };
      })
      .filter((entry) => entry.values.length > 0);
    const allPreviewValues = previewSlices.flatMap((entry) => entry.values);
    const previewMinBase = allPreviewValues.length > 0 ? Math.min(...allPreviewValues) : 0;
    const previewMaxBase = allPreviewValues.length > 0 ? Math.max(...allPreviewValues) : 1;
    const previewPadding = (previewMaxBase - previewMinBase || 1) * 0.05;
    const previewMin = previewMinBase - previewPadding;
    const previewMax = previewMaxBase + previewPadding;

    return {
      previewMin,
      previewMax,
      previewTicks: [previewMax, (previewMax + previewMin) / 2, previewMin],
      previewPaths: selectedPreviews.map((preview) => {
        const range = indexRangeFromWindow(preview.values.length, viewWindow);
        return {
          preview,
          path: buildPartialPath(
            preview.values,
            chartWidth,
            chartHeight,
            previewMin,
            previewMax,
            range.startIndex,
            range.endIndex,
          ),
        };
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
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="results-chart" preserveAspectRatio="none" aria-hidden="true">
              {timeTicks.map((tick) => (
                <line
                  key={`time-grid-${tick.key}`}
                  x1={tick.ratio * chartWidth}
                  x2={tick.ratio * chartWidth}
                  y1={0}
                  y2={chartHeight}
                  className="results-grid-line results-grid-line-time"
                />
              ))}

              {[0, 0.5, 1].map((ratio) => (
                <line
                  key={ratio}
                  x1="0"
                  x2={chartWidth}
                  y1={chartHeight * ratio}
                  y2={chartHeight * ratio}
                  className="results-grid-line"
                />
              ))}

              {hasPreviewSelection ? (
                <>
                  {previewModel.previewPaths.map(({ preview, path }, index) => (
                    <path
                      key={preview.edgeId}
                      d={path}
                      className="results-line is-strategy"
                      style={{ stroke: previewColor(index) }}
                    />
                  ))}
                </>
              ) : (
                <>
                  {chartModel.positionBands
                    .map((band, index) => ({ band, index }))
                    .filter(({ band }) =>
                      band.endIndex >= chartModel.visibleCandleRange.startIndex &&
                      band.startIndex <= chartModel.visibleCandleRange.endIndex,
                    )
                    .map(({ band, index }) => {
                      const span = Math.max(1, chartModel.visibleCandleRange.endIndex - chartModel.visibleCandleRange.startIndex);
                      const visibleStart = Math.max(band.startIndex, chartModel.visibleCandleRange.startIndex);
                      const visibleEnd = Math.min(band.endIndex, chartModel.visibleCandleRange.endIndex);
                      const x = ((visibleStart - chartModel.visibleCandleRange.startIndex) / span) * chartWidth;
                      const xEnd = ((visibleEnd - chartModel.visibleCandleRange.startIndex) / span) * chartWidth;

                      return (
                        <rect
                          key={`${band.direction}-${index}-${band.startIndex}`}
                          x={x}
                          y="0"
                          width={Math.max(2, xEnd - x)}
                          height={chartHeight}
                          className={`results-position-band is-${band.direction}`}
                        />
                      );
                    })}

                  {chartModel.normalizedCandles
                    .slice(chartModel.visibleCandleRange.startIndex, chartModel.visibleCandleRange.endIndex + 1)
                    .map((candle: CandlePoint, offset) => {
                    const span = Math.max(1, chartModel.visibleCandleRange.endIndex - chartModel.visibleCandleRange.startIndex);
                    const x = (offset / span) * chartWidth;
                    const openY = scaleY(candle.open, chartHeight, chartModel.normalizedMin, chartModel.normalizedMax);
                    const closeY = scaleY(candle.close, chartHeight, chartModel.normalizedMin, chartModel.normalizedMax);
                    const highY = scaleY(candle.high, chartHeight, chartModel.normalizedMin, chartModel.normalizedMax);
                    const lowY = scaleY(candle.low, chartHeight, chartModel.normalizedMin, chartModel.normalizedMax);
                    const bodyY = Math.min(openY, closeY);
                    const bodyHeight = Math.max(2, Math.abs(closeY - openY));
                    const isUp = candle.close >= candle.open;

                    return (
                      <g key={candle.timestamp} className={`results-candle ${isUp ? "is-up" : "is-down"}`}>
                        <line x1={x} x2={x} y1={highY} y2={lowY} className="results-candle-wick" />
                        <rect
                          x={x - chartModel.candleWidth / 2}
                          y={bodyY}
                          width={chartModel.candleWidth}
                          height={bodyHeight}
                          rx="1.2"
                          className="results-candle-body"
                        />
                      </g>
                    );
                  })}

                  <path d={chartModel.strategyPath} className="results-line is-strategy" />
                </>
              )}
            </svg>

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
