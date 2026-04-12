import type { NodeModule } from "../../core/types";

function toSeries(value: unknown) {
  if (typeof value === "number") {
    return { kind: "scalar" as const, values: [value] };
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
    return { kind: "series" as const, values: value };
  }

  if (value && typeof value === "object" && "values" in value) {
    const values = (value as { values?: unknown }).values;
    if (Array.isArray(values) && values.every((entry) => typeof entry === "number")) {
      return { kind: "series" as const, values };
    }
  }

  return null;
}

const comparisonNode: NodeModule = {
  definition: {
    type: "logic.comparison",
    title: "Comparison",
    description: "Compare two inputs and output a boolean signal.",
    color: "#3182ce",
    inputs: [
      { id: "left", label: "Left", kind: "number" },
      { id: "right", label: "Right", kind: "number" },
    ],
    outputs: [{ id: "result", label: "Result", kind: "boolean" }],
    fields: [
      {
        key: "operator",
        label: "Operator",
        type: "select",
        defaultValue: "lt",
        options: [
          { label: "<", value: "lt" },
          { label: ">", value: "gt" },
          { label: "=", value: "eq" },
        ],
      },
    ],
  },
  executor: {
    type: "logic.comparison",
    run: ({ node, inputs }) => {
      const left = toSeries(inputs.left);
      const right = toSeries(inputs.right);
      const operator = String(node.config.operator ?? "lt");

      if (!left || !right) {
        throw new Error("Comparison requires two numeric inputs.");
      }

      const length = Math.max(left.values.length, right.values.length);
      const result = Array.from({ length }, (_, index) => {
        const leftValue = left.values[Math.min(index, left.values.length - 1)];
        const rightValue = right.values[Math.min(index, right.values.length - 1)];

        switch (operator) {
          case "gt":
            return leftValue > rightValue;
          case "eq":
            return Math.abs(leftValue - rightValue) < 0.0001;
          case "lt":
            return leftValue < rightValue;
          default:
            throw new Error(`Unsupported comparison operator: ${operator}`);
        }
      });

      return {
        values: result,
      };
    },
  },
};

export default comparisonNode;
