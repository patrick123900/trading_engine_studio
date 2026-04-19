import type { NodeModule } from "../../core/types";
import { outputScalarOrSeries, toTimestampSeries, type TimestampMode } from "./shared";

const standardizeNode: NodeModule = {
  definition: {
    type: "datetime.standardize",
    title: "Timestamp Standardize",
    description: "Normalize timestamp inputs into epoch milliseconds and ISO output.",
    color: "#0ea5e9",
    inputs: [{ id: "source", label: "Source", kind: "any" }],
    outputs: [
      { id: "epochMs", label: "Epoch (ms)", kind: "number" },
      { id: "iso", label: "ISO", kind: "any" },
    ],
    fields: [
      {
        key: "inputMode",
        label: "Input Mode",
        type: "select",
        defaultValue: "auto",
        options: [
          { label: "Auto", value: "auto" },
          { label: "Epoch Milliseconds", value: "milliseconds" },
          { label: "Epoch Seconds", value: "seconds" },
          { label: "ISO String", value: "iso" },
        ],
      },
    ],
  },
  executor: {
    type: "datetime.standardize",
    run: ({ node, inputs }) => {
      const inputMode = String(node.config.inputMode ?? "auto") as TimestampMode;
      const series = toTimestampSeries(inputs.source, inputMode);

      if (!series || series.values.length === 0) {
        throw new Error("Timestamp Standardize requires a timestamp source input.");
      }

      return {
        epochMs: {
          values: series.values,
          timestamps: series.timestamps,
        },
        iso: outputScalarOrSeries(series.timestamps),
      };
    },
  },
};

export default standardizeNode;
