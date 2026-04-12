import type {
  BacktestResult,
  CandlePoint,
  EquityPoint,
  GraphNode,
  SeriesPreview,
  TradeMarker,
  StrategyGraph,
} from "../types";
import { defaultExecutorRegistry } from "./executors";
import { defaultNodeRegistry } from "../nodes/registry";

interface ValidationIssue {
  message: string;
  nodeId?: string;
}

interface RunBacktestOptions {
  onNodeStart?: (nodeId: string) => void;
  onNodeComplete?: (nodeId: string) => void;
  onNodeError?: (nodeId: string, error: Error) => void;
  stepDelayMs?: number;
}

interface ExecutionSnapshot {
  outputsByNodeId: Map<string, Record<string, unknown>>;
  orderedNodes: GraphNode[];
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function validateGraph(graph: StrategyGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const node of graph.nodes) {
    if (!defaultNodeRegistry.get(node.type)) {
      issues.push({ message: `Unknown node type: ${node.type}`, nodeId: node.id });
    }

    if (!defaultExecutorRegistry.get(node.type)) {
      issues.push({ message: `No executor registered for node type: ${node.type}`, nodeId: node.id });
    }
  }

  if (!graph.nodes.some((node) => node.type === "trading.execution")) {
    issues.push({ message: "Strategy graph should include a Trade Execution node." });
  }

  return issues;
}

function describeNode(node: GraphNode) {
  const definition = defaultNodeRegistry.get(node.type);
  return definition ? `${definition.title} (${node.id})` : node.id;
}

function toOutputRecord(node: GraphNode, result: unknown) {
  const definition = defaultNodeRegistry.get(node.type);
  const outputs = definition?.outputs ?? [];

  if (outputs.length === 0) {
    if (result && typeof result === "object" && !Array.isArray(result)) {
      return result as Record<string, unknown>;
    }

    return {};
  }

  if (outputs.length === 1) {
    const single = outputs[0];
    if (
      result &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      single.id in (result as Record<string, unknown>)
    ) {
      return result as Record<string, unknown>;
    }

    return {
      [single.id]: result,
    };
  }

  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`${definition?.title ?? node.type} must return an object for multiple outputs.`);
  }

  return result as Record<string, unknown>;
}

function buildExecutionOrder(graph: StrategyGraph) {
  const incomingCount = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const node of graph.nodes) {
    incomingCount.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const edge of graph.edges) {
    incomingCount.set(edge.toNodeId, (incomingCount.get(edge.toNodeId) ?? 0) + 1);
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
  }

  const portalInputsByChannel = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    if (node.type !== "utility.portalIn") {
      continue;
    }

    const channel = String(node.config.channel ?? "main").trim();
    const entries = portalInputsByChannel.get(channel) ?? [];
    entries.push(node);
    portalInputsByChannel.set(channel, entries);
  }

  for (const node of graph.nodes) {
    if (node.type !== "utility.portalOut") {
      continue;
    }

    const channel = String(node.config.channel ?? "main").trim();
    const portalInputs = portalInputsByChannel.get(channel);
    if (!portalInputs || portalInputs.length !== 1) {
      continue;
    }

    const portalInput = portalInputs[0];
    incomingCount.set(node.id, (incomingCount.get(node.id) ?? 0) + 1);
    outgoing.get(portalInput.id)?.push(node.id);
  }

  const queue = graph.nodes
    .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  const ordered: GraphNode[] = [];
  const queuedIds = new Set(queue.map((node) => node.id));

  while (queue.length > 0) {
    const node = queue.shift()!;
    ordered.push(node);

    for (const targetId of outgoing.get(node.id) ?? []) {
      incomingCount.set(targetId, (incomingCount.get(targetId) ?? 1) - 1);
      if ((incomingCount.get(targetId) ?? 0) === 0) {
        const targetNode = nodeMap.get(targetId);
        if (targetNode && !queuedIds.has(targetId)) {
          queue.push(targetNode);
          queuedIds.add(targetId);
        }
      }
    }
  }

  if (ordered.length !== graph.nodes.length) {
    const remainder = graph.nodes
      .filter((node) => !ordered.some((entry) => entry.id === node.id))
      .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
    ordered.push(...remainder);
  }

  return ordered;
}

function getPortalInputMap(graph: StrategyGraph) {
  const portalInputsByChannel = new Map<string, GraphNode[]>();

  for (const node of graph.nodes) {
    if (node.type !== "utility.portalIn") {
      continue;
    }

    const channel = String(node.config.channel ?? "main").trim();
    const entries = portalInputsByChannel.get(channel) ?? [];
    entries.push(node);
    portalInputsByChannel.set(channel, entries);
  }

  return portalInputsByChannel;
}

async function executeGraph(graph: StrategyGraph, options: RunBacktestOptions): Promise<ExecutionSnapshot> {
  const outputsByNodeId = new Map<string, Record<string, unknown>>();
  const orderedNodes = buildExecutionOrder(graph);
  const portalInputsByChannel = getPortalInputMap(graph);

  for (const node of orderedNodes) {
    options.onNodeStart?.(node.id);
    if (options.stepDelayMs) {
      await delay(options.stepDelayMs);
    }

    const definition = defaultNodeRegistry.get(node.type);
    const inputs = graph.edges
      .filter((edge) => edge.toNodeId === node.id)
      .reduce<Record<string, unknown>>((acc, edge) => {
        const sourceOutput = outputsByNodeId.get(edge.fromNodeId);
        const nextValue = sourceOutput?.[edge.fromPortId];
        const portDefinition = definition?.inputs.find((port) => port.id === edge.toPortId);

        if (portDefinition?.allowMultiple) {
          const currentValues = Array.isArray(acc[edge.toPortId]) ? (acc[edge.toPortId] as unknown[]) : [];
          acc[edge.toPortId] = [...currentValues, nextValue];
          return acc;
        }

        acc[edge.toPortId] = nextValue;
        return acc;
      }, {});

    try {
      if (node.type === "utility.portalOut") {
        const channel = String(node.config.channel ?? "main").trim();
        const portalInputs = portalInputsByChannel.get(channel) ?? [];

        if (portalInputs.length > 1) {
          throw new Error(`Portal channel "${channel}" has multiple Portal In nodes. Use unique channel names.`);
        }

        const portalInput = portalInputs[0];
        if (portalInput) {
          inputs.value = outputsByNodeId.get(portalInput.id)?.value;
        }
      }

      const executor = defaultExecutorRegistry.get(node.type);
      if (!executor) {
        throw new Error(`No executor registered for ${node.type}`);
      }

      const result = await executor.run({ graph, node, inputs });
      outputsByNodeId.set(node.id, toOutputRecord(node, result));
      options.onNodeComplete?.(node.id);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error("Unknown node execution error.");
      options.onNodeError?.(node.id, normalized);
      throw normalized;
    }
  }

  return { outputsByNodeId, orderedNodes };
}

function computeDrawdown(curve: EquityPoint[]) {
  let peak = curve[0]?.equity ?? 0;
  let maxDrawdown = 0;

  for (const point of curve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) {
      maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak);
    }
  }

  return maxDrawdown;
}

function computeSharpeRatio(curve: EquityPoint[]) {
  if (curve.length < 2) {
    return 0;
  }

  const periodReturns: number[] = [];

  for (let index = 1; index < curve.length; index += 1) {
    const previousEquity = curve[index - 1]?.equity ?? 0;
    const currentEquity = curve[index]?.equity ?? 0;
    if (previousEquity <= 0) {
      continue;
    }

    periodReturns.push(currentEquity / previousEquity - 1);
  }

  if (periodReturns.length < 2) {
    return 0;
  }

  const meanReturn = periodReturns.reduce((sum, value) => sum + value, 0) / periodReturns.length;
  const variance =
    periodReturns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) /
    (periodReturns.length - 1);
  const standardDeviation = Math.sqrt(variance);

  if (standardDeviation === 0) {
    return 0;
  }

  return (meanReturn / standardDeviation) * Math.sqrt(252);
}

interface PositionState {
  direction: "long" | "short";
  entryPrice: number;
  quantity: number;
  entryEquity: number;
  entryTimestamp: string;
}

function markToMarketEquity(cash: number, position: PositionState | null, currentPrice: number) {
  if (!position) {
    return cash;
  }

  const directionSign = position.direction === "short" ? -1 : 1;
  return position.entryEquity + (currentPrice - position.entryPrice) * position.quantity * directionSign;
}

function closePositionAtPrice(cash: number, position: PositionState, exitPrice: number) {
  const directionSign = position.direction === "short" ? -1 : 1;
  return cash + (exitPrice - position.entryPrice) * position.quantity * directionSign;
}

function applySlippage(price: number, direction: "long" | "short", event: "entry" | "exit", slippagePct: number) {
  const factor = slippagePct / 100;

  if (event === "entry") {
    return direction === "long" ? price * (1 + factor) : price * (1 - factor);
  }

  return direction === "long" ? price * (1 - factor) : price * (1 + factor);
}

function applyCommission(equity: number, notional: number, commissionPct: number) {
  return equity - notional * (commissionPct / 100);
}

function resolveExecutionPriceData(graph: StrategyGraph, snapshot: ExecutionSnapshot, executionProduct: unknown) {
  const product = executionProduct as
    | {
        symbol?: string;
        marketData?: {
          symbol?: string;
          interval?: string;
          timestamps?: string[];
          open?: number[];
          high?: number[];
          low?: number[];
          close?: number[];
        };
      }
    | undefined;

  if (product?.marketData?.timestamps?.length) {
    return product.marketData;
  }

  const targetSymbol = String(product?.symbol ?? "").trim().toUpperCase();
  const datasetCandidates = graph.nodes
    .filter((node) => node.type === "data.yfinance")
    .map((node) => snapshot.outputsByNodeId.get(node.id)?.dataset)
    .filter(
      (dataset): dataset is {
        symbol?: string;
        interval?: string;
        timestamps?: string[];
        open?: number[];
        high?: number[];
        low?: number[];
        close?: number[];
      } => Boolean(dataset && typeof dataset === "object"),
    );

  if (!targetSymbol) {
    return datasetCandidates[0];
  }

  return (
    datasetCandidates.find((dataset) => String(dataset.symbol ?? "").trim().toUpperCase() === targetSymbol) ??
    datasetCandidates[0]
  );
}

function toPreviewValues(values: unknown) {
  if (Array.isArray(values) && values.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    return values;
  }

  if (Array.isArray(values) && values.every((entry) => typeof entry === "boolean")) {
    return values.map((entry) => (entry ? 1 : 0));
  }

  return null;
}

function extractSeriesPreview(value: unknown): { values: number[]; timestamps: string[] } | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { values: [value], timestamps: [] };
  }

  if (Array.isArray(value)) {
    const previewValues = toPreviewValues(value);
    if (previewValues) {
      return { values: previewValues, timestamps: [] };
    }
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  if ("values" in value) {
    const previewValues = toPreviewValues((value as { values?: unknown }).values);
    if (previewValues) {
      const timestamps = (value as { timestamps?: unknown }).timestamps;
      return {
        values: previewValues,
        timestamps: Array.isArray(timestamps)
          ? timestamps.filter((entry): entry is string => typeof entry === "string")
          : [],
      };
    }
  }

  if ("close" in value) {
    const previewValues = toPreviewValues((value as { close?: unknown }).close);
    if (previewValues) {
      const timestamps = (value as { timestamps?: unknown }).timestamps;
      return {
        values: previewValues,
        timestamps: Array.isArray(timestamps)
          ? timestamps.filter((entry): entry is string => typeof entry === "string")
          : [],
      };
    }
  }

  if ("signal" in value && typeof (value as { signal?: unknown }).signal === "object") {
    return extractSeriesPreview((value as { signal?: unknown }).signal);
  }

  return null;
}

function buildPreviewSeriesByEdgeId(graph: StrategyGraph, snapshot: ExecutionSnapshot): Record<string, SeriesPreview> {
  const previews: Record<string, SeriesPreview> = {};

  for (const edge of graph.edges) {
    const sourceNode = graph.nodes.find((node) => node.id === edge.fromNodeId);
    const sourceDefinition = sourceNode ? defaultNodeRegistry.get(sourceNode.type) : undefined;
    const sourcePort = sourceDefinition?.outputs.find((port) => port.id === edge.fromPortId);
    const sourceValue = snapshot.outputsByNodeId.get(edge.fromNodeId)?.[edge.fromPortId];
    const preview = extractSeriesPreview(sourceValue);

    if (!preview || preview.values.length === 0) {
      continue;
    }

    previews[edge.id] = {
      edgeId: edge.id,
      sourceNodeId: edge.fromNodeId,
      sourceNodeTitle: sourceNode?.title ?? sourceDefinition?.title ?? edge.fromNodeId,
      sourcePortId: edge.fromPortId,
      sourcePortLabel: sourcePort?.label ?? edge.fromPortId,
      values: preview.values,
      timestamps: preview.timestamps,
    };
  }

  return previews;
}

function buildBacktestResult(graph: StrategyGraph, snapshot: ExecutionSnapshot): BacktestResult {
  const executionNode = graph.nodes.find((node) => node.type === "trading.execution");
  const executionRecord = executionNode ? snapshot.outputsByNodeId.get(executionNode.id) : undefined;
  const execution = executionRecord as {
    product?: {
      symbol?: string;
      assetType?: string;
      marketData?: {
        symbol?: string;
        interval?: string;
        timestamps?: string[];
        open?: number[];
        high?: number[];
        low?: number[];
        close?: number[];
      };
    };
    signals?: Array<{
      signal?: boolean[];
      side?: "long" | "short";
      reversePosition?: boolean;
    }>;
    settings?: {
      allowShorts?: boolean;
      slippagePct?: number;
      commissionPct?: number;
    };
  } | undefined;
  const dataset = resolveExecutionPriceData(graph, snapshot, execution?.product);

  const timestamps = dataset?.timestamps ?? [];
  const close = dataset?.close ?? [];
  const executionSignals = execution?.signals ?? [];
  const allowShorts = execution?.settings?.allowShorts ?? true;
  const slippagePct = Math.max(0, execution?.settings?.slippagePct ?? 0);
  const commissionPct = Math.max(0, execution?.settings?.commissionPct ?? 0);

  if (timestamps.length === 0 || close.length === 0) {
    return {
      graphName: "Untitled Strategy",
      summary: {
        totalTrades: 0,
        winRate: 0,
        netProfit: 0,
        maxDrawdown: 0,
        endingEquity: 100000,
        strategyReturn: 0,
        buyHoldReturn: 0,
        sharpeRatio: 0,
      },
      equityCurve: [],
      buyHoldCurve: [],
      priceSeries: [],
      tradeMarkers: [],
      previewSeriesByEdgeId: buildPreviewSeriesByEdgeId(graph, snapshot),
      logs: ["Backtest produced no price data."],
    };
  }

  const initialCapital = 100000;
  let cash = initialCapital;
  let buyHoldEquity = initialCapital;
  let position: PositionState | null = null;
  let winningTrades = 0;
  let totalTrades = 0;
  const tradeMarkers: TradeMarker[] = [];
  const equityCurve: EquityPoint[] = [];
  const buyHoldCurve: EquityPoint[] = [];
  const priceSeries: CandlePoint[] = [];
  const executedTrades: Array<{ entryTimestamp: string; exitTimestamp: string; direction: "long" | "short"; pnl: number }> = [];
  let pendingTransition: "long" | "short" | "flat" | null = null;

  for (let index = 0; index < close.length; index += 1) {
    const price = close[index];
    const openPrice = dataset?.open?.[index] ?? price;
    const previousPrice = close[index - 1] ?? price;
    const barReturn = previousPrice === 0 ? 0 : (price - previousPrice) / previousPrice;

    if (index > 0 && pendingTransition !== null) {
      if (position && pendingTransition !== position.direction) {
        const exitPrice = applySlippage(openPrice, position.direction, "exit", slippagePct);
        const realizedBeforeCommission = closePositionAtPrice(cash, position, exitPrice);
        const realizedCash = applyCommission(realizedBeforeCommission, position.quantity * exitPrice, commissionPct);
        const pnl = realizedCash - cash;
        cash = realizedCash;
        totalTrades += 1;
        if (pnl >= 0) {
          winningTrades += 1;
        }
        tradeMarkers.push({ timestamp: timestamps[index], price: exitPrice, event: "exit", direction: position.direction });
        executedTrades.push({
          entryTimestamp: position.entryTimestamp,
          exitTimestamp: timestamps[index],
          direction: position.direction,
          pnl: Number(pnl.toFixed(2)),
        });
        position = null;
      }

      if (!position && pendingTransition !== "flat") {
        const entryPrice = applySlippage(openPrice, pendingTransition, "entry", slippagePct);
        const quantity = cash / (entryPrice * (1 + commissionPct / 100));
        cash = applyCommission(cash, quantity * entryPrice, commissionPct);
        position = {
          direction: pendingTransition,
          entryPrice: entryPrice,
          quantity,
          entryEquity: cash,
          entryTimestamp: timestamps[index],
        };
        tradeMarkers.push({ timestamp: timestamps[index], price: entryPrice, event: "entry", direction: pendingTransition });
      }

      pendingTransition = null;
    }

    if (index > 0) {
      buyHoldEquity *= 1 + barReturn;
    }
    const equity = markToMarketEquity(cash, position, price);

    equityCurve.push({
      timestamp: timestamps[index],
      equity: Number(equity.toFixed(2)),
    });
    buyHoldCurve.push({
      timestamp: timestamps[index],
      equity: Number(buyHoldEquity.toFixed(2)),
    });
    priceSeries.push({
      timestamp: timestamps[index],
      open: dataset?.open?.[index] ?? price,
      high: dataset?.high?.[index] ?? price,
      low: dataset?.low?.[index] ?? price,
      close: price,
    });

    const wantsLong = executionSignals.some(
      (signal) => signal.side === "long" && Boolean(signal.signal?.[index]),
    );
    const wantsShort = executionSignals.some(
      (signal) => signal.side === "short" && Boolean(signal.signal?.[index]),
    );
    const wantsReverseToLong = executionSignals.some(
      (signal) =>
        signal.side === "long" &&
        signal.reversePosition === true &&
        Boolean(signal.signal?.[index]),
    );
    const wantsReverseToShort = executionSignals.some(
      (signal) =>
        signal.side === "short" &&
        signal.reversePosition === true &&
        Boolean(signal.signal?.[index]),
    );

    let desiredDirection: "long" | "short" | "flat";
    if (position?.direction === "long") {
      if (wantsReverseToShort && allowShorts) {
        desiredDirection = "short";
      } else if (wantsShort) {
        desiredDirection = "flat";
      } else {
        desiredDirection = "long";
      }
    } else if (position?.direction === "short") {
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

    if (position) {
      if (desiredDirection !== position.direction) {
        pendingTransition = desiredDirection;
      }
    } else if (desiredDirection !== "flat") {
      pendingTransition = desiredDirection;
    }
  }

  if (position) {
    const finalPrice = close[close.length - 1] ?? 0;
    const finalTimestamp = timestamps[timestamps.length - 1];
    const exitPrice = applySlippage(finalPrice, position.direction, "exit", slippagePct);
    const realizedBeforeCommission = closePositionAtPrice(cash, position, exitPrice);
    const realizedCash = applyCommission(realizedBeforeCommission, position.quantity * exitPrice, commissionPct);
    const pnl = realizedCash - cash;
    cash = realizedCash;
    totalTrades += 1;
    if (pnl >= 0) {
      winningTrades += 1;
    }
    tradeMarkers.push({ timestamp: finalTimestamp, price: exitPrice, event: "exit", direction: position.direction });
    executedTrades.push({
      entryTimestamp: position.entryTimestamp,
      exitTimestamp: finalTimestamp,
      direction: position.direction,
      pnl: Number(pnl.toFixed(2)),
    });
    position = null;
    equityCurve[equityCurve.length - 1] = {
      timestamp: finalTimestamp,
      equity: Number(cash.toFixed(2)),
    };
  }

  const endingEquity = equityCurve[equityCurve.length - 1]?.equity ?? initialCapital;
  const finalBuyHold = buyHoldCurve[buyHoldCurve.length - 1]?.equity ?? initialCapital;
  const netProfit = endingEquity - initialCapital;
  const strategyReturn = endingEquity / initialCapital - 1;
  const buyHoldReturn = finalBuyHold / initialCapital - 1;
  const sharpeRatio = computeSharpeRatio(equityCurve);

  return {
    graphName: `${execution?.product?.symbol ?? dataset?.symbol ?? "Strategy"} Backtest`,
    summary: {
      totalTrades,
      winRate: totalTrades > 0 ? winningTrades / totalTrades : 0,
      netProfit: Number(netProfit.toFixed(2)),
      maxDrawdown: Number(computeDrawdown(equityCurve).toFixed(4)),
      endingEquity: Number(endingEquity.toFixed(2)),
      strategyReturn: Number(strategyReturn.toFixed(4)),
      buyHoldReturn: Number(buyHoldReturn.toFixed(4)),
      sharpeRatio: Number(sharpeRatio.toFixed(2)),
    },
    equityCurve,
    buyHoldCurve,
    priceSeries,
    tradeMarkers,
    previewSeriesByEdgeId: buildPreviewSeriesByEdgeId(graph, snapshot),
    logs: [
      `Loaded execution price data for symbol ${execution?.product?.symbol ?? dataset?.symbol ?? "unknown"}.`,
      `Executed ${snapshot.orderedNodes.length} nodes in dependency order.`,
      `Aggregated ${executionSignals.length} signal stream${executionSignals.length === 1 ? "" : "s"} into a target-position model.`,
      `Execution settings: slippage ${slippagePct.toFixed(3)}%, commission ${commissionPct.toFixed(3)}%, shorts ${allowShorts ? "enabled" : "disabled"}.`,
      `Generated ${tradeMarkers.filter((marker) => marker.event === "entry").length} entries and ${tradeMarkers.filter((marker) => marker.event === "exit").length} exits.`,
      `Closed ${executedTrades.length} position${executedTrades.length === 1 ? "" : "s"} using next-bar open fills.`,
      `Final strategy equity: $${endingEquity.toLocaleString()}.`,
    ],
  };
}

export async function runBacktest(graph: StrategyGraph, options: RunBacktestOptions = {}): Promise<BacktestResult> {
  const issues = validateGraph(graph);
  if (issues.length > 0) {
    const error = new Error(issues[0].message);
    if (issues[0].nodeId) {
      options.onNodeError?.(issues[0].nodeId, error);
    }
    throw error;
  }

  const snapshot = await executeGraph(graph, {
    stepDelayMs: options.stepDelayMs ?? 0,
    onNodeStart: options.onNodeStart,
    onNodeComplete: options.onNodeComplete,
    onNodeError: options.onNodeError,
  });

  return buildBacktestResult(graph, snapshot);
}
