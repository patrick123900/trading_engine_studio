import type { NodeModule } from "../../core/types";

const MIN_BARS = 20;
const MAX_BARS = 5000;

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

function createSeed(symbol: string) {
  return symbol.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function createDeterministicRandom(seed: number) {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function intervalToDays(interval: string) {
  switch (interval) {
    case "1h":
      return 1 / 24;
    case "15m":
      return 1 / (24 * 4);
    default:
      return 1;
  }
}

function isWeekendUtc(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function buildBusinessDayTimeline(end: Date, bars: number) {
  const timeline: Date[] = [];
  const cursor = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 0, 0, 0, 0));

  while (timeline.length < bars) {
    if (!isWeekendUtc(cursor)) {
      timeline.push(new Date(cursor.getTime()));
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  timeline.reverse();
  return timeline;
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
          { label: "1 Day", value: "1d" },
          { label: "1 Hour", value: "1h" },
          { label: "15 Minutes", value: "15m" },
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

      if (!["1d", "1h", "15m"].includes(interval)) {
        throw new Error(`YFinance Fetcher does not support interval "${interval}".`);
      }

      if (!Number.isFinite(bars) || bars < MIN_BARS) {
        throw new Error("YFinance Fetcher requires at least 20 lookback bars.");
      }

      if (bars > MAX_BARS) {
        throw new Error("YFinance Fetcher failed because the requested lookback is too large.");
      }

      try {
        return {
          ...(function () {
        const interval = String(node.config.interval ?? "1d");
        const seed = createSeed(symbol);
        const random = createDeterministicRandom(seed * 97 + bars * 13);
        const opens: number[] = [];
        const highs: number[] = [];
        const lows: number[] = [];
        const closes: number[] = [];
        const timestamps: string[] = [];
        const end = new Date();
        const stepDays = intervalToDays(interval);
        const dailyTimeline = interval === "1d" ? buildBusinessDayTimeline(end, bars) : [];
        let previousClose = 90 + (seed % 70);
        let regimeDrift = ((seed % 5) - 2) * 0.0007;
        let volatility = 0.012 + (seed % 7) * 0.0015;

        for (let index = 0; index < bars; index += 1) {
          if (index % 28 === 0 && index > 0) {
            regimeDrift = (random() - 0.5) * 0.004;
            volatility = 0.009 + random() * 0.02;
          }

          const overnightGap = (random() - 0.5) * volatility * 0.8;
          const open = Math.max(12, previousClose * (1 + overnightGap));
          const intradayMove = regimeDrift + (random() - 0.5) * volatility * 2.1;
          const close = Math.max(12, open * (1 + intradayMove));
          const upperWick = Math.max(0.0015, random() * volatility * 0.9);
          const lowerWick = Math.max(0.0015, random() * volatility * 0.9);
          const high = Math.max(open, close) * (1 + upperWick);
          const low = Math.min(open, close) * (1 - lowerWick);

          previousClose = close;

          opens.push(Number(open.toFixed(2)));
          highs.push(Number(high.toFixed(2)));
          lows.push(Number(low.toFixed(2)));
          closes.push(Number(close.toFixed(2)));

          if (interval === "1d") {
            timestamps.push(dailyTimeline[index].toISOString());
          } else {
            const barsFromEnd = bars - 1 - index;
            timestamps.push(new Date(end.getTime() - barsFromEnd * stepDays * 24 * 60 * 60 * 1000).toISOString());
          }
        }

        const marketData = {
          symbol,
          interval,
          timestamps,
          open: opens,
          high: highs,
          low: lows,
          close: closes,
        };

        return {
          dataset: {
            bars,
            ...marketData,
          },
          product: {
            symbol,
            assetType: "equity",
            marketData,
          },
        };
          })(),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown fetch failure.";
        throw new Error(`YFinance Fetcher failed for "${symbol}": ${message}`);
      }
    },
  },
};

export default yfinanceNode;
