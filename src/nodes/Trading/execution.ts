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
    return {
      signal: signalCandidate,
      side: side as "long" | "short",
      reversePosition: Boolean(reversePosition),
    };
  }

  return null;
}

function readNumber(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parsePositionAmountConfig(
  rawValue: unknown,
  legacyPercentFlag: unknown,
  legacySizingMode: unknown,
) {
  const rawString = String(rawValue ?? "").trim();
  const hasLegacyModeHint = legacyPercentFlag !== undefined || legacySizingMode !== undefined;
  const legacyIsPercent = Boolean(
    legacyPercentFlag ?? (String(legacySizingMode ?? "percent") !== "fixed"),
  );

  if (rawString.endsWith("%")) {
    const parsedPercent = Number(rawString.slice(0, -1).trim());
    return {
      mode: "percent" as const,
      amount: Math.max(0, Number.isFinite(parsedPercent) ? parsedPercent : 0),
    };
  }

  const parsedAmount = Number(rawString);
  return {
    mode: hasLegacyModeHint && legacyIsPercent ? ("percent" as const) : ("fixed" as const),
    amount: Math.max(0, Number.isFinite(parsedAmount) ? parsedAmount : 0),
  };
}

function resolvePositionNotional(
  capital: number,
  mode: "fixed" | "percent",
  amount: number,
) {
  const safeCapital = Math.max(0, capital);
  const safeAmount = Math.max(0, amount);
  return mode === "fixed" ? safeAmount : safeCapital * (safeAmount / 100);
}

function applySlippage(price: number, direction: "long" | "short", event: "entry" | "exit", slippagePct: number) {
  const factor = slippagePct / 100;

  if (event === "entry") {
    return direction === "long" ? price * (1 + factor) : price * (1 - factor);
  }

  return direction === "long" ? price * (1 - factor) : price * (1 + factor);
}

function computePositionStateSeries({
  signals,
  allowShorts,
  close,
  open,
  slippagePct,
  initialCapital,
  positionSizingMode,
  positionAmount,
  positionPnlPercent,
  length,
}: {
  signals: Array<{ signal: boolean[]; side: "long" | "short"; reversePosition: boolean }>;
  allowShorts: boolean;
  close: number[];
  open: number[];
  slippagePct: number;
  initialCapital: number;
  positionSizingMode: "fixed" | "percent";
  positionAmount: number;
  positionPnlPercent: boolean;
  length: number;
}) {
  const longPosition: boolean[] = [];
  const shortPosition: boolean[] = [];
  const positionPnl: number[] = [];
  let currentDirection: "long" | "short" | null = null;
  let entryPrice = 0;
  let quantity = 0;
  let capital = initialCapital;
  let pendingTransition: "long" | "short" | "flat" | null = null;

  for (let index = 0; index < length; index += 1) {
    if (pendingTransition !== null) {
      if (currentDirection && pendingTransition !== currentDirection) {
        const exitReferencePrice = open[index] ?? close[index] ?? close[Math.max(0, index - 1)] ?? 0;
        const exitPrice = applySlippage(exitReferencePrice, currentDirection, "exit", slippagePct);
        const directionSign = currentDirection === "short" ? -1 : 1;
        capital += (exitPrice - entryPrice) * quantity * directionSign;
        currentDirection = null;
        entryPrice = 0;
        quantity = 0;
      }

      if (!currentDirection && pendingTransition !== "flat") {
        const entryReferencePrice = open[index] ?? close[index] ?? 0;
        const nextEntryPrice = applySlippage(entryReferencePrice, pendingTransition, "entry", slippagePct);
        const positionNotional = resolvePositionNotional(capital, positionSizingMode, positionAmount);
        quantity = nextEntryPrice > 0 ? positionNotional / nextEntryPrice : 0;
        entryPrice = nextEntryPrice;
        currentDirection = pendingTransition;
      }

      pendingTransition = null;
    }

    longPosition.push(currentDirection === "long");
    shortPosition.push(currentDirection === "short");
    if (!currentDirection || quantity === 0) {
      positionPnl.push(0);
    } else {
      const markPrice = close[index] ?? entryPrice;
      const directionSign = currentDirection === "short" ? -1 : 1;
      const pnlAmount = (markPrice - entryPrice) * quantity * directionSign;
      const investedAmount = entryPrice * quantity;
      const pnlValue =
        positionPnlPercent && investedAmount > 0 ? (pnlAmount / investedAmount) * 100 : pnlAmount;
      positionPnl.push(Number(pnlValue.toFixed(6)));
    }

    const wantsLong = signals.some(
      (signal) => signal.side === "long" && Boolean(signal.signal[index]),
    );
    const wantsShort = signals.some(
      (signal) => signal.side === "short" && Boolean(signal.signal[index]),
    );
    const wantsReverseToLong = signals.some(
      (signal) => signal.side === "long" && signal.reversePosition && Boolean(signal.signal[index]),
    );
    const wantsReverseToShort = signals.some(
      (signal) => signal.side === "short" && signal.reversePosition && Boolean(signal.signal[index]),
    );

    let desiredDirection: "long" | "short" | "flat";
    if (currentDirection === "long") {
      if (wantsReverseToShort && allowShorts) {
        desiredDirection = "short";
      } else if (wantsShort) {
        desiredDirection = "flat";
      } else {
        desiredDirection = "long";
      }
    } else if (currentDirection === "short") {
      if (wantsReverseToLong) {
        desiredDirection = "long";
      } else if (wantsLong) {
        desiredDirection = "flat";
      } else {
        desiredDirection = "short";
      }
    } else if (wantsLong && !wantsShort) {
      desiredDirection = "long";
    } else if (allowShorts && wantsShort && !wantsLong) {
      desiredDirection = "short";
    } else {
      desiredDirection = "flat";
    }

    if (currentDirection) {
      if (desiredDirection !== currentDirection) {
        pendingTransition = desiredDirection;
      }
    } else if (desiredDirection !== "flat") {
      pendingTransition = desiredDirection;
    }
  }

  return { longPosition, shortPosition, positionPnl };
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
    outputs: [
      { id: "longPosition", label: "Long Position", kind: "boolean" },
      { id: "shortPosition", label: "Short Position", kind: "boolean" },
      { id: "positionPnl", label: "Position PnL", kind: "number" },
    ],
    fields: [
      {
        key: "startingCapital",
        label: "Starting Capital",
        type: "number",
        defaultValue: 100000,
      },
      {
        key: "positionAmount",
        label: "Position Amount",
        type: "text",
        defaultValue: "100%",
        helpText: "Add a percentage sign to define the value as percentage of current capital.",
      },
      {
        key: "positionPnlPercent",
        label: "Position PnL %",
        type: "checkbox",
        defaultValue: false,
      },
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
      const allowShorts = Boolean(node.config.allowShorts ?? true);
      const marketData =
        product && typeof product === "object" && "marketData" in product
          ? ((product as { marketData?: { timestamps?: unknown; close?: unknown; open?: unknown } }).marketData ?? {})
          : {};
      const timestamps =
        Array.isArray(marketData.timestamps)
          ? marketData.timestamps.filter((entry): entry is string => typeof entry === "string")
          : [];
      const close =
        Array.isArray(marketData.close) && marketData.close.every((entry) => typeof entry === "number")
          ? marketData.close
          : [];
      const open =
        Array.isArray(marketData.open) && marketData.open.every((entry) => typeof entry === "number")
          ? marketData.open
          : close;
      const slippagePct = Math.max(0, Number(node.config.slippagePct ?? 0));
      const commissionPct = Math.max(0, Number(node.config.commissionPct ?? 0));
      const startingCapital = Math.max(0, readNumber(node.config.startingCapital, 100000));
      const parsedPositionAmount = parsePositionAmountConfig(
        node.config.positionAmount,
        node.config.positionAmountPercent,
        node.config.positionSizingMode,
      );
      const positionSizingMode = parsedPositionAmount.mode;
      const positionAmount = parsedPositionAmount.amount;
      const positionPnlPercent = Boolean(node.config.positionPnlPercent ?? false);
      const length = Math.max(
        timestamps.length,
        close.length,
        ...signals.map((signal) => signal.signal.length),
        0,
      );
      const positionState = computePositionStateSeries({
        signals,
        allowShorts,
        close,
        open,
        slippagePct,
        initialCapital: startingCapital,
        positionSizingMode,
        positionAmount,
        positionPnlPercent,
        length,
      });

      return {
        product,
        signals,
        settings: {
          allowShorts,
          slippagePct,
          commissionPct,
          startingCapital,
          positionSizingMode,
          positionAmount,
          positionPnlPercent,
        },
        longPosition: {
          values: positionState.longPosition,
          timestamps,
        },
        shortPosition: {
          values: positionState.shortPosition,
          timestamps,
        },
        positionPnl: {
          values: positionState.positionPnl,
          timestamps,
        },
      };
    },
  },
};

export default executionNode;
