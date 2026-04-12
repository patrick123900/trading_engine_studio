import type { NodeModule } from "../../core/types";

function normalizeSignalArray(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const signalCandidate =
    "signal" in value
      ? (value as { signal?: unknown }).signal
      : "values" in value
        ? (value as { values?: unknown }).values
        : undefined;
  const side = (value as { side?: unknown }).side;
  const reversePosition = (value as { reversePosition?: unknown }).reversePosition;
  if (
    Array.isArray(signalCandidate) &&
    signalCandidate.every((entry) => typeof entry === "boolean") &&
    (side === "long" || side === "short")
  ) {
    return { signal: signalCandidate, side, reversePosition: Boolean(reversePosition) };
  }

  return null;
}

const executionNode: NodeModule = {
  definition: {
    type: "trading.execution",
    title: "Trade Execution",
    description: "Merge one or more long/short intent signals into executable trade instructions for a product.",
    color: "#1d4ed8",
    inputs: [
      { id: "product", label: "Product", kind: "product" },
      { id: "signals", label: "Signals", kind: "signal", allowMultiple: true },
    ],
    outputs: [],
    fields: [
      {
        key: "allowShorts",
        label: "Allow Shorts",
        type: "checkbox",
        defaultValue: true,
      },
      {
        key: "slippagePct",
        label: "Slippage %",
        type: "number",
        defaultValue: 0,
      },
      {
        key: "commissionPct",
        label: "Commission %",
        type: "number",
        defaultValue: 0,
      },
    ],
  },
  executor: {
    type: "trading.execution",
    run: ({ inputs, node }) => {
      const product = inputs.product;
      if (!product || typeof product !== "object") {
        throw new Error("Trade Execution requires a Product input.");
      }

      const rawSignals = Array.isArray(inputs.signals) ? inputs.signals : inputs.signals ? [inputs.signals] : [];
      const signals = rawSignals
        .map((signalValue) => normalizeSignalArray(signalValue))
        .filter((entry): entry is NonNullable<ReturnType<typeof normalizeSignalArray>> => entry !== null);

      return {
        product,
        signals,
        settings: {
          allowShorts: Boolean(node.config.allowShorts ?? true),
          slippagePct: Math.max(0, Number(node.config.slippagePct ?? 0)),
          commissionPct: Math.max(0, Number(node.config.commissionPct ?? 0)),
        },
      };
    },
  },
};

export default executionNode;
