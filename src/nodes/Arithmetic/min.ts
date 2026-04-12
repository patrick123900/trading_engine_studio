import type { NodeModule } from "../../core/types";

function toSeries(value: unknown) {
  if (typeof value === "number") {
    return [value];
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
    return value;
  }

  if (value && typeof value === "object" && "values" in value) {
    const values = (value as { values?: unknown }).values;
    if (Array.isArray(values) && values.every((entry) => typeof entry === "number")) {
      return values;
    }
  }

  return null;
}

const minNode: NodeModule = {
  definition: {
    type: "arithmetic.min",
    title: "Min",
    description: "Return the smaller of two numeric inputs.",
    color: "#f59e0b",
    inputs: [
      { id: "left", label: "Left", kind: "number" },
      { id: "right", label: "Right", kind: "number" },
    ],
    outputs: [{ id: "result", label: "Result", kind: "number" }],
    fields: [],
  },
  executor: {
    type: "arithmetic.min",
    run: ({ inputs }) => {
      const left = toSeries(inputs.left);
      const right = toSeries(inputs.right);
      if (!left || !right) {
        throw new Error("Min requires two numeric inputs.");
      }

      const length = Math.max(left.length, right.length);
      return {
        values: Array.from({ length }, (_, index) => Math.min(left[Math.min(index, left.length - 1)], right[Math.min(index, right.length - 1)])),
      };
    },
  },
};

export default minNode;
