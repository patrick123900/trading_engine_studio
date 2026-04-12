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

const orNode: NodeModule = {
  definition: {
    type: "logic.or",
    title: "OR",
    description: "Return true when either boolean input is true.",
    color: "#3182ce",
    inputs: [
      { id: "left", label: "Left", kind: "boolean" },
      { id: "right", label: "Right", kind: "boolean" },
    ],
    outputs: [{ id: "result", label: "Result", kind: "boolean" }],
    fields: [],
  },
  executor: {
    type: "logic.or",
    run: ({ inputs }) => {
      const left = toBooleanSeries(inputs.left);
      const right = toBooleanSeries(inputs.right);
      if (!left || !right) {
        throw new Error("OR requires two boolean inputs.");
      }

      const length = Math.max(left.length, right.length);
      return {
        values: Array.from({ length }, (_, index) => Boolean(left[Math.min(index, left.length - 1)]) || Boolean(right[Math.min(index, right.length - 1)])),
      };
    },
  },
};

export default orNode;
