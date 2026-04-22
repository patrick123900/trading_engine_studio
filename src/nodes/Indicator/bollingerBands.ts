import type { NodeModule } from "../../core/types";

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toSeriesInput(value: unknown) {
  if (value && typeof value === "object" && "values" in value) {
    const values = (value as { values?: unknown }).values;
    const timestamps = (value as { timestamps?: unknown }).timestamps;
    if (Array.isArray(values) && values.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
      return {
        values,
        timestamps: Array.isArray(timestamps)
          ? timestamps.filter((entry): entry is string => typeof entry === "string")
          : [],
      };
    }
  }

  if (value && typeof value === "object" && "close" in value) {
    const close = (value as { close?: unknown }).close;
    const timestamps = (value as { timestamps?: unknown }).timestamps;
    if (Array.isArray(close) && close.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
      return {
        values: close,
        timestamps: Array.isArray(timestamps)
          ? timestamps.filter((entry): entry is string => typeof entry === "string")
          : [],
      };
    }
  }

  return null;
}

function calculateBollinger(values: number[], length: number, multiplier: number) {
  const middle: number[] = [];
  const upper: number[] = [];
  const lower: number[] = [];

  for (let index = 0; index < values.length; index += 1) {
    const start = Math.max(0, index - length + 1);
    const window = values.slice(start, index + 1);
    const mean = window.reduce((sum, value) => sum + value, 0) / Math.max(1, window.length);
    const variance =
      window.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      Math.max(1, window.length);
    const stdDev = Math.sqrt(variance);

    middle.push(Number(mean.toFixed(4)));
    upper.push(Number((mean + multiplier * stdDev).toFixed(4)));
    lower.push(Number((mean - multiplier * stdDev).toFixed(4)));
  }

  return { middle, upper, lower };
}

const bollingerBandsNode: NodeModule = {
  definition: {
    type: "indicator.bollingerBands",
    title: "Bollinger Bands",
    description: "Calculate upper, middle, and lower Bollinger Bands from a numeric series.",
    color: "#0ea5a8",
    inputs: [{ id: "source", label: "Source", kind: "series" }],
    outputs: [
      { id: "middle", label: "Middle", kind: "series" },
      { id: "upper", label: "Upper", kind: "series" },
      { id: "lower", label: "Lower", kind: "series" },
    ],
    fields: [
      { key: "length", label: "Length", type: "number", defaultValue: 20 },
      { key: "multiplier", label: "StdDev Multiplier", type: "number", defaultValue: 2 },
    ],
  },
  executor: {
    type: "indicator.bollingerBands",
    run: ({ node, inputs }) => {
      const source = toSeriesInput(inputs.source);
      const length = Math.max(1, Math.floor(readNumber(node.config.length, 20)));
      const multiplier = Math.max(0.0001, readNumber(node.config.multiplier, 2));

      if (!source || source.values.length === 0) {
        throw new Error("Bollinger Bands requires a dataset or numeric series input.");
      }

      const bands = calculateBollinger(source.values, length, multiplier);
      return {
        middle: {
          values: bands.middle,
          timestamps: source.timestamps,
        },
        upper: {
          values: bands.upper,
          timestamps: source.timestamps,
        },
        lower: {
          values: bands.lower,
          timestamps: source.timestamps,
        },
      };
    },
  },
};

export default bollingerBandsNode;
