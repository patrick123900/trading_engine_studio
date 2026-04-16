import type { NodeModule } from "../../core/types";

function readNumber(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

const fixedValueNode: NodeModule = {
  definition: {
    type: "logic.fixedValue",
    title: "Constant",
    description: "Provide a configurable numeric constant.",
    color: "#805ad5",
    inputs: [],
    outputs: [{ id: "value", label: "Value", kind: "number" }],
    fields: [{ key: "value", label: "Value", type: "number", defaultValue: 30 }],
  },
  executor: {
    type: "logic.fixedValue",
    run: ({ node }) => readNumber(node.config.value, 30),
  },
};

export default fixedValueNode;
