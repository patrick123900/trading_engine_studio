import type { NodeModule } from "../../core/types";

function toBooleanSeries(value: unknown): boolean[] | null {
  if (typeof value === "boolean") {
    return [value];
  }

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

function normalizeSignalInput(input: unknown): boolean[] | null {
  const directSeries = toBooleanSeries(input);
  if (directSeries) {
    return directSeries;
  }

  if (!Array.isArray(input)) {
    return null;
  }

  const streams = input
    .map((entry) => toBooleanSeries(entry))
    .filter((entry): entry is boolean[] => entry !== null);

  if (streams.length === 0) {
    return null;
  }

  const length = Math.max(...streams.map((stream) => stream.length), 0);
  return Array.from({ length }, (_, index) =>
    streams.some((stream) => Boolean(stream[Math.min(index, stream.length - 1)])),
  );
}

const signalNode: NodeModule = {
  definition: {
    type: "output.signal",
    title: "Signal",
    description: "Expose one or more boolean series as a reusable trading signal.",
    color: "#c53030",
    inputs: [{ id: "signal", label: "Signal In", kind: "boolean", allowMultiple: true }],
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
          { label: "Close", value: "close" },
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
      const normalizedSide = String(node.config.side ?? "long").trim().toLowerCase();
      const input = normalizeSignalInput(inputs.signal);

      if (!input || !Array.isArray(input) || !input.every((entry) => typeof entry === "boolean")) {
        throw new Error("Signal requires boolean signal input.");
      }

      const edgeTriggeredValues = input.map((value, index) => value && !Boolean(input[index - 1]));
      const signalValues = normalizedSide === "close" ? input.map((value) => Boolean(value)) : edgeTriggeredValues;

      return {
        signal: {
          values: signalValues,
          side: normalizedSide,
          reversePosition: Boolean(node.config.reversePosition),
        },
      };
    },
  },
};

export default signalNode;
