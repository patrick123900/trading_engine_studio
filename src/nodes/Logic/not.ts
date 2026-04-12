import type { NodeModule } from "../../core/types";

function toBooleanSeries(value: unknown) {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "boolean")) {
    return value;
  }

  if (value && typeof value === "object" && "values" in value) {
    const values = (value as { values?: unknown }).values;
    if (Array.isArray(values) && values.every((entry) => typeof entry === "boolean")) {
      return values;
    }
  }

  return null;
}

const notNode: NodeModule = {
  definition: {
    type: "logic.not",
    title: "NOT",
    description: "Invert a boolean signal.",
    color: "#3182ce",
    inputs: [{ id: "input", label: "Input", kind: "boolean" }],
    outputs: [{ id: "result", label: "Result", kind: "boolean" }],
    fields: [],
  },
  executor: {
    type: "logic.not",
    run: ({ inputs }) => {
      const input = toBooleanSeries(inputs.input);
      if (!input) {
        throw new Error("NOT requires a boolean input.");
      }

      return {
        values: input.map((value) => !value),
      };
    },
  },
};

export default notNode;
