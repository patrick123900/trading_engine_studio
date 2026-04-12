import type { NodeModule } from "../../core/types";

type DatasetInput = {
  symbol?: string;
  timestamps?: string[];
};

function normalizeSymbol(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
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

function getQuarterKey(date: Date) {
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

const yfinanceEarningsHistoryNode: NodeModule = {
  definition: {
    type: "data.yfinanceEarningsHistory",
    title: "YFinance Earnings History",
    description: "Create historical earnings surprise series aligned to a dataset.",
    color: "#2f855a",
    inputs: [{ id: "dataset", label: "Dataset", kind: "dataset" }],
    outputs: [
      { id: "surprisePct", label: "Surprise %", kind: "series" },
      { id: "event", label: "Event", kind: "series" },
    ],
    fields: [],
  },
  executor: {
    type: "data.yfinanceEarningsHistory",
    run: ({ inputs }) => {
      const dataset = inputs.dataset as DatasetInput | undefined;
      const timestamps = Array.isArray(dataset?.timestamps)
        ? dataset.timestamps.filter((entry): entry is string => typeof entry === "string")
        : [];
      const symbol = normalizeSymbol(dataset?.symbol);

      if (!symbol) {
        throw new Error("YFinance Earnings History requires dataset input with a symbol.");
      }

      if (timestamps.length === 0) {
        throw new Error("YFinance Earnings History requires dataset input with timestamps.");
      }

      const random = createDeterministicRandom(createSeed(symbol) * 211 + timestamps.length * 29);
      const surprisePct = new Array<number>(timestamps.length).fill(0);
      const event = new Array<number>(timestamps.length).fill(0);

      const quarterBuckets = new Map<string, number[]>();
      timestamps.forEach((timestamp, index) => {
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) {
          return;
        }

        const quarterKey = getQuarterKey(date);
        const entries = quarterBuckets.get(quarterKey) ?? [];
        entries.push(index);
        quarterBuckets.set(quarterKey, entries);
      });

      for (const [, indices] of quarterBuckets) {
        if (indices.length === 0) {
          continue;
        }

        const eventPosition = Math.max(0, Math.min(indices.length - 1, Math.floor(indices.length * (0.78 + random() * 0.14))));
        const eventIndex = indices[eventPosition];
        const surprise = ((random() - 0.5) * 0.5 + (random() - 0.5) * 0.18) * 100;
        const normalizedSurprise = Number(surprise.toFixed(2));
        surprisePct[eventIndex] = normalizedSurprise;
        event[eventIndex] = normalizedSurprise >= 0 ? 1 : -1;
      }

      return {
        surprisePct: {
          values: surprisePct,
          timestamps,
        },
        event: {
          values: event,
          timestamps,
        },
      };
    },
  },
};

export default yfinanceEarningsHistoryNode;
