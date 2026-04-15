import { useEffect, useRef } from "react";
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

  const bands: Array<{ x: number; width: number; direction: "long" | "short" }> = [];
  let active: { direction: "long" | "short"; startIndex: number } | null = null;

  for (const entry of sortedMarkers) {
    if (entry.marker.event === "entry") {
      active = { direction: entry.marker.direction, startIndex: entry.index };
      continue;
    }

    if (!active || active.direction !== entry.marker.direction) {
      continue;
    }

    const startX = (active.startIndex / Math.max(1, candles.length - 1)) * width;
    const endX = (entry.index / Math.max(1, candles.length - 1)) * width;
    bands.push({
      x: startX,
      width: Math.max(2, endX - startX),
      direction: active.direction,
    });
    active = null;
  }

  if (active) {
    const startX = (active.startIndex / Math.max(1, candles.length - 1)) * width;
    bands.push({
      x: startX,
      width: Math.max(2, width - startX),
      direction: active.direction,
    });
  }

  return bands;
}

export function ResultsPanel({ result, selectedPreviews, onPreferredHeightChange }: ResultsPanelProps) {
  const metricsShellRef = useRef<HTMLDivElement | null>(null);
  const chartWidth = 900;
  const chartHeight = 280;
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
  const normalizedLows = normalizedCandles.map((point) => point.low);
  const normalizedHighs = normalizedCandles.map((point) => point.high);
  const normalizedEquityValues = normalizedEquityCurve.map((point) => point.equity);
  const combinedMin = Math.min(...normalizedLows, ...normalizedEquityValues);
  const combinedMax = Math.max(...normalizedHighs, ...normalizedEquityValues);
  const normalizedMin = combinedMin - (combinedMax - combinedMin || 1) * 0.05;
  const normalizedMax = combinedMax + (combinedMax - combinedMin || 1) * 0.05;
  const strategyPath = buildPath(normalizedEquityCurve, chartWidth, chartHeight, normalizedMin, normalizedMax);
  const hasPreviewSelection = selectedPreviews.length > 0;
  const previewValueSets = selectedPreviews.map((preview) => preview.values).filter((values) => values.length > 0);
  const allPreviewValues = previewValueSets.flat();
  const previewMinBase = allPreviewValues.length > 0 ? Math.min(...allPreviewValues) : 0;
  const previewMaxBase = allPreviewValues.length > 0 ? Math.max(...allPreviewValues) : 1;
  const previewPadding = (previewMaxBase - previewMinBase || 1) * 0.05;
  const previewMin = previewMinBase - previewPadding;
  const previewMax = previewMaxBase + previewPadding;
  const previewPaths = selectedPreviews.map((preview) => ({
    preview,
    path: buildLinePath(preview.values, chartWidth, chartHeight, previewMin, previewMax),
  }));
  const candleWidth = Math.max(3, chartWidth / Math.max(20, normalizedCandles.length) * 0.55);
  const ticks = [normalizedMax, (normalizedMax + normalizedMin) / 2, normalizedMin];
  const previewTicks = [previewMax, (previewMax + previewMin) / 2, previewMin];
  const positionBands = buildPositionBands(result.tradeMarkers, result.priceSeries, chartWidth);

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
            {(hasPreviewSelection ? previewTicks : ticks).map((tick) => (
              <span key={tick}>{hasPreviewSelection ? formatSeriesTick(tick) : formatNormalizedTick(tick)}</span>
            ))}
          </div>

          <div className="results-chart-frame">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="results-chart" preserveAspectRatio="none" aria-hidden="true">
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
                  {previewPaths.map(({ preview, path }, index) => (
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
                  {positionBands.map((band, index) => (
                    <rect
                      key={`${band.direction}-${index}-${band.x}`}
                      x={band.x}
                      y="0"
                      width={band.width}
                      height={chartHeight}
                      className={`results-position-band is-${band.direction}`}
                    />
                  ))}

                  {normalizedCandles.map((candle: CandlePoint, index) => {
                    const x = (index / Math.max(1, normalizedCandles.length - 1)) * chartWidth;
                    const openY = scaleY(candle.open, chartHeight, normalizedMin, normalizedMax);
                    const closeY = scaleY(candle.close, chartHeight, normalizedMin, normalizedMax);
                    const highY = scaleY(candle.high, chartHeight, normalizedMin, normalizedMax);
                    const lowY = scaleY(candle.low, chartHeight, normalizedMin, normalizedMax);
                    const bodyY = Math.min(openY, closeY);
                    const bodyHeight = Math.max(2, Math.abs(closeY - openY));
                    const isUp = candle.close >= candle.open;

                    return (
                      <g key={candle.timestamp} className={`results-candle ${isUp ? "is-up" : "is-down"}`}>
                        <line x1={x} x2={x} y1={highY} y2={lowY} className="results-candle-wick" />
                        <rect
                          x={x - candleWidth / 2}
                          y={bodyY}
                          width={candleWidth}
                          height={bodyHeight}
                          rx="1.2"
                          className="results-candle-body"
                        />
                      </g>
                    );
                  })}

                  <path d={strategyPath} className="results-line is-strategy" />
                </>
              )}
            </svg>
          </div>

          <div className="results-axis is-right">
            {(hasPreviewSelection ? previewTicks : ticks).map((tick) => (
              <span key={tick}>{hasPreviewSelection ? formatSeriesTick(tick) : formatNormalizedTick(tick)}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
