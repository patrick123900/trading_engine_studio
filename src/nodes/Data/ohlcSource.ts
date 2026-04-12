import type { NodeModule } from "../../core/types";

type DatasetInput = {
  timestamps?: string[];
  open?: number[];
  high?: number[];
  low?: number[];
  close?: number[];
};

function readSeries(dataset: DatasetInput | undefined, source: string) {
  switch (source) {
    case "open":
      return dataset?.open;
    case "high":
      return dataset?.high;
    case "low":
      return dataset?.low;
    case "close":
    default:
      return dataset?.close;
  }
}

const ohlcSourceNode: NodeModule = {
  definition: {
    type: "data.ohlcSource",
    title: "OHLC Source",
    description: "Extract a numeric price series from candle data.",
    color: "#2f855a",
    inputs: [{ id: "dataset", label: "Dataset", kind: "dataset" }],
    outputs: [{ id: "series", label: "Series", kind: "series" }],
    fields: [
      {
        key: "source",
        label: "Source",
        type: "select",
        defaultValue: "close",
        options: [
          { label: "Open", value: "open" },
          { label: "High", value: "high" },
          { label: "Low", value: "low" },
          { label: "Close", value: "close" },
        ],
      },
    ],
  },
  executor: {
    type: "data.ohlcSource",
    run: ({ node, inputs }) => {
      const dataset = inputs.dataset as DatasetInput | undefined;
      const source = String(node.config.source ?? "close").toLowerCase();
      const values = readSeries(dataset, source);

      if (!values || !Array.isArray(values) || values.length === 0) {
        throw new Error(`OHLC Source requires dataset input with a valid ${source} series.`);
      }

      return {
        values,
        timestamps: Array.isArray(dataset?.timestamps)
          ? dataset.timestamps.filter((entry): entry is string => typeof entry === "string")
          : [],
      };
    },
  },
};

export default ohlcSourceNode;
