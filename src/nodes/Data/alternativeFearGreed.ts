import type { NodeModule } from "../../core/types";

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" ? value : fallback;
}

type FearGreedResponse = {
  data?: Array<{
    value?: string;
    value_classification?: string;
    timestamp?: string;
  }>;
  metadata?: {
    error?: string | null;
  };
};

const alternativeFearGreedNode: NodeModule = {
  definition: {
    type: "data.alternativeFearGreed",
    title: "Crypto Fear & Greed",
    description: "Fetch the Alternative.me crypto Fear & Greed index.",
    color: "#2f855a",
    inputs: [],
    outputs: [
      { id: "series", label: "Index", kind: "series" },
    ],
    fields: [{ key: "lookback", label: "Lookback Bars", type: "number", defaultValue: 90 }],
  },
  executor: {
    type: "data.alternativeFearGreed",
    run: async ({ node }) => {
      const lookback = Math.max(2, Math.floor(readNumber(node.config.lookback, 90)));
      const url = new URL("https://api.alternative.me/fng/");
      url.searchParams.set("limit", String(lookback));

      let payload: FearGreedResponse;

      try {
        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        payload = (await response.json()) as FearGreedResponse;
      } catch (error) {
        throw new Error(
          `Fear & Greed failed to fetch data: ${error instanceof Error ? error.message : "Unknown error."}`,
        );
      }

      if (payload.metadata?.error) {
        throw new Error(`Fear & Greed returned an error: ${payload.metadata.error}`);
      }

      const rows = (payload.data ?? [])
        .map((entry) => {
          const value = Number(entry.value);
          const unixTimestamp = Number(entry.timestamp);
          if (!Number.isFinite(value) || !Number.isFinite(unixTimestamp)) {
            return null;
          }
          return {
            value,
            classification: String(entry.value_classification ?? ""),
            timestamp: new Date(unixTimestamp * 1000).toISOString(),
          };
        })
        .filter((entry): entry is { value: number; classification: string; timestamp: string } => entry !== null)
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

      if (rows.length === 0) {
        throw new Error("Fear & Greed returned no usable data.");
      }

      return {
        series: {
          values: rows.map((row) => row.value),
          timestamps: rows.map((row) => row.timestamp),
        },
      };
    },
  },
};

export default alternativeFearGreedNode;
