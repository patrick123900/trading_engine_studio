import type { NodeModule } from "../../core/types";

function toSeriesInput(value: unknown) {
  if (typeof value === "number") {
    return {
      values: [value],
      timestamps: [] as string[],
    };
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
    return {
      values: value,
      timestamps: [] as string[],
    };
  }

  if (value && typeof value === "object" && "values" in value) {
    const values = (value as { values?: unknown }).values;
    const timestamps = (value as { timestamps?: unknown }).timestamps;
    if (Array.isArray(values) && values.every((entry) => typeof entry === "number")) {
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
    if (Array.isArray(close) && close.every((entry) => typeof entry === "number")) {
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

function findBaseline(values: number[]) {
  const firstFinite = values.find((value) => Number.isFinite(value) && value !== 0);
  return firstFinite ?? 1;
}

function normalizeValues(values: number[], baseline: number) {
  return values.map((value) => Number(((value / baseline) * 100).toFixed(6)));
}

const normalizePairNode: NodeModule = {
  definition: {
    type: "arithmetic.normalizePair",
    title: "Normalize Pair",
    description: "Normalize two series to a common starting base for direct comparison.",
    color: "#f59e0b",
    inputs: [
      { id: "left", label: "Left", kind: "number" },
      { id: "right", label: "Right", kind: "number" },
    ],
    outputs: [
      { id: "leftNormalized", label: "Left Normalized", kind: "series" },
      { id: "rightNormalized", label: "Right Normalized", kind: "series" },
    ],
    fields: [],
  },
  executor: {
    type: "arithmetic.normalizePair",
    run: ({ inputs }) => {
      const left = toSeriesInput(inputs.left);
      const right = toSeriesInput(inputs.right);

      if (!left || !right) {
        throw new Error("Normalize Pair requires two numeric series inputs.");
      }

      if (left.values.length === 0 || right.values.length === 0) {
        throw new Error("Normalize Pair requires non-empty numeric series.");
      }

      return {
        leftNormalized: {
          values: normalizeValues(left.values, findBaseline(left.values)),
          timestamps: left.timestamps,
        },
        rightNormalized: {
          values: normalizeValues(right.values, findBaseline(right.values)),
          timestamps: right.timestamps,
        },
      };
    },
  },
};

export default normalizePairNode;
