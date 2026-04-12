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

const crossesAboveNode: NodeModule = {
  definition: {
    type: "logic.crossesAbove",
    title: "Crosses Above",
    description: "Return true when the left series crosses above the right series.",
    color: "#3182ce",
    inputs: [
      { id: "left", label: "Left", kind: "number" },
      { id: "right", label: "Right", kind: "number" },
    ],
    outputs: [{ id: "result", label: "Result", kind: "boolean" }],
    fields: [],
  },
  executor: {
    type: "logic.crossesAbove",
    run: ({ inputs }) => {
      const left = toSeries(inputs.left);
      const right = toSeries(inputs.right);
      if (!left || !right) {
        throw new Error("Crosses Above requires two numeric inputs.");
      }

      const length = Math.max(left.length, right.length);
      return {
        values: Array.from({ length }, (_, index) => {
          if (index === 0) {
            return false;
          }

          const currentLeft = left[Math.min(index, left.length - 1)];
          const currentRight = right[Math.min(index, right.length - 1)];
          const previousLeft = left[Math.min(index - 1, left.length - 1)];
          const previousRight = right[Math.min(index - 1, right.length - 1)];
          return previousLeft <= previousRight && currentLeft > currentRight;
        }),
      };
    },
  },
};

export default crossesAboveNode;
