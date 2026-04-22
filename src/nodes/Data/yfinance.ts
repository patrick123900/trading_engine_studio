import type { NodeModule } from "../../core/types";

const MIN_BARS = 20;
const MAX_BARS = 5000;
const REQUEST_TIMEOUT_MS = 3500;
const FALLBACK_REQUEST_TIMEOUT_MS = 12000;
const FETCH_ATTEMPTS = 2;
const FAILURE_COOLDOWN_MS = 15000;

function resolveLookbackBars(value: unknown) {
  if (value === undefined || value === null) {
    return MAX_BARS;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return MAX_BARS;
    }

    if (trimmed.toLowerCase() === "null") {
      return MAX_BARS;
    }

    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) {
      return NaN;
    }

    if (numeric === 0) {
      return MAX_BARS;
    }

    return Math.floor(numeric);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return NaN;
    }

    if (value === 0) {
      return MAX_BARS;
    }

    return Math.floor(value);
  }

  return NaN;
}

function normalizeSymbol(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function isValidSymbolFormat(symbol: string) {
  return /^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol);
}

function isKnownInvalidSymbol(symbol: string) {
  return [
    "INVALID",
    "UNKNOWN",
    "FAKE",
    "NULL",
    "NONE",
    "MISSING",
    "DOESNOTEXIST",
    "NOTREAL",
    "TEST",
    "TICKER",
  ].includes(symbol);
}

type MarketDataShape = {
  symbol: string;
  interval: string;
  timestamps: string[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
};

interface YahooChartResponse {
  chart?: {
    error?: {
      description?: string;
    };
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
  };
}

const marketDataCache = new Map<string, MarketDataShape>();
const inFlightMarketDataRequests = new Map<string, Promise<MarketDataShape>>();
const failureCooldownByKey = new Map<string, { untilMs: number; message: string }>();

function intervalToSeconds(interval: string) {
  switch (interval) {
    case "1m":
      return 60;
    case "5m":
      return 5 * 60;
    case "15m":
      return 15 * 60;
    case "1h":
      return 60 * 60;
    default:
      return 24 * 60 * 60;
  }
}

function toYahooInterval(interval: string) {
  return interval === "1h" ? "60m" : interval;
}


function cloneAndClipMarketData(source: MarketDataShape, bars: number): MarketDataShape {
  const count = Math.min(bars, source.close.length);
  return {
    symbol: source.symbol,
    interval: source.interval,
    timestamps: source.timestamps.slice(-count),
    open: source.open.slice(-count),
    high: source.high.slice(-count),
    low: source.low.slice(-count),
    close: source.close.slice(-count),
    volume: source.volume.slice(-count),
  };
}

function delay(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function getProxyOrigin() {
  if (typeof globalThis.location === "object" && typeof globalThis.location.origin === "string") {
    return globalThis.location.origin;
  }

  return null;
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Yahoo request failed with status ${response.status}.`);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }

    const textPayload = await response.text();
    try {
      return JSON.parse(textPayload) as T;
    } catch {
      const jsonStart = textPayload.indexOf('{"chart"');
      if (jsonStart >= 0) {
        const jsonSlice = textPayload.slice(jsonStart).trim();
        return JSON.parse(jsonSlice) as T;
      }

      throw new Error("Yahoo response was not valid JSON.");
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Yahoo request timed out after ${timeoutMs}ms.`);
    }

    throw error instanceof Error ? error : new Error("Unknown Yahoo fetch failure.");
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function fetchYahooMarketData(symbol: string, interval: string, bars: number): Promise<MarketDataShape> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const secondsPerBar = intervalToSeconds(interval);
  const requestedWindowSeconds = Math.max(secondsPerBar * bars, 24 * 60 * 60);
  const startSeconds = Math.max(0, nowSeconds - requestedWindowSeconds * 2);
  const endpoints: Array<{ url: string; timeoutMs: number }> = [];
  const proxyOrigin = getProxyOrigin();
  if (proxyOrigin) {
    const proxiedUrl = new URL(`/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}`, proxyOrigin);
    proxiedUrl.searchParams.set("interval", toYahooInterval(interval));
    proxiedUrl.searchParams.set("period1", String(startSeconds));
    proxiedUrl.searchParams.set("period2", String(nowSeconds));
    proxiedUrl.searchParams.set("events", "history");
    proxiedUrl.searchParams.set("includePrePost", "false");
    endpoints.push({ url: proxiedUrl.toString(), timeoutMs: REQUEST_TIMEOUT_MS });
  }

  const directUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  directUrl.searchParams.set("interval", toYahooInterval(interval));
  directUrl.searchParams.set("period1", String(startSeconds));
  directUrl.searchParams.set("period2", String(nowSeconds));
  directUrl.searchParams.set("events", "history");
  directUrl.searchParams.set("includePrePost", "false");
  endpoints.push({ url: directUrl.toString(), timeoutMs: REQUEST_TIMEOUT_MS });

  const altDirectUrl = new URL(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  altDirectUrl.searchParams.set("interval", toYahooInterval(interval));
  altDirectUrl.searchParams.set("period1", String(startSeconds));
  altDirectUrl.searchParams.set("period2", String(nowSeconds));
  altDirectUrl.searchParams.set("events", "history");
  altDirectUrl.searchParams.set("includePrePost", "false");
  endpoints.push({ url: altDirectUrl.toString(), timeoutMs: REQUEST_TIMEOUT_MS });

  const jinaUrl = `https://r.jina.ai/http://query1.finance.yahoo.com${directUrl.pathname}${directUrl.search}`;
  endpoints.push({ url: jinaUrl, timeoutMs: FALLBACK_REQUEST_TIMEOUT_MS });

  let payload: YahooChartResponse | null = null;
  let lastErrorMessage = "Unknown Yahoo fetch failure.";

  for (const endpoint of endpoints) {
    try {
      payload = await fetchJsonWithTimeout<YahooChartResponse>(endpoint.url, endpoint.timeoutMs);
      break;
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : "Unknown Yahoo fetch failure.";
    }
  }

  if (!payload) {
    throw new Error(lastErrorMessage);
  }

  const chartError = payload.chart?.error;
  if (chartError?.description) {
    throw new Error(chartError.description);
  }

  const firstResult = payload.chart?.result?.[0];
  const timestamps = firstResult?.timestamp ?? [];
  const quote = firstResult?.indicators?.quote?.[0];
  const open = quote?.open ?? [];
  const high = quote?.high ?? [];
  const low = quote?.low ?? [];
  const close = quote?.close ?? [];
  const volume = quote?.volume ?? [];

  const rows = timestamps
    .map((timestamp, index) => {
      const openValue = open[index];
      const highValue = high[index];
      const lowValue = low[index];
      const closeValue = close[index];
      const volumeValue = volume[index];

      if (
        !Number.isFinite(timestamp) ||
        !Number.isFinite(openValue) ||
        !Number.isFinite(highValue) ||
        !Number.isFinite(lowValue) ||
        !Number.isFinite(closeValue) ||
        !Number.isFinite(volumeValue)
      ) {
        return null;
      }

      return {
        timestamp: new Date((timestamp as number) * 1000).toISOString(),
        open: Number((openValue as number).toFixed(2)),
        high: Number((highValue as number).toFixed(2)),
        low: Number((lowValue as number).toFixed(2)),
        close: Number((closeValue as number).toFixed(2)),
        volume: Math.max(0, Math.floor(volumeValue as number)),
      };
    })
    .filter(
      (entry): entry is { timestamp: string; open: number; high: number; low: number; close: number; volume: number } =>
        entry !== null,
    );

  const clipped = rows.slice(-bars);
  if (clipped.length < MIN_BARS) {
    throw new Error(`Yahoo returned ${clipped.length} usable bars.`);
  }

  return {
    symbol,
    interval,
    timestamps: clipped.map((entry) => entry.timestamp),
    open: clipped.map((entry) => entry.open),
    high: clipped.map((entry) => entry.high),
    low: clipped.map((entry) => entry.low),
    close: clipped.map((entry) => entry.close),
    volume: clipped.map((entry) => entry.volume),
  };
}

async function fetchYahooMarketDataWithRetry(symbol: string, interval: string, bars: number) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await fetchYahooMarketData(symbol, interval, bars);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown Yahoo fetch failure.");
      if (attempt < FETCH_ATTEMPTS - 1) {
        await delay(200 * (attempt + 1));
      }
    }
  }

  throw lastError ?? new Error("Unknown Yahoo fetch failure.");
}

const yfinanceNode: NodeModule = {
  definition: {
    type: "data.yfinance",
    title: "YFinance Fetcher",
    description: "Fetch OHLCV candles for a symbol and timeframe.",
    color: "#2f855a",
    inputs: [],
    outputs: [
      { id: "dataset", label: "Dataset", kind: "dataset" },
      { id: "product", label: "Product", kind: "product" },
    ],
    fields: [
      { key: "symbol", label: "Symbol", type: "symbol", defaultValue: "AAPL" },
      {
        key: "interval",
        label: "Interval",
        type: "select",
        defaultValue: "1d",
        options: [
          { label: "1 Minute", value: "1m" },
          { label: "5 Minutes", value: "5m" },
          { label: "15 Minutes", value: "15m" },
          { label: "1 Hour", value: "1h" },
          { label: "1 Day", value: "1d" },
        ],
      },
      { key: "lookback", label: "Lookback Bars", type: "number", defaultValue: "" },
    ],
  },
  executor: {
    type: "data.yfinance",
    run: async ({ node }) => {
      const symbol = normalizeSymbol(node.config.symbol ?? "AAPL");
      const interval = String(node.config.interval ?? "1d");
      const bars = resolveLookbackBars(node.config.lookback);

      if (!symbol) {
        throw new Error("YFinance Fetcher requires a symbol.");
      }

      if (!isValidSymbolFormat(symbol)) {
        throw new Error(`YFinance Fetcher could not fetch "${symbol}". Symbols may only contain letters, numbers, "." or "-".`);
      }

      if (isKnownInvalidSymbol(symbol)) {
        throw new Error(`YFinance Fetcher could not find market data for symbol "${symbol}".`);
      }

      if (!["1d", "1m", "5m", "15m", "1h"].includes(interval)) {
        throw new Error(`YFinance Fetcher does not support interval "${interval}".`);
      }

      if (!Number.isFinite(bars) || bars < MIN_BARS) {
        throw new Error("YFinance Fetcher requires at least 20 lookback bars.");
      }

      if (bars > MAX_BARS) {
        throw new Error("YFinance Fetcher failed because the requested lookback is too large.");
      }

      try {
        const cacheKey = `${symbol}|${interval}`;
        const requestKey = `${symbol}|${interval}|${bars}`;
        let marketData: MarketDataShape;

        const cached = marketDataCache.get(cacheKey);
        if (cached && cached.close.length >= MIN_BARS) {
          return {
            dataset: {
              bars: Math.min(bars, cached.close.length),
              ...cloneAndClipMarketData(cached, bars),
            },
            product: {
              symbol,
              assetType: "equity",
              marketData: cloneAndClipMarketData(cached, bars),
            },
          };
        }

        const cooldown = failureCooldownByKey.get(cacheKey);
        if (cooldown && cooldown.untilMs > Date.now()) {
          throw new Error(
            `Yahoo is temporarily unavailable for ${symbol} (${cooldown.message}). Retry in a few seconds.`,
          );
        }

        try {
          const existing = inFlightMarketDataRequests.get(requestKey);
          if (existing) {
            marketData = await existing;
          } else {
            const started = fetchYahooMarketDataWithRetry(symbol, interval, bars);
            inFlightMarketDataRequests.set(requestKey, started);
            marketData = await started;
          }

          marketDataCache.set(cacheKey, marketData);
          failureCooldownByKey.delete(cacheKey);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown Yahoo fetch failure.";
          failureCooldownByKey.set(cacheKey, {
            untilMs: Date.now() + FAILURE_COOLDOWN_MS,
            message,
          });
          throw new Error(`Unable to fetch live Yahoo candles (${message}).`);
        } finally {
          inFlightMarketDataRequests.delete(requestKey);
        }

        return {
          dataset: {
            bars: marketData.close.length,
            ...marketData,
          },
          product: {
            symbol,
            assetType: "equity",
            marketData,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown fetch failure.";
        throw new Error(`YFinance Fetcher failed for "${symbol}": ${message}`);
      }
    },
  },
};

export default yfinanceNode;
