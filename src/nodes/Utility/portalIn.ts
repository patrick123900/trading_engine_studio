import type { NodeModule } from "../../core/types";
import { getPortalInChannels, getPortalInInputId } from "../../core/nodes/portalChannels";

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
    run: ({ node, inputs }) => {
      const channels = getPortalInChannels(node.config);
      const output: Record<string, unknown> = {
        channel: channels[0],
      };

      channels.forEach((channel, index) => {
        const inputId = getPortalInInputId(index);
        output[inputId] = inputs[inputId];
        if (index === 0) {
          output.value = inputs[inputId];
        }
        output[`channel_${index + 1}`] = channel;
      });

      return output;
    },
  },
};

export default portalInNode;
