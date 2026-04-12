import type { NodeModule } from "../../core/types";

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" ? value : fallback;
}

function calculateRsi(close: number[], period: number) {
  if (close.length === 0) {
    return [];
  }

  const result = new Array<number>(close.length).fill(50);
  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= period && index < close.length; index += 1) {
    const change = close[index] - close[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }

  let avgGain = gains / Math.max(1, period);
  let avgLoss = losses / Math.max(1, period);

  for (let index = period + 1; index < close.length; index += 1) {
    const change = close[index] - close[index - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result[index] = Number((100 - 100 / (1 + rs)).toFixed(2));
  }

  return result;
}

const rsiNode: NodeModule = {
  definition: {
    type: "indicator.rsi",
    title: "RSI",
    description: "Calculate relative strength index from candle data.",
    color: "#dd6b20",
    inputs: [{ id: "dataset", label: "Dataset", kind: "dataset" }],
    outputs: [{ id: "series", label: "RSI", kind: "series" }],
    fields: [{ key: "period", label: "Period", type: "number", defaultValue: 14 }],
  },
  executor: {
    type: "indicator.rsi",
    run: ({ node, inputs }) => {
      const dataset = inputs.dataset as { close?: number[]; timestamps?: string[] } | undefined;
      const close = dataset?.close;
      const period = Math.max(2, Math.floor(readNumber(node.config.period, 14)));

      if (!close || close.length === 0) {
        throw new Error("RSI requires dataset input.");
      }

      return {
        values: calculateRsi(close, period),
        timestamps: dataset.timestamps ?? [],
      };
    },
  },
};

export default rsiNode;
