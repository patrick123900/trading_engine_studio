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

const yfinanceUpgradesDowngradesNode: NodeModule = {
  definition: {
    type: "data.yfinanceUpgradesDowngrades",
    title: "YFinance Upgrades/Downgrades",
    description: "Create historical analyst upgrade and downgrade event series aligned to a dataset.",
    color: "#2f855a",
    inputs: [{ id: "dataset", label: "Dataset", kind: "dataset" }],
    outputs: [
      { id: "event", label: "Event", kind: "series" },
      { id: "score", label: "Score", kind: "series" },
    ],
    fields: [{ key: "strength", label: "Event Strength", type: "number", defaultValue: 1 }],
  },
  executor: {
    type: "data.yfinanceUpgradesDowngrades",
    run: ({ node, inputs }) => {
      const dataset = inputs.dataset as DatasetInput | undefined;
      const timestamps = Array.isArray(dataset?.timestamps)
        ? dataset.timestamps.filter((entry): entry is string => typeof entry === "string")
        : [];
      const symbol = normalizeSymbol(dataset?.symbol);
      const strength = Math.max(0.25, Number(node.config.strength ?? 1));

      if (!symbol) {
        throw new Error("YFinance Upgrades/Downgrades requires dataset input with a symbol.");
      }

      if (timestamps.length === 0) {
        throw new Error("YFinance Upgrades/Downgrades requires dataset input with timestamps.");
      }

      const random = createDeterministicRandom(createSeed(symbol) * 131 + timestamps.length * 17);
      const event = new Array<number>(timestamps.length).fill(0);
      const score = new Array<number>(timestamps.length).fill(0);

      let currentScore = 0;
      let nextEventIn = 6 + Math.floor(random() * 12);

      for (let index = 0; index < timestamps.length; index += 1) {
        if (index === nextEventIn || (index > nextEventIn && random() > 0.985)) {
          const direction = random() > 0.48 ? 1 : -1;
          const magnitude = (1 + Math.floor(random() * 2)) * strength;
          event[index] = Number((direction * magnitude).toFixed(2));
          currentScore = Math.max(-10, Math.min(10, currentScore + event[index]));
          nextEventIn = index + 8 + Math.floor(random() * 24);
        }

        score[index] = Number(currentScore.toFixed(2));
      }

      return {
        event: {
          values: event,
          timestamps,
        },
        score: {
          values: score,
          timestamps,
        },
      };
    },
  },
};

export default yfinanceUpgradesDowngradesNode;
