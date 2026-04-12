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

const divideNode: NodeModule = {
  definition: {
    type: "arithmetic.divide",
    title: "Divide",
    description: "Divide the left numeric input by the right input.",
    color: "#f59e0b",
    inputs: [
      { id: "left", label: "Left", kind: "number" },
      { id: "right", label: "Right", kind: "number" },
    ],
    outputs: [{ id: "result", label: "Result", kind: "number" }],
    fields: [],
  },
  executor: {
    type: "arithmetic.divide",
    run: ({ inputs }) => {
      const left = toSeries(inputs.left);
      const right = toSeries(inputs.right);
      if (!left || !right) {
        throw new Error("Divide requires two numeric inputs.");
      }

      const length = Math.max(left.length, right.length);
      return {
        values: Array.from({ length }, (_, index) => {
          const divisor = right[Math.min(index, right.length - 1)];
          if (Math.abs(divisor) < 0.0000001) {
            return 0;
          }
          return left[Math.min(index, left.length - 1)] / divisor;
        }),
      };
    },
  },
};

export default divideNode;
