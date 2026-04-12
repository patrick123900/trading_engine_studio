import type { NodeModule } from "../../core/types";

const signalNode: NodeModule = {
  definition: {
    type: "output.signal",
    title: "Signal",
    description: "Expose a boolean series as a reusable trading signal.",
    color: "#c53030",
    inputs: [{ id: "signal", label: "Signal In", kind: "boolean" }],
    outputs: [{ id: "signal", label: "Signal", kind: "signal" }],
    fields: [
      {
        key: "side",
        label: "Side",
        type: "select",
        defaultValue: "long",
        options: [
          { label: "Long", value: "long" },
          { label: "Short", value: "short" },
        ],
      },
      {
        key: "reversePosition",
        label: "Reverse Position",
        type: "checkbox",
        defaultValue: false,
      },
    ],
  },
  executor: {
    type: "output.signal",
    run: ({ inputs, node }) => {
      const input =
        Array.isArray(inputs.signal)
          ? inputs.signal
          : inputs.signal && typeof inputs.signal === "object" && "values" in inputs.signal
            ? (inputs.signal as { values?: unknown }).values
            : null;

      if (!input || !Array.isArray(input) || !input.every((entry) => typeof entry === "boolean")) {
        throw new Error("Signal requires boolean signal input.");
      }

      const edgeTriggeredValues = input.map((value, index) => value && !Boolean(input[index - 1]));

      return {
        signal: {
          values: edgeTriggeredValues,
          side: String(node.config.side ?? "long"),
          reversePosition: Boolean(node.config.reversePosition),
        },
      };
    },
  },
};

export default signalNode;
