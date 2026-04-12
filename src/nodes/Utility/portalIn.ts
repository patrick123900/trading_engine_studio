import type { NodeModule } from "../../core/types";

const portalInNode: NodeModule = {
  definition: {
    type: "utility.portalIn",
    title: "Portal In",
    description: "Capture any value into a named portal channel.",
    color: "#7c3aed",
    inputs: [{ id: "value", label: "Value", kind: "any" }],
    outputs: [],
    fields: [{ key: "channel", label: "Channel", type: "text", defaultValue: "main" }],
  },
  executor: {
    type: "utility.portalIn",
    run: ({ node, inputs }) => ({
      channel: String(node.config.channel ?? "main"),
      value: inputs.value,
    }),
  },
};

export default portalInNode;
