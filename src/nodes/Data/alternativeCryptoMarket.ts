import type { NodeModule } from "../../core/types";

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" ? value : fallback;
}

function normalizeSymbol(value: unknown) {
  return String(value ?? "BTCUSDT")
    .trim()
    .toUpperCase();
}

function isValidSymbolFormat(symbol: string) {
  return /^[A-Z0-9]{5,20}$/.test(symbol);
}

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

const cryptoMarketDataNode: NodeModule = {
  definition: {
    type: "data.alternativeCryptoMarket",
    title: "Crypto Market Data",
    description: "Fetch historical crypto OHLC candles from Binance public market data.",
    color: "#2f855a",
    inputs: [],
    outputs: [
      { id: "dataset", label: "Dataset", kind: "dataset" },
      { id: "product", label: "Product", kind: "product" },
    ],
    fields: [
      { key: "symbol", label: "Symbol", type: "text", defaultValue: "BTCUSDT" },
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
          { label: "4 Hours", value: "4h" },
          { label: "1 Day", value: "1d" },
        ],
      },
      { key: "lookback", label: "Lookback Bars", type: "number", defaultValue: 500 },
    ],
  },
  executor: {
    type: "data.alternativeCryptoMarket",
    run: async ({ node }) => {
      const symbol = normalizeSymbol(node.config.symbol);
      const interval = String(node.config.interval ?? "1d");
      const lookback = Math.max(10, Math.min(1000, Math.floor(readNumber(node.config.lookback, 500))));

      if (!symbol) {
        throw new Error("Crypto Market Data requires a symbol.");
      }

      if (!isValidSymbolFormat(symbol)) {
        throw new Error(`Crypto Market Data symbol "${symbol}" is not valid Binance market format.`);
      }

      if (!["1m", "5m", "15m", "1h", "4h", "1d"].includes(interval)) {
        throw new Error(`Crypto Market Data does not support interval "${interval}".`);
      }

      const url = new URL("https://api.binance.com/api/v3/klines");
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("interval", interval);
      url.searchParams.set("limit", String(lookback));

      let payload: BinanceKline[];

      try {
        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        payload = (await response.json()) as BinanceKline[];
      } catch (error) {
        throw new Error(
          `Crypto Market Data failed to fetch ${symbol}: ${error instanceof Error ? error.message : "Unknown error."}`,
        );
      }

      if (!Array.isArray(payload) || payload.length === 0) {
        throw new Error(`Crypto Market Data returned no candles for "${symbol}".`);
      }

      const timestamps = payload.map((entry) => new Date(entry[0]).toISOString());
      const open = payload.map((entry) => Number.parseFloat(entry[1]));
      const high = payload.map((entry) => Number.parseFloat(entry[2]));
      const low = payload.map((entry) => Number.parseFloat(entry[3]));
      const close = payload.map((entry) => Number.parseFloat(entry[4]));

      if (
        open.some((value) => !Number.isFinite(value)) ||
        high.some((value) => !Number.isFinite(value)) ||
        low.some((value) => !Number.isFinite(value)) ||
        close.some((value) => !Number.isFinite(value))
      ) {
        throw new Error(`Crypto Market Data received malformed candle data for "${symbol}".`);
      }

      const marketData = {
        symbol,
        interval,
        timestamps,
        open,
        high,
        low,
        close,
      };

      return {
        dataset: {
          bars: payload.length,
          ...marketData,
        },
        product: {
          symbol,
          assetType: "crypto",
          marketData,
        },
      };
    },
  },
};

export default cryptoMarketDataNode;
