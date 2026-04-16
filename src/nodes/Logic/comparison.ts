import type { NodeModule } from "../../core/types";

function readNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toSeries(value: unknown) {
  const numericValue = readNumber(value);
  if (numericValue !== null) {
    return { kind: "scalar" as const, values: [numericValue] };
  }

  if (Array.isArray(value)) {
    const numericValues = value.map((entry) => readNumber(entry));
    if (numericValues.every((entry) => entry !== null)) {
      return { kind: "series" as const, values: numericValues };
    }
  }

  if (value && typeof value === "object" && "values" in value) {
    const values = (value as { values?: unknown }).values;
    if (Array.isArray(values)) {
      const numericValues = values.map((entry) => readNumber(entry));
      if (numericValues.every((entry) => entry !== null)) {
        return { kind: "series" as const, values: numericValues };
      }
    }
  }

  if (value && typeof value === "object" && "value" in value) {
    return toSeries((value as { value?: unknown }).value);
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
