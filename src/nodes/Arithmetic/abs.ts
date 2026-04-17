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

const absNode: NodeModule = {
  definition: {
    type: "arithmetic.abs",
    title: "Abs",
    description: "Return the absolute value of a numeric input.",
    color: "#f59e0b",
    inputs: [{ id: "input", label: "Input", kind: "number" }],
    outputs: [{ id: "result", label: "Result", kind: "number" }],
    fields: [],
  },
  executor: {
    type: "arithmetic.abs",
    run: ({ inputs }) => {
      const input = toSeries(inputs.input);
      if (!input) {
        throw new Error("Abs requires a numeric input.");
      }

      return {
        values: input.map((value) => Math.abs(value)),
      };
    },
  },
};

export default absNode;
