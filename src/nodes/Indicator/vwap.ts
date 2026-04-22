import type { NodeModule } from "../../core/types";

type DatasetInput = {
  timestamps?: string[];
  open?: number[];
  high?: number[];
  low?: number[];
  close?: number[];
  volume?: number[];
};

function toNumericSeries(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    return value;
  }

  if (value && typeof value === "object" && "values" in value) {
    const values = (value as { values?: unknown }).values;
    if (Array.isArray(values) && values.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
      return values;
    }
  }

  return null;
}

function normalizeTimestamps(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as string[];
  }

  return input.filter((entry): entry is string => typeof entry === "string");
}

function normalizeVolume(volume: number[], targetLength: number) {
  if (targetLength <= 0) {
    return [] as number[];
  }

  if (volume.length === 0) {
    return null;
  }

  if (volume.length === targetLength) {
    return volume;
  }

  if (volume.length === 1) {
    return Array.from({ length: targetLength }, () => volume[0]);
  }

  if (volume.length > targetLength) {
    return volume.slice(0, targetLength);
  }

  const tail = volume[volume.length - 1];
  return [...volume, ...Array.from({ length: targetLength - volume.length }, () => tail)];
}

function resolvePriceSeries(dataset: DatasetInput, mode: string) {
  const open = dataset.open ?? [];
  const high = dataset.high ?? [];
  const low = dataset.low ?? [];
  const close = dataset.close ?? [];
  const length = Math.max(open.length, high.length, low.length, close.length);

  if (length === 0) {
    return [] as number[];
  }

  return Array.from({ length }, (_, index) => {
    const o = open[index] ?? close[index] ?? high[index] ?? low[index] ?? 0;
    const h = high[index] ?? close[index] ?? o;
    const l = low[index] ?? close[index] ?? o;
    const c = close[index] ?? o;

    switch (mode) {
      case "close":
        return c;
      case "hl2":
        return (h + l) / 2;
      case "ohlc4":
        return (o + h + l + c) / 4;
      case "hlc3":
      default:
        return (h + l + c) / 3;
    }
  });
}

function calculateVwap(prices: number[], volumes: number[], timestamps: string[], resetMode: string) {
  const result: number[] = new Array(prices.length).fill(0);
  let cumulativePv = 0;
  let cumulativeVolume = 0;
  let currentSessionKey = "";

  for (let index = 0; index < prices.length; index += 1) {
    const price = prices[index] ?? 0;
    const volume = Math.max(0, volumes[index] ?? 0);
    const timestamp = timestamps[index] ?? "";

    if (resetMode === "day") {
      const sessionKey = timestamp ? timestamp.slice(0, 10) : `${Math.floor(index / 1440)}`;
      if (index === 0 || sessionKey !== currentSessionKey) {
        cumulativePv = 0;
        cumulativeVolume = 0;
        currentSessionKey = sessionKey;
      }
    }

    cumulativePv += price * volume;
    cumulativeVolume += volume;

    result[index] = Number((cumulativeVolume > 0 ? cumulativePv / cumulativeVolume : price).toFixed(4));
  }

  return result;
}

const vwapNode: NodeModule = {
  definition: {
    type: "indicator.vwap",
    title: "VWAP",
    description: "Calculate volume weighted average price from candle data.",
    color: "#0ea5a8",
    inputs: [
      { id: "dataset", label: "Dataset", kind: "dataset" },
      { id: "volume", label: "Volume Override", kind: "series" },
    ],
    outputs: [{ id: "series", label: "VWAP", kind: "series" }],
    fields: [
      {
        key: "priceSource",
        label: "Price Source",
        type: "select",
        defaultValue: "hlc3",
        options: [
          { label: "HLC3", value: "hlc3" },
          { label: "Close", value: "close" },
          { label: "HL2", value: "hl2" },
          { label: "OHLC4", value: "ohlc4" },
        ],
      },
      {
        key: "reset",
        label: "Reset",
        type: "select",
        defaultValue: "none",
        options: [
          { label: "No Reset", value: "none" },
          { label: "Daily", value: "day" },
        ],
      },
    ],
  },
  executor: {
    type: "indicator.vwap",
    run: ({ node, inputs }) => {
      const dataset = (inputs.dataset as DatasetInput | undefined) ?? {};
      const timestamps = normalizeTimestamps(dataset.timestamps);
      const prices = resolvePriceSeries(dataset, String(node.config.priceSource ?? "hlc3").toLowerCase());
      const overrideVolume = toNumericSeries(inputs.volume);
      const baseVolume = overrideVolume ?? dataset.volume ?? [];
      const volume = normalizeVolume(baseVolume, prices.length);
      const resetMode = String(node.config.reset ?? "none").toLowerCase();

      if (prices.length === 0) {
        throw new Error("VWAP requires dataset input with OHLC values.");
      }

      if (!volume || volume.length === 0) {
        throw new Error("VWAP requires volume data from dataset or Volume Override input.");
      }

      if (!volume.some((entry) => entry > 0)) {
        throw new Error("VWAP requires at least one positive volume value.");
      }

      return {
        values: calculateVwap(prices, volume, timestamps, resetMode),
        timestamps,
      };
    },
  },
};

export default vwapNode;
