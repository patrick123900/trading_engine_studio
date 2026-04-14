import type { NodeModule } from "../../core/types";
import { getPortalOutChannels, getPortalOutOutputId } from "../../core/nodes/portalChannels";

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
      const channels = getPortalOutChannels(node.config);
      const outputs: Record<string, unknown> = {};

      channels.forEach((channel, index) => {
        const outputId = getPortalOutOutputId(index);
        outputs[outputId] = outputId in inputs ? inputs[outputId] : undefined;
      });

      return outputs;
    },
  },
};

export default portalOutNode;
