import type { NodeModule } from "../../core/types";
import { getLogicInputId, getLogicInputLabels } from "../../core/nodes/logicInputs";

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
    description: "Return true when any configured boolean input is true.",
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
    run: ({ inputs, node }) => {
      const labels = getLogicInputLabels(node.config);
      const streams = labels.map((label, index) => ({
        label,
        values: toBooleanSeries(inputs[getLogicInputId(index)]),
      }));

      if (streams.some((stream) => stream.values === null)) {
        throw new Error("OR requires boolean input on every configured port.");
      }

      const resolvedStreams = streams.map((stream) => stream.values as boolean[]);
      const length = Math.max(...resolvedStreams.map((stream) => stream.length));
      return {
        values: Array.from({ length }, (_, index) =>
          resolvedStreams.some((stream) => Boolean(stream[Math.min(index, stream.length - 1)]))),
      };
    },
  },
};

export default orNode;
