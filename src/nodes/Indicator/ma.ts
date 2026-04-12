import type { NodeModule } from "../../core/types";

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" ? value : fallback;
}

function toSeriesInput(value: unknown) {
  if (value && typeof value === "object" && "values" in value) {
    const values = (value as { values?: unknown }).values;
    const timestamps = (value as { timestamps?: unknown }).timestamps;
    if (Array.isArray(values) && values.every((entry) => typeof entry === "number")) {
      return {
        values,
        timestamps: Array.isArray(timestamps) ? timestamps.filter((entry): entry is string => typeof entry === "string") : [],
      };
    }
  }

  if (value && typeof value === "object" && "close" in value) {
    const close = (value as { close?: unknown }).close;
    const timestamps = (value as { timestamps?: unknown }).timestamps;
    if (Array.isArray(close) && close.every((entry) => typeof entry === "number")) {
      return {
        values: close,
        timestamps: Array.isArray(timestamps) ? timestamps.filter((entry): entry is string => typeof entry === "string") : [],
      };
    }
  }

  return null;
}

function calculateSma(values: number[], length: number) {
  const result = new Array<number>(values.length).fill(values[0] ?? 0);
  let sum = 0;

  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= length) {
      sum -= values[index - length];
    }

    const divisor = Math.min(index + 1, length);
    result[index] = Number((sum / divisor).toFixed(4));
  }

  return result;
}

function calculateEma(values: number[], length: number) {
  if (values.length === 0) {
    return [];
  }

  const multiplier = 2 / (length + 1);
  const result = new Array<number>(values.length).fill(values[0]);
  result[0] = Number(values[0].toFixed(4));

  for (let index = 1; index < values.length; index += 1) {
    result[index] = Number((values[index] * multiplier + result[index - 1] * (1 - multiplier)).toFixed(4));
  }

  return result;
}

function calculateWma(values: number[], length: number) {
  const result = new Array<number>(values.length).fill(values[0] ?? 0);
  const denominator = (length * (length + 1)) / 2;

  for (let index = 0; index < values.length; index += 1) {
    const windowSize = Math.min(index + 1, length);
    const effectiveDenominator = (windowSize * (windowSize + 1)) / 2;
    let weightedSum = 0;

    for (let offset = 0; offset < windowSize; offset += 1) {
      const weight = windowSize - offset;
      weightedSum += values[index - offset] * weight;
    }

    result[index] = Number((weightedSum / (windowSize === length ? denominator : effectiveDenominator)).toFixed(4));
  }

  return result;
}

function calculateMovingAverage(values: number[], method: string, length: number) {
  switch (method) {
    case "ema":
      return calculateEma(values, length);
    case "wma":
      return calculateWma(values, length);
    case "sma":
    default:
      return calculateSma(values, length);
  }
}

const movingAverageNode: NodeModule = {
  definition: {
    type: "indicator.ma",
    title: "Moving Average",
    description: "Calculate a moving average from a dataset or numeric series.",
    color: "#0ea5a8",
    inputs: [{ id: "source", label: "Source", kind: "series" }],
    outputs: [{ id: "series", label: "MA", kind: "series" }],
    fields: [
      {
        key: "method",
        label: "Method",
        type: "select",
        defaultValue: "sma",
        options: [
          { label: "SMA", value: "sma" },
          { label: "EMA", value: "ema" },
          { label: "WMA", value: "wma" },
        ],
      },
      { key: "length", label: "Length", type: "number", defaultValue: 20 },
    ],
  },
  executor: {
    type: "indicator.ma",
    run: ({ node, inputs }) => {
      const source = toSeriesInput(inputs.source);
      const method = String(node.config.method ?? "sma").toLowerCase();
      const length = Math.max(1, Math.floor(readNumber(node.config.length, 20)));

      if (!source || source.values.length === 0) {
        throw new Error("Moving Average requires a dataset or numeric series input.");
      }

      return {
        values: calculateMovingAverage(source.values, method, length),
        timestamps: source.timestamps,
      };
    },
  },
};

export default movingAverageNode;
