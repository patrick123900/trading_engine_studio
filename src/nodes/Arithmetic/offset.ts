import type { NodeModule } from "../../core/types";

type OffsetValue = number | boolean;

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" ? value : fallback;
}

function toSeriesInput(value: unknown) {
  if (value && typeof value === "object" && "values" in value) {
    const values = (value as { values?: unknown }).values;
    const timestamps = (value as { timestamps?: unknown }).timestamps;
    if (
      Array.isArray(values) &&
      values.every((entry) => typeof entry === "number" || typeof entry === "boolean")
    ) {
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

  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "number" || typeof entry === "boolean")
  ) {
    return {
      values: value,
      timestamps: [] as string[],
    };
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return {
      values: [value],
      timestamps: [] as string[],
    };
  }

  return null;
}

function offsetValues(values: OffsetValue[], bars: number) {
  if (values.length === 0 || bars === 0) {
    return values;
  }

  return values.map((_, index) => {
    const sourceIndex = index - bars;
    if (sourceIndex < 0) {
      return values[0];
    }
    if (sourceIndex >= values.length) {
      return values[values.length - 1];
    }
    return values[sourceIndex];
  });
}

const offsetNode: NodeModule = {
  definition: {
    type: "arithmetic.offset",
    title: "Offset",
    description: "Shift a numeric or boolean series by a whole number of bars.",
    color: "#f59e0b",
    inputs: [{ id: "source", label: "Source", kind: "series" }],
    outputs: [{ id: "series", label: "Offset", kind: "series" }],
    fields: [{ key: "bars", label: "Bars", type: "number", defaultValue: 1 }],
  },
  executor: {
    type: "arithmetic.offset",
    run: ({ inputs, node }) => {
      const source = toSeriesInput(inputs.source);
      const bars = Math.trunc(readNumber(node.config.bars, 1));

      if (!source || source.values.length === 0) {
        throw new Error("Offset requires a numeric or boolean series (or a dataset).");
      }

      return {
        values: offsetValues(source.values, bars),
        timestamps: source.timestamps,
      };
    },
  },
};

export default offsetNode;
