import type { NodeModule } from "../../core/types";

const portalOutNode: NodeModule = {
  definition: {
    type: "utility.portalOut",
    title: "Portal Out",
    description: "Read a named portal channel and bring the value out elsewhere on the canvas.",
    color: "#8b5cf6",
    inputs: [],
    outputs: [{ id: "value", label: "Value", kind: "any" }],
    fields: [{ key: "channel", label: "Channel", type: "text", defaultValue: "main" }],
  },
  executor: {
    type: "utility.portalOut",
    run: ({ inputs, node }) => {
      if (!("value" in inputs)) {
        throw new Error(`Portal Out "${String(node.config.channel ?? "main")}" has no matching Portal In.`);
      }

      return {
        value: inputs.value,
      };
    },
  },
};

export default portalOutNode;
