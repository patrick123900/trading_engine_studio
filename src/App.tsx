import { Component, useEffect, useMemo, useRef, useState, type ChangeEvent, type ErrorInfo, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Canvas } from "./components/Canvas";
import { runBacktest } from "./core/engine/backtestRunner";
import {
  getPortalInChannels,
  getPortalInInputId,
  getPortalInInputIndex,
  getPortalOutChannels,
  getPortalOutOutputId,
  getPortalOutOutputIndex,
} from "./core/nodes/portalChannels";
import {
  getLogicInputId,
  getLogicInputIndex,
  getLogicInputLabels,
} from "./core/nodes/logicInputs";
import { defaultNodeRegistry } from "./core/nodes/registry";
import {
  deleteStoredGraph,
  listStoredGraphs,
  loadStoredGraph,
  renameStoredGraph,
  saveStoredGraph,
  type StoredGraphDocument,
} from "./core/storage/graphStorage";
import type { BacktestResult, GraphCameraState, GraphEdge, GraphGroup, GraphNode, NodeDefinition, StrategyGraph } from "./core/types";

interface RuntimeLogEntry {
  id: string;
  source: "error" | "promise" | "react";
  message: string;
  details?: string;
}

interface ClipboardPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface HistoryState {
  snapshots: string[];
  index: number;
}

interface NameDialogState {
  mode: "saveAs" | "rename";
  title: string;
  submitLabel: string;
  initialValue: string;
  targetName?: string;
}

interface DeleteDialogState {
  name: string;
}

interface DocumentationTopic {
  id: string;
  title: string;
  searchText: string;
  sections: Array<{
    heading: string;
    paragraphs?: string[];
    bullets?: string[];
  }>;
}

interface ErrorBoundaryProps {
  onError: (entry: RuntimeLogEntry) => void;
  children: ReactNode;
}

class RuntimeErrorBoundary extends Component<ErrorBoundaryProps> {
  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError({
      id: `react-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      source: "react",
      message: error.message,
      details: info.componentStack ?? undefined,
    });
  }

  render() {
    return this.props.children;
  }
}

function makeRuntimeLogEntry(source: RuntimeLogEntry["source"], message: string, details?: string): RuntimeLogEntry {
  return {
    id: `${source}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    source,
    message,
    details,
  };
}

function formatPortKind(kind: NodeDefinition["inputs"][number]["kind"]) {
  switch (kind) {
    case "dataset":
      return "dataset";
    case "series":
      return "numeric series";
    case "number":
      return "number or numeric series";
    case "boolean":
      return "boolean or boolean series";
    case "signal":
      return "trade signal";
    case "product":
      return "product";
    case "any":
    default:
      return "any value";
  }
}

function formatFieldType(type: NodeDefinition["fields"][number]["type"]) {
  switch (type) {
    case "number":
      return "number";
    case "select":
      return "select";
    case "symbol":
      return "symbol";
    case "checkbox":
      return "checkbox";
    case "text":
    default:
      return "text";
  }
}

function getCustomFieldDoc(definition: NodeDefinition, fieldKey: string) {
  const docs: Record<string, Record<string, string>> = {
    "output.signal": {
      side:
        "Chooses whether this node represents a Long signal, a Short signal, or a Close signal. Long and Short only fire when the input changes from false to true. Close stays true for as long as its input stays true, so it continuously requests flattening while the close condition is active.",
      reversePosition:
        "If enabled, a Long signal can reverse an open short directly into a long, and a Short signal can reverse an open long directly into a short.",
    },
    "trading.execution": {
      startingCapital: "Initial account value used when the simulation starts.",
      positionAmount:
        "Trade size. Enter a plain number like 1000 for a fixed amount, or add % such as 25% to use that percentage of the current account value at the time each new position is opened.",
      positionPnlPercent:
        "If enabled, the Position PnL output is shown as percentage of the invested amount of the currently open position. If disabled, it is shown as account-currency amount.",
      longFillAnchor:
        "Price anchor used when a long-side signal causes an entry, exit, or reversal. Open is usually neutral, High is pessimistic for long fills, Low is optimistic, and Close assumes end-of-bar execution.",
      shortFillAnchor:
        "Price anchor used when a short-side signal causes an entry, exit, or reversal. Open is usually neutral, Low is pessimistic for short entries, High is pessimistic for short exits, and Close assumes end-of-bar execution.",
      allowShorts:
        "Controls whether the engine is allowed to open new short positions. Short-side signals can still be used to close existing longs.",
      slippagePct:
        "Worsens fill prices by this percentage in the unfavorable direction on both entries and exits.",
      commissionPct:
        "Commission charged as a percentage of trade notional on both entry and exit.",
    },
    "data.yfinance": {
      symbol: "Ticker symbol to generate data for, such as AAPL.",
      interval: "Bar length for the returned candles: 1 day, 1 hour, 15 minutes, 5 minutes, or 1 minute.",
      lookback: "Number of bars to return. Leave blank or set to 0 to use the maximum allowed bars.",
    },
    "data.alternativeCryptoMarket": {
      symbol: "Binance market symbol such as BTCUSDT.",
      interval: "Bar length for the returned candles, from 1 minute up to 1 day.",
      lookback: "Number of candles to request.",
    },
    "data.ecbFx": {
      base: "Base currency of the pair, for example EUR.",
      quote: "Quote currency of the pair, for example USD.",
      lookback: "Number of daily reference bars to return.",
    },
    "data.alternativeFearGreed": {
      lookback: "Number of historical Fear & Greed observations to return.",
    },
    "data.eiaBulk": {
      series: "Which bundled EIA energy series to load.",
      lookback: "Number of observations to return from the end of the selected series.",
    },
    "data.worldBankCommodity": {
      commodity: "Which World Bank commodity price series to load.",
      lookback: "Number of monthly observations to return from the end of the selected series.",
    },
    "data.ohlcSource": {
      source: "Which price field to extract from the incoming dataset: Open, High, Low, or Close.",
    },
    "data.yfinanceUpgradesDowngrades": {
      strength: "Scales the size of upgrade and downgrade events in the generated historical event series.",
    },
    "indicator.rsi": {
      period: "RSI lookback length.",
    },
    "indicator.ma": {
      method: "Moving average calculation method: SMA, EMA, or WMA.",
      length: "Number of bars used in the moving average.",
    },
    "logic.comparison": {
      operator: "Comparison operator applied between Left and Right. Supports <, >, =, <=, and >=.",
    },
    "logic.fixedValue": {
      value: "Constant numeric value emitted by the node.",
    },
    "arithmetic.offset": {
      bars:
        "Positive values shift the source right in time, so the current bar sees older values. Negative values shift left and introduce lookahead. Works for numeric and boolean series.",
    },
    "datetime.standardize": {
      inputMode:
        "Auto accepts ISO strings or epoch numbers and infers seconds vs milliseconds. Choose a fixed mode if your source format is known.",
    },
    "datetime.duration": {
      amount: "Numeric size of the duration.",
      unit:
        "Duration unit converted to epoch milliseconds. Use this output with Add/Subtract nodes to move timestamps in time.",
    },
    "datetime.parts": {
      timezone:
        "UTC is deterministic across machines and recommended for backtests. Local uses the browser's timezone.",
    },
    "datetime.floor": {
      unit: "Boundary used for flooring, such as day or week.",
      timezone: "Timezone basis used to determine boundary cutoffs.",
      weekStartsOn: "Only used when unit is Week.",
    },
  };

  return docs[definition.type]?.[fieldKey];
}

function getCustomOutputDoc(definition: NodeDefinition, outputId: string) {
  const docs: Record<string, Record<string, string>> = {
    "trading.execution": {
      longPosition:
        "Boolean series that is true on bars where the strategy is currently holding a long position after simulated fills are applied.",
      shortPosition:
        "Boolean series that is true on bars where the strategy is currently holding a short position after simulated fills are applied.",
      positionPnl:
        "Series of unrealized PnL for the currently open position. Flat bars output 0. Depending on the checkbox setting, this is either amount or percentage of invested amount.",
    },
    "output.signal": {
      signal:
        "Structured trade-signal stream consumed by Trade Execution. It carries the boolean trigger values, the selected side, and the reverse-position flag.",
    },
    "data.yfinance": {
      dataset:
        "OHLC dataset with timestamps, interval, symbol, and bars count. The open, high, low, and close arrays all match the selected interval and lookback.",
      product:
        "Product description for the same symbol, including the marketData payload used by Trade Execution for fills and charting.",
    },
    "data.alternativeCryptoMarket": {
      dataset:
        "Historical crypto OHLC dataset from Binance with timestamps plus open, high, low, and close arrays at the selected interval.",
      product:
        "Crypto product description with embedded marketData, suitable for Trade Execution input.",
    },
    "data.ecbFx": {
      dataset:
        "Daily ECB FX reference-rate dataset. Open, high, low, and close are all the same daily reference value, so it behaves like synthetic flat OHLC bars rather than true intraday candles.",
      product:
        "Forex product description with the same daily reference-rate marketData embedded for execution and charting.",
    },
    "data.alternativeFearGreed": {
      series:
        "Numeric historical series in the 0-100 Fear & Greed scale. Each point is a dated sentiment reading, not OHLC data.",
    },
    "data.eiaBulk": {
      series:
        "Historical numeric energy price series from the bundled EIA dataset. This is a single-value series, not OHLC candles.",
    },
    "data.worldBankCommodity": {
      series:
        "Historical monthly numeric commodity price series from the World Bank Pink Sheet. This is monthly single-value data, not OHLC candles.",
    },
    "data.ohlcSource": {
      series:
        "Numeric series extracted from the chosen OHLC field of the incoming dataset. Timestamps are preserved from the source dataset.",
    },
    "data.yfinanceUpgradesDowngrades": {
      event:
        "Sparse numeric event series where positive values represent upgrade-like events and negative values represent downgrade-like events.",
      score:
        "Running analyst-tone score derived from the event stream. Higher means more positive analyst history in this synthetic aligned series.",
    },
    "data.yfinanceEarningsHistory": {
      surprisePct:
        "Sparse numeric earnings-surprise series. Most bars are 0, and earnings bars contain the simulated surprise percentage.",
      event:
        "Sparse event-direction series. Earnings bars are 1 for positive surprise and -1 for negative surprise; non-event bars are 0.",
    },
    "indicator.rsi": {
      series: "RSI series scaled from 0 to 100.",
    },
    "indicator.ma": {
      series: "Moving-average series using the selected calculation method and length.",
    },
    "arithmetic.normalizePair": {
      leftNormalized: "Left input rebased so its first usable value starts at 100.",
      rightNormalized: "Right input rebased so its first usable value starts at 100.",
    },
    "arithmetic.offset": {
      series: "Shifted copy of the source series with the same timestamps.",
    },
  };

  return docs[definition.type]?.[outputId];
}

function getCustomNodeNotes(definition: NodeDefinition) {
  const notes: Record<string, string[]> = {
    "data.yfinance": [
      "Granularity is customizable between daily, hourly, 15-minute, 5-minute, and 1-minute bars.",
      "This node outputs true OHLC arrays plus timestamps and symbol information.",
      "Lookback accepts blank or 0 as 'maximum bars'.",
      "Daily bars are business-day aligned (Mon-Fri) and synthetic timestamps are anchored to recent dates.",
    ],
    "data.alternativeCryptoMarket": [
      "Granularity is customizable from 1 minute through 1 day depending on the selected Binance interval.",
      "This node outputs true OHLC arrays plus timestamps and symbol information.",
    ],
    "data.ecbFx": [
      "Granularity is daily only.",
      "The dataset shape is OHLC-compatible, but all four fields are the same daily reference rate because ECB provides reference values rather than true candles.",
    ],
    "data.alternativeFearGreed": [
      "This is a historical sentiment index for the crypto market, centered on the Alternative.me Fear & Greed dataset.",
      "It outputs a single numeric series in the 0-100 range, not a product and not OHLC candles.",
    ],
    "data.eiaBulk": [
      "This node returns a single historical numeric series from bundled EIA data rather than OHLC candles.",
      "Series frequency depends on the selected preset, such as daily, weekly, or monthly.",
    ],
    "data.worldBankCommodity": [
      "Granularity is monthly.",
      "This node returns a single historical numeric series rather than OHLC candles.",
    ],
    "output.signal": [
      "Long and Short signals are edge-triggered: they only fire when input changes from false to true.",
      "Close is level-triggered: it stays active for as long as the input stays true, so it can keep requesting a close condition until the position is flat.",
    ],
    "logic.and": [
      "AND starts with two inputs and supports adding more boolean inputs from the node panel.",
      "All configured boolean inputs must evaluate true for the output to be true.",
    ],
    "logic.or": [
      "OR starts with two inputs and supports adding more boolean inputs from the node panel.",
      "Output is true when at least one configured boolean input is true.",
    ],
    "datetime.standardize": [
      "Use this node to normalize mixed timestamp formats into consistent epoch-millisecond series.",
      "It is typically the first step before DateTime Parts, DateTime Floor, or datetime arithmetic with Duration Constant.",
    ],
    "trading.execution": [
      "This node is where the backtest engine gets its execution assumptions: capital, sizing, fill anchors, slippage, commissions, and whether shorts may be opened.",
      "It consumes Product plus one or more Signal inputs and produces state series that you can feed back into logic and gates.",
    ],
  };

  return notes[definition.type] ?? [];
}

function createDocumentationTopics(definitions: NodeDefinition[]): DocumentationTopic[] {
  const groupedDefinitions = definitions.reduce<Record<string, NodeDefinition[]>>((acc, definition) => {
    acc[definition.category] ??= [];
    acc[definition.category].push(definition);
    return acc;
  }, {});

  const baseTopics: DocumentationTopic[] = [
    {
      id: "overview",
      title: "Overview",
      searchText: "overview getting started visual scripting backtesting strategies nodes graph",
      sections: [
        {
          heading: "What This Tool Is",
          paragraphs: [
            "This app is a visual strategy builder for backtesting trading ideas. You build a graph of nodes, connect data to indicators and logic, then feed the result into Trade Execution to simulate entries, exits, positions, and performance.",
            "Everything currently runs client-side in the browser. Saved strategies live in browser storage unless you export them.",
          ],
        },
        {
          heading: "Typical Workflow",
          bullets: [
            "Add a data source such as YFinance, crypto data, ECB FX, EIA energy, or World Bank commodities.",
            "Normalize timestamps when needed with DateTime nodes such as Timestamp Standardize and DateTime Parts.",
            "Convert or derive series with nodes like OHLC Source, RSI, MA, Offset, Arithmetic, Crosses Above, Crosses Below, AND, OR, and NOT.",
            "Turn logic into trade intent with Signal nodes.",
            "Feed Product and Signals into Trade Execution.",
            "Run the strategy and inspect results, logs, and series previews.",
          ],
        },
      ],
    },
    {
      id: "menus",
      title: "Menus & Windows",
      searchText: "file edit view help menus nodes library strategy collection execution log documentation import export save open",
      sections: [
        {
          heading: "Top Menu Bar",
          bullets: [
            "File: New, Open, Save, Save As, Import, Export.",
            "Edit: Undo, Redo, Copy, Cut, Paste.",
            "View: Nodes Library, Strategy Collection, Execution Log.",
            "Help: Documentation.",
          ],
        },
        {
          heading: "Windows",
          bullets: [
            "Nodes Library lets you search and add nodes or groups.",
            "Strategy Collection shows saved strategies with preview cards, rename, search, and delete.",
            "Execution Log opens the full log from the latest run.",
            "Documentation is the in-app manual you are reading now.",
          ],
        },
      ],
    },
    {
      id: "controls",
      title: "Canvas & Controls",
      searchText: "canvas controls pan zoom drag connect box select ctrl click right click auto align recenter grid snap",
      sections: [
        {
          heading: "Mouse & Graph Editing",
          bullets: [
            "Left-drag on empty canvas pans the camera.",
            "Ctrl/Cmd + left-drag makes a selection box.",
            "Ctrl/Cmd + click toggles node selection.",
            "Drag node headers to move nodes. Drag a selected node to move the selected group of nodes.",
            "Start a connection by dragging from an output dot to an input.",
            "Right-click the canvas to open Add Node / Create Group.",
          ],
        },
        {
          heading: "Floating Controls",
          bullets: [
            "Auto Align reorganizes the graph layout.",
            "Recenter Camera frames all nodes and can be triggered with C.",
            "Grid Snap toggles snapping for movement and placement and can be toggled with G.",
            "Run executes the current strategy.",
          ],
        },
      ],
    },
    {
      id: "groups",
      title: "Groups",
      searchText: "groups create group move group rename group resize group auto align within group",
      sections: [
        {
          heading: "Working With Groups",
          bullets: [
            "Create a group from the right-click menu or Nodes Library.",
            "Groups are visual regions with a title and resize handle.",
            "Drag a group header to move the group and all nodes fully contained inside it.",
            "Click the group title to rename it inline.",
            "Auto Align respects group boundaries first, then aligns ungrouped nodes normally.",
          ],
        },
      ],
    },
    {
      id: "execution",
      title: "Signals & Trade Execution",
      searchText: "signal trade execution long short reverse position amount starting capital commission slippage fill anchor open high low close pnl",
      sections: [
        {
          heading: "Signal Nodes",
          bullets: [
            "Signal turns boolean logic into trade intent.",
            "Long and Short signals emit on rising edge, not continuously on every true bar.",
            "Close signals stay true for as long as the input stays true. In practice, that means a Close signal behaves like an active flatten request rather than a one-bar pulse.",
            "Use side to decide whether the signal is Long or Short.",
            "Reverse Position lets a signal reverse an opposite open position instead of only closing it.",
          ],
        },
        {
          heading: "Trade Execution",
          bullets: [
            "Trade Execution takes a Product input and one or more Signal inputs.",
            "Starting Capital sets initial account value.",
            "Position Amount accepts either a fixed amount like 1000 or a percentage like 25%. A percentage is always based on the account value as it exists at that point in the simulation, so gains and losses from earlier closed trades change the size of later percentage-based positions.",
            "Long Fill and Short Fill define which bar anchor is used when fills are simulated: Open, High, Low, or Close.",
            "Allow Shorts blocks opening new short positions, but short signals can still be used to close longs when appropriate.",
            "Position PnL can be output as amount or percentage of invested capital for that open position.",
            "Long Position is true when the simulation is currently long, Short Position is true when it is currently short, and Position PnL is the unrealized PnL of the current open position.",
          ],
        },
      ],
    },
    {
      id: "results",
      title: "Running & Results",
      searchText: "run results chart equity candles metrics sharpe buy hold execution log preview outputs",
      sections: [
        {
          heading: "Running a Strategy",
          bullets: [
            "Press the Run button to execute the graph in dependency order.",
            "The currently executing node highlights in green.",
            "A node that throws an error highlights in red and the runtime log captures the error.",
          ],
        },
        {
          heading: "Results Pane",
          bullets: [
            "The bottom pane shows key metrics and a chart.",
            "The pane can be resized or collapsed.",
            "The execution log is available from View -> Execution Log.",
            "The default chart shows normalized product price and strategy equity.",
            "The X axis shows adaptive timestamp labels that auto-adjust granularity to the tested timespan.",
          ],
        },
        {
          heading: "Inspecting Output Series",
          bullets: [
            "After a run, click an output label to preview that output’s executed series.",
            "Ctrl/Cmd + click output labels to compare multiple series at once.",
            "You can preview outputs even if they are not connected anywhere.",
          ],
        },
      ],
    },
    {
      id: "saving",
      title: "Saving, Import & Export",
      searchText: "save save as open import export local storage browser github docker",
      sections: [
        {
          heading: "Persistence",
          bullets: [
            "Save stores the current strategy in browser storage on the current machine/browser profile.",
            "Save As creates a named copy.",
            "Open and Strategy Collection load saved strategies from browser storage.",
          ],
        },
        {
          heading: "Files",
          bullets: [
            "Export writes the strategy graph and camera state to JSON.",
            "Import loads a strategy JSON back into the editor.",
            "If you use multiple computers or browsers, use Export/Import to move strategies between them.",
          ],
        },
      ],
    },
    {
      id: "node-catalog",
      title: "Node Catalog",
      searchText: "node catalog categories all nodes",
      sections: [
        {
          heading: "Available Categories",
          bullets: Object.keys(groupedDefinitions)
            .sort((a, b) => a.localeCompare(b))
            .map((category) => `${category}: ${(groupedDefinitions[category] ?? []).length} node(s)`),
        },
      ],
    },
  ];

  const categoryTopics = Object.keys(groupedDefinitions)
    .sort((a, b) => a.localeCompare(b))
    .map<DocumentationTopic>((category) => {
      const categoryDefinitions = [...(groupedDefinitions[category] ?? [])].sort((a, b) =>
        a.title.localeCompare(b.title),
      );
      return {
        id: `category-${category.toLowerCase().replace(/\s+/g, "-")}`,
        title: `${category} Nodes`,
        searchText: `${category} ${categoryDefinitions.map((definition) => `${definition.title} ${definition.description} ${definition.type} ${definition.fields.map((field) => field.label).join(" ")} ${definition.inputs.map((port) => port.label).join(" ")} ${definition.outputs.map((port) => port.label).join(" ")}`).join(" ")}`,
        sections: categoryDefinitions.map((definition) => ({
          heading: definition.title,
          paragraphs: [definition.description],
          bullets: [
            `Type: ${definition.type}`,
            ...(definition.inputs.length > 0
              ? definition.inputs.map(
                  (port) =>
                    `Input - ${port.label}: ${formatPortKind(port.kind)}${port.allowMultiple ? "; multiple connections allowed" : ""}.`,
                )
              : ["Inputs: None"]),
            ...(definition.outputs.length > 0
              ? definition.outputs.map((port) => {
                  const customOutputDoc = getCustomOutputDoc(definition, port.id);
                  return `Output - ${port.label}: ${customOutputDoc ?? `${formatPortKind(port.kind)} output.`}`;
                })
              : ["Outputs: None"]),
            ...(definition.fields.length > 0
              ? definition.fields.map((field) => {
                  const customFieldDoc = getCustomFieldDoc(definition, field.key);
                  const optionsText =
                    field.type === "select" && field.options?.length
                      ? ` Options: ${field.options.map((option) => option.label).join(", ")}.`
                      : "";
                  const fallback = `Parameter - ${field.label}: ${formatFieldType(field.type)} field.${optionsText}`;
                  return customFieldDoc
                    ? `Parameter - ${field.label}: ${customFieldDoc}${optionsText}`
                    : fallback;
                })
              : ["Parameters: None"]),
            ...getCustomNodeNotes(definition).map((note) => `Note: ${note}`),
          ],
        })),
      };
    });

  return [...baseTopics, ...categoryTopics];
}

function makeEdgeId() {
  return `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeGroupId() {
  return `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function buildNodeFromDefinition(definition: NodeDefinition, x: number, y: number): GraphNode {
  const config: GraphNode["config"] = Object.fromEntries(definition.fields.map((field) => [field.key, field.defaultValue]));

  if (definition.type === "utility.portalOut") {
    const channels = getPortalOutChannels(config);
    config.channel = channels[0];
    config.channels = channels;
  }
  if (definition.type === "utility.portalIn") {
    const channels = getPortalInChannels(config);
    config.channel = channels[0];
    config.channels = channels;
  }
  if (definition.type === "logic.and" || definition.type === "logic.or") {
    config.inputs = getLogicInputLabels(config);
  }

  return {
    id: `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    type: definition.type,
    title: definition.title,
    position: { x, y },
    config,
  };
}

function makeNodeId() {
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function cloneGraph(graph: StrategyGraph): StrategyGraph {
  return JSON.parse(JSON.stringify(graph)) as StrategyGraph;
}

const DEFAULT_CAMERA: GraphCameraState = { x: 80 - 25000, y: 70 - 25000, zoom: 1 };
const GRID_SNAP_STORAGE_KEY = "trading-engine:grid-snap-enabled";

function loadGridSnapPreference() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(GRID_SNAP_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function createEmptyGraph(): StrategyGraph {
  return { nodes: [], edges: [], groups: [] };
}

function normalizeGraph(graph: StrategyGraph): StrategyGraph {
  const clonedGraph = cloneGraph(graph);
  const nextGraph: StrategyGraph = {
    ...clonedGraph,
    groups: Array.isArray((graph as Partial<StrategyGraph>).groups) ? clonedGraph.groups : [],
  };
  const dataProductSourceNode = nextGraph.nodes.find((node) =>
    ["data.yfinance", "data.ecbFx", "data.alternativeCryptoMarket"].includes(node.type),
  );
  const signalNodes = nextGraph.nodes.filter(
    (node) => node.type === "output.signal" || node.type === "output.entrySignal",
  );

  let executionNode = nextGraph.nodes.find((node) => node.type === "trading.execution");
  const executionNodeWasNew = !executionNode;
  if (!executionNode && signalNodes.length > 0) {
    const anchor = signalNodes[signalNodes.length - 1];
    executionNode = {
      id: makeNodeId(),
      type: "trading.execution",
      title: "Trade Execution",
      position: { x: anchor.position.x + 300, y: anchor.position.y },
      config: {},
    };
    nextGraph.nodes.push(executionNode);
  }

  signalNodes.forEach((node) => {
    const legacyLabel = String(node.config.label ?? "");
    const existingSide = String(node.config.side ?? "").toLowerCase();
    const legacySide =
      existingSide === "close"
        ? "close"
        :
      existingSide === "short" || /short/i.test(legacyLabel)
        ? "short"
        : existingSide === "long"
          ? "long"
          : "long";

    node.type = "output.signal";
    node.title = "Signal";
    node.config = {
      ...node.config,
      side: legacySide,
      reversePosition: Boolean(node.config.reversePosition),
    };
  });

  nextGraph.nodes = nextGraph.nodes.map((node) => {
    if (node.type === "utility.portalOut") {
      const channels = getPortalOutChannels(node.config);
      return {
        ...node,
        config: {
          ...node.config,
          channel: channels[0],
          channels,
        },
      };
    }

    if (node.type === "utility.portalIn") {
      const channels = getPortalInChannels(node.config);
      return {
        ...node,
        config: {
          ...node.config,
          channel: channels[0],
          channels,
        },
      };
    }

    if (node.type === "logic.and" || node.type === "logic.or") {
      const inputs = getLogicInputLabels(node.config);
      return {
        ...node,
        config: {
          ...node.config,
          inputs,
        },
      };
    }

    return node;
  });

  nextGraph.edges = nextGraph.edges
    .filter(
      (edge) =>
        !(
          edge.toPortId === "product" &&
          nextGraph.nodes.some((node) => node.id === edge.toNodeId && node.type === "data.yfinance")
        ),
    )
    .map((edge) => {
      if (
        nextGraph.nodes.some((node) => node.id === edge.fromNodeId && node.type === "trading.product")
      ) {
        return null;
      }

      if (
        executionNode &&
        edge.toNodeId === executionNode.id &&
        ["openLong", "closeLong", "openShort", "closeShort"].includes(edge.toPortId)
      ) {
        return {
          ...edge,
          toPortId: "signals",
        };
      }

      return edge;
    })
    .filter((edge): edge is NonNullable<typeof edge> => edge !== null);

  nextGraph.nodes = nextGraph.nodes.filter((node) => node.type !== "trading.product");

  if (executionNode) {
    signalNodes.forEach((node) => {
      if (!executionNodeWasNew) return;
      if (
        !nextGraph.edges.some(
          (edge) =>
            edge.fromNodeId === node.id &&
            edge.fromPortId === "signal" &&
            edge.toNodeId === executionNode?.id &&
            edge.toPortId === "signals",
        )
      ) {
        nextGraph.edges.push({
          id: makeEdgeId(),
          fromNodeId: node.id,
          fromPortId: "signal",
          toNodeId: executionNode.id,
          toPortId: "signals",
        });
      }
    });
  }

  const hasExecutionProductInput =
    executionNode &&
    nextGraph.edges.some((edge) => edge.toNodeId === executionNode.id && edge.toPortId === "product");

  if (executionNode && !hasExecutionProductInput) {
    if (dataProductSourceNode) {
      nextGraph.edges.push({
        id: makeEdgeId(),
        fromNodeId: dataProductSourceNode.id,
        fromPortId: "product",
        toNodeId: executionNode.id,
        toPortId: "product",
      });
    }
  }

  return nextGraph;
}

const ALIGN_HEADER_HEIGHT = 38;
const ALIGN_FIELD_HEIGHT = 42;
const ALIGN_FIELD_GAP = 8;
const ALIGN_PORT_ROW_HEIGHT = 26;
const ALIGN_STACK_GAP = 44;

function estimateNodeHeight(node: GraphNode, definitionsByType: Map<string, NodeDefinition>) {
  const definition = definitionsByType.get(node.type);
  if (!definition) {
    return 180;
  }

  const inputCount = node.type === "utility.portalIn" ? getPortalInChannels(node.config).length : definition.inputs.length;
  const logicInputCount =
    node.type === "logic.and" || node.type === "logic.or" ? getLogicInputLabels(node.config).length : inputCount;
  const outputCount = node.type === "utility.portalOut" ? getPortalOutChannels(node.config).length : definition.outputs.length;
  const portRows = Math.max(logicInputCount, outputCount, 1);
  const portsHeight = 14 + portRows * ALIGN_PORT_ROW_HEIGHT + 10;
  const fieldsHeight = definition.fields.length
    ? 14 +
      definition.fields.length * ALIGN_FIELD_HEIGHT +
      Math.max(0, definition.fields.length - 1) * ALIGN_FIELD_GAP
    : 0;

  return ALIGN_HEADER_HEIGHT + portsHeight + fieldsHeight;
}

function getContainedGroupNodeIds(
  graph: StrategyGraph,
  group: GraphGroup,
  definitionsByType: Map<string, NodeDefinition>,
  assignedNodeIds = new Set<string>(),
) {
  return graph.nodes
    .filter((node) => {
      if (assignedNodeIds.has(node.id)) {
        return false;
      }

      const height = estimateNodeHeight(node, definitionsByType);
      const left = node.position.x;
      const top = node.position.y;
      const right = left + 250;
      const bottom = top + height;

      return (
        left >= group.position.x &&
        top >= group.position.y &&
        right <= group.position.x + group.size.width &&
        bottom <= group.position.y + group.size.height
      );
    })
    .map((node) => node.id);
}

function layoutNodeSubset(
  nodes: GraphNode[],
  edges: GraphEdge[],
  definitionsByType: Map<string, NodeDefinition>,
  targetCenter?: { x: number; y: number },
) {
  if (nodes.length === 0) {
    return new Map<string, { x: number; y: number }>();
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const currentCenter = nodes.reduce(
    (acc, node) => ({
      x: acc.x + node.position.x,
      y: acc.y + node.position.y,
    }),
    { x: 0, y: 0 },
  );
  currentCenter.x /= nodes.length;
  currentCenter.y /= nodes.length;

  const incomingCount = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();

  for (const node of nodes) {
    incomingCount.set(node.id, 0);
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }

  for (const edge of edges) {
    incomingCount.set(edge.toNodeId, (incomingCount.get(edge.toNodeId) ?? 0) + 1);
    incoming.get(edge.toNodeId)?.push(edge.fromNodeId);
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
  }

  const queue = nodes
    .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
    .map((node) => node.id);
  const levels = new Map<string, number>();

  const processed = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    processed.add(nodeId);
    const level = levels.get(nodeId) ?? 0;

    for (const nextId of outgoing.get(nodeId) ?? []) {
      levels.set(nextId, Math.max(levels.get(nextId) ?? 0, level + 1));
      incomingCount.set(nextId, (incomingCount.get(nextId) ?? 1) - 1);
      if ((incomingCount.get(nextId) ?? 0) === 0) {
        queue.push(nextId);
      }
    }
  }

  for (const node of nodes) {
    levels.set(node.id, levels.get(node.id) ?? 0);
  }

  const unprocessed = nodes
    .filter((node) => !processed.has(node.id))
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  let fallbackLevel = Math.max(0, ...Array.from(levels.values()));

  for (const node of unprocessed) {
    const hasIncoming = edges.some((edge) => edge.toNodeId === node.id);
    const hasOutgoing = edges.some((edge) => edge.fromNodeId === node.id);
    if (!hasIncoming && !hasOutgoing) {
      fallbackLevel += 1;
      levels.set(node.id, fallbackLevel);
      continue;
    }

    const upstreamLevels = edges
      .filter((edge) => edge.toNodeId === node.id)
      .map((edge) => levels.get(edge.fromNodeId) ?? 0);
    const nextLevel = upstreamLevels.length > 0 ? Math.max(...upstreamLevels) + 1 : fallbackLevel + 1;
    fallbackLevel = Math.max(fallbackLevel, nextLevel);
    levels.set(node.id, nextLevel);
  }

  // Pull pure source/helper nodes closer to their consumers so constants and side inputs
  // land beside the node they feed instead of all the way in the far-left source column.
  for (const node of nodes) {
    const upstream = incoming.get(node.id) ?? [];
    const downstream = outgoing.get(node.id) ?? [];

    if (upstream.length > 0 || downstream.length === 0) {
      continue;
    }

    const downstreamLevels = downstream.map((id) => levels.get(id) ?? 0);
    const desiredLevel = Math.max(0, Math.min(...downstreamLevels) - 1);
    levels.set(node.id, desiredLevel);
  }

  const grouped = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const level = levels.get(node.id) ?? 0;
    const bucket = grouped.get(level) ?? [];
    bucket.push(node);
    grouped.set(level, bucket);
  }

  const horizontalSpacing = 360;
  const provisionalPositions: Array<{ id: string; x: number; y: number }> = [];
  const orderedLevels = Array.from(grouped.keys()).sort((a, b) => a - b);
  const levelOrders = new Map<number, string[]>(
    orderedLevels.map((level) => [
      level,
      [...(grouped.get(level) ?? [])]
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
        .map((node) => node.id),
    ]),
  );

  const getOrderIndex = () => {
    const indexMap = new Map<string, number>();
    for (const [, ids] of levelOrders) {
      ids.forEach((id, index) => indexMap.set(id, index));
    }
    return indexMap;
  };

  const sortLevelByNeighbors = (level: number, direction: "incoming" | "outgoing") => {
    const ids = levelOrders.get(level);
    if (!ids || ids.length <= 1) {
      return;
    }

    const currentIndex = getOrderIndex();
    const getNeighbors = direction === "incoming" ? (nodeId: string) => incoming.get(nodeId) ?? [] : (nodeId: string) => outgoing.get(nodeId) ?? [];

    const sorted = [...ids].sort((leftId, rightId) => {
      const leftNeighbors = getNeighbors(leftId);
      const rightNeighbors = getNeighbors(rightId);

      const leftScore =
        leftNeighbors.length > 0
          ? leftNeighbors.reduce((sum, neighborId) => sum + (currentIndex.get(neighborId) ?? 0), 0) / leftNeighbors.length
          : Number.POSITIVE_INFINITY;
      const rightScore =
        rightNeighbors.length > 0
          ? rightNeighbors.reduce((sum, neighborId) => sum + (currentIndex.get(neighborId) ?? 0), 0) / rightNeighbors.length
          : Number.POSITIVE_INFINITY;

      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }

      const leftNode = nodeMap.get(leftId);
      const rightNode = nodeMap.get(rightId);
      return (leftNode?.position.y ?? 0) - (rightNode?.position.y ?? 0);
    });

    levelOrders.set(level, sorted);
  };

  for (let iteration = 0; iteration < 4; iteration += 1) {
    orderedLevels.forEach((level) => sortLevelByNeighbors(level, "incoming"));
    [...orderedLevels].reverse().forEach((level) => sortLevelByNeighbors(level, "outgoing"));
  }

  orderedLevels.forEach((level) => {
    const ids = levelOrders.get(level) ?? [];
    const heights = ids.map((id) => estimateNodeHeight(nodeMap.get(id)!, definitionsByType));
    const totalHeight =
      heights.reduce((sum, height) => sum + height, 0) + Math.max(0, heights.length - 1) * ALIGN_STACK_GAP;
    let cursorY = -totalHeight / 2;

    ids.forEach((id, index) => {
      const height = heights[index];
      provisionalPositions.push({
        id,
        x: level * horizontalSpacing,
        y: cursorY,
      });
      cursorY += height + ALIGN_STACK_GAP;
    });
  });

  const provisionalCenter = provisionalPositions.reduce(
    (acc, node) => ({
      x: acc.x + node.x,
      y: acc.y + node.y,
    }),
    { x: 0, y: 0 },
  );
  provisionalCenter.x /= provisionalPositions.length;
  provisionalCenter.y /= provisionalPositions.length;

  const desiredCenter = targetCenter ?? currentCenter;
  const offsetX = desiredCenter.x - provisionalCenter.x;
  const offsetY = desiredCenter.y - provisionalCenter.y;

  return new Map(
    provisionalPositions.map((entry) => [
      entry.id,
      {
        x: entry.x + offsetX,
        y: entry.y + offsetY,
      },
    ]),
  );
}

interface LayoutRectItem {
  id: string;
  width: number;
  height: number;
  center: { x: number; y: number };
}

interface LayoutRectEdge {
  from: string;
  to: string;
}

function layoutRectItems(items: LayoutRectItem[], edges: LayoutRectEdge[]) {
  if (items.length === 0) {
    return new Map<string, { centerX: number; centerY: number }>();
  }

  const itemMap = new Map(items.map((item) => [item.id, item]));
  const incomingCount = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();

  for (const item of items) {
    incomingCount.set(item.id, 0);
    incoming.set(item.id, []);
    outgoing.set(item.id, []);
  }

  for (const edge of edges) {
    if (!itemMap.has(edge.from) || !itemMap.has(edge.to) || edge.from === edge.to) {
      continue;
    }

    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);
    incoming.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const queue = items
    .filter((item) => (incomingCount.get(item.id) ?? 0) === 0)
    .sort((a, b) => a.center.x - b.center.x || a.center.y - b.center.y)
    .map((item) => item.id);
  const levels = new Map<string, number>();
  const processed = new Set<string>();

  while (queue.length > 0) {
    const itemId = queue.shift()!;
    processed.add(itemId);
    const level = levels.get(itemId) ?? 0;

    for (const nextId of outgoing.get(itemId) ?? []) {
      levels.set(nextId, Math.max(levels.get(nextId) ?? 0, level + 1));
      incomingCount.set(nextId, (incomingCount.get(nextId) ?? 1) - 1);
      if ((incomingCount.get(nextId) ?? 0) === 0) {
        queue.push(nextId);
      }
    }
  }

  for (const item of items) {
    levels.set(item.id, levels.get(item.id) ?? 0);
  }

  const unprocessed = items
    .filter((item) => !processed.has(item.id))
    .sort((a, b) => a.center.x - b.center.x || a.center.y - b.center.y);
  let fallbackLevel = Math.max(0, ...Array.from(levels.values()));

  for (const item of unprocessed) {
    const hasIncoming = edges.some((edge) => edge.to === item.id);
    const hasOutgoing = edges.some((edge) => edge.from === item.id);
    if (!hasIncoming && !hasOutgoing) {
      fallbackLevel += 1;
      levels.set(item.id, fallbackLevel);
      continue;
    }

    const upstreamLevels = edges
      .filter((edge) => edge.to === item.id)
      .map((edge) => levels.get(edge.from) ?? 0);
    const nextLevel = upstreamLevels.length > 0 ? Math.max(...upstreamLevels) + 1 : fallbackLevel + 1;
    fallbackLevel = Math.max(fallbackLevel, nextLevel);
    levels.set(item.id, nextLevel);
  }

  const grouped = new Map<number, LayoutRectItem[]>();
  for (const item of items) {
    const level = levels.get(item.id) ?? 0;
    const bucket = grouped.get(level) ?? [];
    bucket.push(item);
    grouped.set(level, bucket);
  }

  const orderedLevels = Array.from(grouped.keys()).sort((a, b) => a - b);
  const levelOrders = new Map<number, string[]>(
    orderedLevels.map((level) => [
      level,
      [...(grouped.get(level) ?? [])]
        .sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x)
        .map((item) => item.id),
    ]),
  );

  const getOrderIndex = () => {
    const indexMap = new Map<string, number>();
    for (const [, ids] of levelOrders) {
      ids.forEach((id, index) => indexMap.set(id, index));
    }
    return indexMap;
  };

  const sortLevelByNeighbors = (level: number, direction: "incoming" | "outgoing") => {
    const ids = levelOrders.get(level);
    if (!ids || ids.length <= 1) {
      return;
    }

    const currentIndex = getOrderIndex();
    const getNeighbors = direction === "incoming" ? (itemId: string) => incoming.get(itemId) ?? [] : (itemId: string) => outgoing.get(itemId) ?? [];

    const sorted = [...ids].sort((leftId, rightId) => {
      const leftNeighbors = getNeighbors(leftId);
      const rightNeighbors = getNeighbors(rightId);

      const leftScore =
        leftNeighbors.length > 0
          ? leftNeighbors.reduce((sum, neighborId) => sum + (currentIndex.get(neighborId) ?? 0), 0) / leftNeighbors.length
          : Number.POSITIVE_INFINITY;
      const rightScore =
        rightNeighbors.length > 0
          ? rightNeighbors.reduce((sum, neighborId) => sum + (currentIndex.get(neighborId) ?? 0), 0) / rightNeighbors.length
          : Number.POSITIVE_INFINITY;

      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }

      const leftItem = itemMap.get(leftId);
      const rightItem = itemMap.get(rightId);
      return (leftItem?.center.y ?? 0) - (rightItem?.center.y ?? 0);
    });

    levelOrders.set(level, sorted);
  };

  for (let iteration = 0; iteration < 4; iteration += 1) {
    orderedLevels.forEach((level) => sortLevelByNeighbors(level, "incoming"));
    [...orderedLevels].reverse().forEach((level) => sortLevelByNeighbors(level, "outgoing"));
  }

  const horizontalGap = 160;
  const verticalGap = 56;
  const placed = new Map<string, { centerX: number; centerY: number }>();
  let cursorX = 0;

  for (const level of orderedLevels) {
    const ids = levelOrders.get(level) ?? [];
    const itemsAtLevel = ids.map((id) => itemMap.get(id)).filter((item): item is LayoutRectItem => item !== undefined);
    const levelWidth = Math.max(0, ...itemsAtLevel.map((item) => item.width));
    const levelCenterX = cursorX + levelWidth / 2;
    const totalHeight =
      itemsAtLevel.reduce((sum, item) => sum + item.height, 0) + Math.max(0, itemsAtLevel.length - 1) * verticalGap;
    let cursorY = -totalHeight / 2;

    for (const item of itemsAtLevel) {
      const centerY = cursorY + item.height / 2;
      placed.set(item.id, { centerX: levelCenterX, centerY });
      cursorY += item.height + verticalGap;
    }

    cursorX += levelWidth + horizontalGap;
  }

  const currentCenter = items.reduce(
    (acc, item) => ({
      x: acc.x + item.center.x,
      y: acc.y + item.center.y,
    }),
    { x: 0, y: 0 },
  );
  currentCenter.x /= items.length;
  currentCenter.y /= items.length;

  const provisionalCenter = Array.from(placed.values()).reduce(
    (acc, entry) => ({
      x: acc.x + entry.centerX,
      y: acc.y + entry.centerY,
    }),
    { x: 0, y: 0 },
  );
  provisionalCenter.x /= Math.max(1, placed.size);
  provisionalCenter.y /= Math.max(1, placed.size);

  const offsetX = currentCenter.x - provisionalCenter.x;
  const offsetY = currentCenter.y - provisionalCenter.y;

  return new Map(
    Array.from(placed.entries()).map(([id, entry]) => [
      id,
      {
        centerX: entry.centerX + offsetX,
        centerY: entry.centerY + offsetY,
      },
    ]),
  );
}

function autoAlignGraph(graph: StrategyGraph, definitionsByType: Map<string, NodeDefinition>): StrategyGraph {
  if (graph.nodes.length === 0) {
    return graph;
  }

  const nextNodePositions = new Map<string, { x: number; y: number }>();
  const groupNodeIdsByGroupId = new Map<string, string[]>();
  const nodeToGroupId = new Map<string, string>();
  const groupedNodeIds = new Set<string>();

  for (const group of graph.groups) {
    const nodeIds = getContainedGroupNodeIds(graph, group, definitionsByType, groupedNodeIds);
    groupNodeIdsByGroupId.set(group.id, nodeIds);
    for (const nodeId of nodeIds) {
      nodeToGroupId.set(nodeId, group.id);
      groupedNodeIds.add(nodeId);
    }

    if (nodeIds.length === 0) {
      continue;
    }

    const subsetNodes = graph.nodes.filter((node) => nodeIds.includes(node.id));
    const subsetNodeIdSet = new Set(nodeIds);
    const subsetEdges = graph.edges.filter(
      (edge) => subsetNodeIdSet.has(edge.fromNodeId) && subsetNodeIdSet.has(edge.toNodeId),
    );
    const targetCenter = {
      x: group.position.x + group.size.width / 2 - 125,
      y: group.position.y + group.size.height / 2 - 90,
    };
    const layout = layoutNodeSubset(subsetNodes, subsetEdges, definitionsByType, targetCenter);
    layout.forEach((position, nodeId) => {
      nextNodePositions.set(nodeId, position);
    });
  }

  const ungroupedNodes = graph.nodes.filter((node) => !groupedNodeIds.has(node.id));
  if (ungroupedNodes.length > 0) {
    const ungroupedNodeIdSet = new Set(ungroupedNodes.map((node) => node.id));
    const ungroupedEdges = graph.edges.filter(
      (edge) => ungroupedNodeIdSet.has(edge.fromNodeId) && ungroupedNodeIdSet.has(edge.toNodeId),
    );
    const layout = layoutNodeSubset(ungroupedNodes, ungroupedEdges, definitionsByType);
    layout.forEach((position, nodeId) => {
      nextNodePositions.set(nodeId, position);
    });
  }

  const topLevelItems: LayoutRectItem[] = [];
  for (const group of graph.groups) {
    topLevelItems.push({
      id: `group:${group.id}`,
      width: group.size.width,
      height: group.size.height,
      center: {
        x: group.position.x + group.size.width / 2,
        y: group.position.y + group.size.height / 2,
      },
    });
  }

  const topLevelEdges: LayoutRectEdge[] = [];
  const seenTopLevelEdges = new Set<string>();
  for (const edge of graph.edges) {
    const fromGroupId = nodeToGroupId.get(edge.fromNodeId);
    const toGroupId = nodeToGroupId.get(edge.toNodeId);

    if (!fromGroupId || !toGroupId) {
      continue;
    }

    const fromItemId = `group:${fromGroupId}`;
    const toItemId = `group:${toGroupId}`;
    if (fromItemId === toItemId) {
      continue;
    }

    const edgeKey = `${fromItemId}->${toItemId}`;
    if (seenTopLevelEdges.has(edgeKey)) {
      continue;
    }
    seenTopLevelEdges.add(edgeKey);
    topLevelEdges.push({ from: fromItemId, to: toItemId });
  }

  const topLevelLayout = layoutRectItems(topLevelItems, topLevelEdges);

  const looseNodeRects = ungroupedNodes.map((node) => {
    const positioned = nextNodePositions.get(node.id) ?? node.position;
    const height = estimateNodeHeight(node, definitionsByType);
    return {
      left: positioned.x,
      top: positioned.y,
      right: positioned.x + 250,
      bottom: positioned.y + height,
    };
  });

  const overlapsWithPadding = (
    left: { left: number; right: number; top: number; bottom: number },
    right: { left: number; right: number; top: number; bottom: number },
    padding = 56,
  ) =>
    !(
      left.right + padding <= right.left ||
      left.left >= right.right + padding ||
      left.bottom + padding <= right.top ||
      left.top >= right.bottom + padding
    );

  const nextGroupPositions = new Map<string, { x: number; y: number }>();
  const occupiedRects = [...looseNodeRects];
  const orderedGroups = [...graph.groups].sort((left, right) => {
    const leftPlaced = topLevelLayout.get(`group:${left.id}`);
    const rightPlaced = topLevelLayout.get(`group:${right.id}`);
    const leftX = leftPlaced?.centerX ?? left.position.x + left.size.width / 2;
    const rightX = rightPlaced?.centerX ?? right.position.x + right.size.width / 2;
    if (leftX !== rightX) {
      return leftX - rightX;
    }

    const leftY = leftPlaced?.centerY ?? left.position.y + left.size.height / 2;
    const rightY = rightPlaced?.centerY ?? right.position.y + right.size.height / 2;
    return leftY - rightY;
  });

  for (const group of orderedGroups) {
    const itemId = `group:${group.id}`;
    const placed = topLevelLayout.get(itemId);
    let x = placed ? placed.centerX - group.size.width / 2 : group.position.x;
    let y = placed ? placed.centerY - group.size.height / 2 : group.position.y;
    let rect = {
      left: x,
      top: y,
      right: x + group.size.width,
      bottom: y + group.size.height,
    };

    let guard = 0;
    while (occupiedRects.some((occupied) => overlapsWithPadding(rect, occupied)) && guard < 240) {
      y += 56;
      rect = {
        left: x,
        top: y,
        right: x + group.size.width,
        bottom: y + group.size.height,
      };
      guard += 1;
    }

    nextGroupPositions.set(group.id, { x, y });
    occupiedRects.push(rect);
  }

  for (const group of graph.groups) {
    const nodeIds = groupNodeIdsByGroupId.get(group.id) ?? [];
    if (nodeIds.length === 0) {
      continue;
    }

    const nextGroupPosition = nextGroupPositions.get(group.id);
    if (!nextGroupPosition) {
      continue;
    }

    const deltaX = nextGroupPosition.x - group.position.x;
    const deltaY = nextGroupPosition.y - group.position.y;
    for (const nodeId of nodeIds) {
      const positioned = nextNodePositions.get(nodeId);
      if (!positioned) {
        continue;
      }
      nextNodePositions.set(nodeId, {
        x: positioned.x + deltaX,
        y: positioned.y + deltaY,
      });
    }
  }

  return {
    ...graph,
    groups: graph.groups.map((group) => ({
      ...group,
      position: nextGroupPositions.get(group.id) ?? group.position,
    })),
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: nextNodePositions.get(node.id) ?? node.position,
    })),
  };
}

function snapCoordinate(value: number, gridSize = 36) {
  return Math.round(value / gridSize) * gridSize;
}

function toggleSelection(current: string[], nodeId: string) {
  return current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId];
}

function serializeGraph(graph: StrategyGraph) {
  return JSON.stringify(graph);
}

function serializeStrategyDocument(graph: StrategyGraph, camera: GraphCameraState) {
  return JSON.stringify({ graph, camera });
}

function areCamerasEqual(left: GraphCameraState, right: GraphCameraState) {
  return left.x === right.x && left.y === right.y && left.zoom === right.zoom;
}

function createClipboardPayload(graph: StrategyGraph, selectedNodeIds: string[]): ClipboardPayload | null {
  if (selectedNodeIds.length === 0) {
    return null;
  }

  const selectedSet = new Set(selectedNodeIds);
  return {
    nodes: graph.nodes.filter((node) => selectedSet.has(node.id)),
    edges: graph.edges.filter(
      (edge) => selectedSet.has(edge.fromNodeId) && selectedSet.has(edge.toNodeId),
    ),
  };
}

function remapClipboardPayload(payload: ClipboardPayload, offsetIndex: number): ClipboardPayload {
  const idMap = new Map<string, string>();
  const positionOffset = 48 * offsetIndex;

  const nodes = payload.nodes.map((node) => {
    const newId = `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    idMap.set(node.id, newId);
    return {
      ...node,
      id: newId,
      position: {
        x: node.position.x + positionOffset,
        y: node.position.y + positionOffset,
      },
    };
  });

  const edges = payload.edges.map((edge) => ({
    ...edge,
    id: `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    fromNodeId: idMap.get(edge.fromNodeId) ?? edge.fromNodeId,
    toNodeId: idMap.get(edge.toNodeId) ?? edge.toNodeId,
  }));

  return { nodes, edges };
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return (
    target.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

function MiniStrategyPreview({
  graph,
  definitionsByType,
}: {
  graph: StrategyGraph;
  definitionsByType: Map<string, NodeDefinition>;
}) {
  if (graph.nodes.length === 0) {
    return <div className="strategy-preview-empty">Empty strategy</div>;
  }

  const padding = 26;
  const nodeWidth = 78;
  const nodeHeight = 28;
  const positions = graph.nodes.map((node) => node.position);
  const minX = Math.min(...positions.map((position) => position.x));
  const maxX = Math.max(...positions.map((position) => position.x));
  const minY = Math.min(...positions.map((position) => position.y));
  const maxY = Math.max(...positions.map((position) => position.y));
  const width = Math.max(1, maxX - minX + nodeWidth + padding * 2);
  const height = Math.max(1, maxY - minY + nodeHeight + padding * 2);
  const getNodeCenter = (nodeId: string) => {
    const node = graph.nodes.find((entry) => entry.id === nodeId);
    if (!node) {
      return null;
    }

    return {
      x: node.position.x - minX + padding + nodeWidth / 2,
      y: node.position.y - minY + padding + nodeHeight / 2,
    };
  };

  return (
    <svg className="strategy-preview-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <linearGradient id="strategy-preview-bg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(44, 49, 61, 0.96)" />
          <stop offset="100%" stopColor="rgba(26, 29, 36, 0.96)" />
        </linearGradient>
      </defs>

      {graph.edges.map((edge) => {
        const start = getNodeCenter(edge.fromNodeId);
        const end = getNodeCenter(edge.toNodeId);
        if (!start || !end) {
          return null;
        }

        const curve = Math.max(26, Math.abs(end.x - start.x) * 0.38);
        return (
          <path
            key={edge.id}
            d={`M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${end.x - curve} ${end.y}, ${end.x} ${end.y}`}
            className="strategy-preview-edge"
          />
        );
      })}

      {graph.nodes.map((node) => {
        const definition = definitionsByType.get(node.type);
        const x = node.position.x - minX + padding;
        const y = node.position.y - minY + padding;

        return (
          <g key={node.id}>
            <rect x={x} y={y} width={nodeWidth} height={nodeHeight} rx="10" className="strategy-preview-node" />
            <rect
              x={x}
              y={y}
              width={nodeWidth}
              height="8"
              rx="10"
              className="strategy-preview-node-accent"
              style={{ fill: definition?.color ?? "#475569" }}
            />
          </g>
        );
      })}
    </svg>
  );
}

function StrategyCollectionWindow({
  documents,
  definitionsByType,
  onOpen,
  onRename,
  onDelete,
  onClose,
}: {
  documents: StoredGraphDocument[];
  definitionsByType: Map<string, NodeDefinition>;
  onOpen: (name: string) => void;
  onRename: (name: string) => void;
  onDelete: (name: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const filteredDocuments = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return documents;
    }

    return documents.filter((document) => document.name.toLowerCase().includes(needle));
  }, [documents, search]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="strategy-collection-window" onClick={(event) => event.stopPropagation()}>
        <div className="open-dialog-header">
          <div>
            <h2>Strategy Collection</h2>
            <p className="window-subtitle">Browse, rename, and remove saved strategies.</p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="strategy-collection-search">
          <input
            type="text"
            placeholder="Search strategies"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="strategy-collection-grid">
          {documents.length === 0 ? (
            <p className="dialog-empty">No saved strategies yet. Use `Save` or `Save As` first.</p>
          ) : filteredDocuments.length === 0 ? (
            <p className="dialog-empty">No saved strategies matched your search.</p>
          ) : (
            filteredDocuments.map((document) => (
              <article key={document.name} className="strategy-card">
                <button
                  type="button"
                  className="strategy-card-open"
                  onClick={() => onOpen(document.name)}
                >
                  <div className="strategy-card-preview">
                    <MiniStrategyPreview graph={document.graph} definitionsByType={definitionsByType} />
                  </div>
                  <div className="strategy-card-meta">
                    <strong className="strategy-card-title">{document.name}</strong>
                    <span className="strategy-card-date">{new Date(document.updatedAt).toLocaleString()}</span>
                  </div>
                </button>
                <div className="strategy-card-actions">
                  <button type="button" className="strategy-card-button" onClick={() => onRename(document.name)}>
                    Rename
                  </button>
                  <button type="button" className="strategy-card-button is-danger" onClick={() => onDelete(document.name)}>
                    Delete
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function DocumentationWindow({
  topics,
  onClose,
}: {
  topics: DocumentationTopic[];
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [activeTopicId, setActiveTopicId] = useState(topics[0]?.id ?? "");

  const filteredTopics = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return topics;
    }

    return topics.filter((topic) =>
      `${topic.title} ${topic.searchText} ${topic.sections
        .map((section) => `${section.heading} ${(section.paragraphs ?? []).join(" ")} ${(section.bullets ?? []).join(" ")}`)
        .join(" ")}`
        .toLowerCase()
        .includes(needle),
    );
  }, [search, topics]);

  useEffect(() => {
    if (!filteredTopics.some((topic) => topic.id === activeTopicId)) {
      setActiveTopicId(filteredTopics[0]?.id ?? "");
    }
  }, [activeTopicId, filteredTopics]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const activeTopic = filteredTopics.find((topic) => topic.id === activeTopicId) ?? filteredTopics[0] ?? null;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="documentation-window" onClick={(event) => event.stopPropagation()}>
        <div className="nodes-library-header">
          <div>
            <h2>Documentation</h2>
            <p>Learn the workflow, controls, backtest model, and available nodes.</p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="documentation-search">
          <input
            type="text"
            placeholder="Search documentation"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="documentation-body">
          <aside className="documentation-topics">
            {filteredTopics.length === 0 ? (
              <p className="nodes-library-empty">No documentation topics matched your search.</p>
            ) : (
              filteredTopics.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  className={`documentation-topic ${topic.id === activeTopic?.id ? "is-active" : ""}`}
                  onClick={() => setActiveTopicId(topic.id)}
                >
                  {topic.title}
                </button>
              ))
            )}
          </aside>

          <section className="documentation-content">
            {activeTopic ? (
              <article className="documentation-article">
                <header className="documentation-article-header">
                  <h3>{activeTopic.title}</h3>
                </header>
                {activeTopic.sections.map((section) => (
                  <section key={`${activeTopic.id}-${section.heading}`} className="documentation-section">
                    <h4>{section.heading}</h4>
                    {(section.paragraphs ?? []).map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                    {section.bullets?.length ? (
                      <ul>
                        {section.bullets.map((bullet) => (
                          <li key={bullet}>{bullet}</li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                ))}
              </article>
            ) : (
              <p className="nodes-library-empty">No documentation topics matched your search.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function AboutWindow({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="about-window" onClick={(event) => event.stopPropagation()}>
        <div className="open-dialog-header">
          <div>
            <h2>About Trading Engine Studio</h2>
            <p className="window-subtitle">Visual strategy design and backtesting for idea exploration.</p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="about-window-body">
          <section className="about-hero">
            <div className="about-badge">Trading Engine Studio</div>
            <h3>Build, test, and inspect trading strategies in a node-based workspace.</h3>
            <p>
              Trading Engine Studio is a browser-based visual environment for creating strategy graphs from market
              data, indicators, arithmetic, logic, signals, and execution rules. It is designed to make strategy
              iteration feel fast, visual, and inspectable.
            </p>
          </section>

          <section className="about-grid">
            <div className="about-card">
              <h4>Author</h4>
              <p>Patrick Kirk</p>
            </div>
            <div className="about-card">
              <h4>Project Link</h4>
              <p>
                <a
                  href="https://github.com/patrick123900/trading_engine_studio"
                  target="_blank"
                  rel="noreferrer"
                >
                  github.com/patrick123900/trading_engine_studio
                </a>
              </p>
            </div>
            <div className="about-card">
              <h4>Use Case</h4>
              <p>Visual backtesting, signal design, trade execution modeling, and strategy debugging.</p>
            </div>
            <div className="about-card">
              <h4>Runtime Model</h4>
              <p>Client-side execution in the browser with local persistence unless strategies are exported.</p>
            </div>
          </section>

          <section className="about-section">
            <h4>License & Usage</h4>
            <p>
              Free to use for evaluation and personal use. Redistribution, resale, republishing, or copying the
              application or its codebase into another product is not permitted without explicit permission from the
              author.
            </p>
          </section>

          <section className="about-section">
            <h4>What The Tool Covers</h4>
            <ul>
              <li>Node-based strategy construction with grouped graph editing.</li>
              <li>Historical data nodes for equities, crypto, FX, commodities, and sentiment series.</li>
              <li>Backtest execution with configurable fills, sizing, slippage, commissions, and position state outputs.</li>
              <li>Result inspection through charts, metrics, logs, and output-series previews.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function NameDialog({
  title,
  label,
  initialValue,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initialValue: string;
  submitLabel: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="inline-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="open-dialog-header">
          <h2>{title}</h2>
          <button type="button" className="dialog-close" onClick={onClose}>
            ×
          </button>
        </div>

        <form
          className="inline-dialog-body"
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = value.trim();
            if (!normalized) {
              return;
            }
            onSubmit(normalized);
          }}
        >
          <label className="inline-dialog-field">
            <span>{label}</span>
            <input ref={inputRef} type="text" value={value} onChange={(event) => setValue(event.target.value)} />
          </label>
          <div className="inline-dialog-actions">
            <button type="button" className="strategy-card-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="strategy-card-button">
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteDialog({
  name,
  onConfirm,
  onClose,
}: {
  name: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="inline-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="open-dialog-header">
          <h2>Delete Strategy</h2>
          <button type="button" className="dialog-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="inline-dialog-body">
          <p className="inline-dialog-copy">Delete strategy "{name}"? This cannot be undone.</p>
          <div className="inline-dialog-actions">
            <button type="button" className="strategy-card-button" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="strategy-card-button is-danger" onClick={onConfirm}>
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AppInner() {
  const emptyGraph = useMemo(() => createEmptyGraph(), []);
  const emptySnapshot = useMemo(() => serializeGraph(emptyGraph), [emptyGraph]);
  const definitions = defaultNodeRegistry.list();
  const definitionsByType = useMemo(
    () => new Map(definitions.map((definition) => [definition.type, definition])),
    [definitions],
  );
  const documentationTopics = useMemo(() => createDocumentationTopics(definitions), [definitions]);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [graph, setGraph] = useState<StrategyGraph>(emptyGraph);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [pendingConnection, setPendingConnection] = useState<{
    nodeId: string;
    portId: string;
  } | null>(null);
  const [currentDocumentName, setCurrentDocumentName] = useState("Untitled Strategy");
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(emptySnapshot);
  const [storedDocuments, setStoredDocuments] = useState<StoredGraphDocument[]>(() => listStoredGraphs());
  const [isOpenDialogVisible, setIsOpenDialogVisible] = useState(false);
  const [isNodesLibraryOpen, setIsNodesLibraryOpen] = useState(false);
  const [isStrategyCollectionOpen, setIsStrategyCollectionOpen] = useState(false);
  const [isExecutionLogOpen, setIsExecutionLogOpen] = useState(false);
  const [isDocumentationOpen, setIsDocumentationOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [nameDialogState, setNameDialogState] = useState<NameDialogState | null>(null);
  const [deleteDialogState, setDeleteDialogState] = useState<DeleteDialogState | null>(null);
  const [runtimeLogs, setRuntimeLogs] = useState<RuntimeLogEntry[]>([]);
  const [historyState, setHistoryState] = useState<HistoryState>({
    snapshots: [emptySnapshot],
    index: 0,
  });
  const [clipboard, setClipboard] = useState<ClipboardPayload | null>(null);
  const [pasteCount, setPasteCount] = useState(0);
  const viewportCenterRef = useRef({ x: 0, y: 0 });
  const [loadedCameraState, setLoadedCameraState] = useState<GraphCameraState>(DEFAULT_CAMERA);
  const cameraStateRef = useRef<GraphCameraState>(DEFAULT_CAMERA);
  const [isGridSnapEnabled, setIsGridSnapEnabled] = useState<boolean>(() => loadGridSnapPreference());
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [selectedPreviewEdgeIds, setSelectedPreviewEdgeIds] = useState<string[]>([]);
  const [isRunningBacktest, setIsRunningBacktest] = useState(false);
  const [executingNodeId, setExecutingNodeId] = useState<string | null>(null);
  const [errorNodeId, setErrorNodeId] = useState<string | null>(null);
  const isDirty = useMemo(() => JSON.stringify(graph) !== lastSavedSnapshot, [graph, lastSavedSnapshot]);

  useEffect(() => {
    try {
      window.localStorage.setItem(GRID_SNAP_STORAGE_KEY, String(isGridSnapEnabled));
    } catch {
      // Ignore storage failures and keep the in-memory preference.
    }
  }, [isGridSnapEnabled]);

  const commitGraph = (
    updater: StrategyGraph | ((current: StrategyGraph) => StrategyGraph),
    options?: { selection?: string[] },
  ) => {
    const nextGraph = typeof updater === "function" ? updater(graph) : updater;
    const snapshot = serializeGraph(nextGraph);

    setGraph(nextGraph);
    setHistoryState((current) => {
      const truncated = current.snapshots.slice(0, current.index + 1);
      if (truncated[truncated.length - 1] === snapshot) {
        return current;
      }
      return {
        snapshots: [...truncated, snapshot],
        index: truncated.length,
      };
    });
    if (options?.selection) {
      setSelectedNodeIds(options.selection);
    }
  };

  const appendRuntimeLog = (entry: RuntimeLogEntry) => {
    setRuntimeLogs((current) => [entry, ...current].slice(0, 8));
  };

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      appendRuntimeLog(
        makeRuntimeLogEntry(
          "error",
          event.message || "Unknown runtime error",
          event.error?.stack ?? `${event.filename}:${event.lineno}:${event.colno}`,
        ),
      );
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason =
        typeof event.reason === "string"
          ? event.reason
          : event.reason instanceof Error
            ? event.reason.message
            : JSON.stringify(event.reason);

      appendRuntimeLog(
        makeRuntimeLogEntry(
          "promise",
          reason || "Unhandled promise rejection",
          event.reason instanceof Error ? event.reason.stack : undefined,
        ),
      );
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  const refreshStoredDocuments = () => {
    setStoredDocuments(listStoredGraphs());
  };

  const replaceGraph = (nextGraph: StrategyGraph, nextName: string, markAsSaved: boolean, nextCamera?: GraphCameraState) => {
    const normalizedGraph = normalizeGraph(nextGraph);
    const normalizedCamera = nextCamera ?? DEFAULT_CAMERA;
    const snapshot = JSON.stringify(normalizedGraph);
    setGraph(cloneGraph(normalizedGraph));
    setLoadedCameraState(normalizedCamera);
    cameraStateRef.current = normalizedCamera;
    setSelectedNodeIds(normalizedGraph.nodes[0]?.id ? [normalizedGraph.nodes[0].id] : []);
    setPendingConnection(null);
    setCurrentDocumentName(nextName);
    setHistoryState({ snapshots: [snapshot], index: 0 });
    setPasteCount(0);
    setBacktestResult(null);
    setSelectedPreviewEdgeIds([]);
    setExecutingNodeId(null);
    setErrorNodeId(null);
    setIsExecutionLogOpen(false);
    if (markAsSaved) {
      setLastSavedSnapshot(snapshot);
    }
  };

  const saveDocument = (name: string) => {
    const saved = saveStoredGraph(name, graph, cameraStateRef.current);
    setCurrentDocumentName(saved.name);
    setLastSavedSnapshot(JSON.stringify(graph));
    refreshStoredDocuments();
  };

  const openSaveAsDialog = (initialValue: string) => {
    setNameDialogState({
      mode: "saveAs",
      title: "Save Strategy As",
      submitLabel: "Save",
      initialValue,
    });
  };

  const handleNew = () => {
    replaceGraph(createEmptyGraph(), "Untitled Strategy", false);
    setLastSavedSnapshot("");
  };

  const handleOpen = (name: string) => {
    const document = loadStoredGraph(name);
    if (!document) {
      return;
    }

    replaceGraph(document.graph, document.name, true, document.camera);
    setIsOpenDialogVisible(false);
    setIsStrategyCollectionOpen(false);
  };

  const handleRenameStoredDocument = (name: string) => {
    setNameDialogState({
      mode: "rename",
      title: "Rename Strategy",
      submitLabel: "Rename",
      initialValue: name,
      targetName: name,
    });
  };

  const handleDeleteStoredDocument = (name: string) => {
    setDeleteDialogState({ name });
  };

  const handleSave = () => {
    if (currentDocumentName === "Untitled Strategy") {
      openSaveAsDialog(currentDocumentName);
      return;
    }

    saveDocument(currentDocumentName);
  };

  const handleSaveAs = () => {
    const suggestedName = currentDocumentName === "Untitled Strategy" ? "" : currentDocumentName;
    openSaveAsDialog(suggestedName);
  };

  const submitNameDialog = (value: string) => {
    if (!nameDialogState) {
      return;
    }

    if (nameDialogState.mode === "saveAs") {
      saveDocument(value);
      setNameDialogState(null);
      return;
    }

    const targetName = nameDialogState.targetName;
    if (!targetName || value === targetName) {
      setNameDialogState(null);
      return;
    }

    const renamed = renameStoredGraph(targetName, value);
    if (renamed && currentDocumentName === targetName) {
      setCurrentDocumentName(renamed.name);
    }

    refreshStoredDocuments();
    setNameDialogState(null);
  };

  const confirmDeleteStoredDocument = () => {
    if (!deleteDialogState) {
      return;
    }

    const deleted = deleteStoredGraph(deleteDialogState.name);
    if (!deleted) {
      setDeleteDialogState(null);
      return;
    }

    if (currentDocumentName === deleteDialogState.name) {
      setCurrentDocumentName("Untitled Strategy");
      setLastSavedSnapshot("");
    }

    refreshStoredDocuments();
    setDeleteDialogState(null);
  };

  const handleExport = () => {
    const payload = {
      version: 1,
      name: currentDocumentName,
      graph,
      camera: cameraStateRef.current,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = (currentDocumentName || "strategy").replace(/[^a-z0-9-_]+/gi, "_");
    link.href = url;
    link.download = `${safeName}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as
        | { name?: string; graph?: StrategyGraph; camera?: GraphCameraState }
        | StrategyGraph;

      const importedGraph =
        "graph" in parsed && parsed.graph ? parsed.graph : (parsed as StrategyGraph);
      const importedCamera =
        "camera" in parsed && parsed.camera && typeof parsed.camera === "object"
          ? parsed.camera
          : undefined;

      if (!importedGraph || !Array.isArray(importedGraph.nodes) || !Array.isArray(importedGraph.edges)) {
        throw new Error("Imported file does not contain a valid strategy graph.");
      }

      const importedName =
        "name" in parsed && typeof parsed.name === "string" && parsed.name.trim()
          ? parsed.name.trim()
          : file.name.replace(/\.json$/i, "") || "Imported Strategy";

      replaceGraph(importedGraph, importedName, true, importedCamera);
    } catch (error) {
      appendRuntimeLog(
        makeRuntimeLogEntry(
          "error",
          error instanceof Error ? error.message : "Failed to import strategy file.",
          error instanceof Error ? error.stack : undefined,
        ),
      );
    } finally {
      event.target.value = "";
    }
  };

  const updateNodePosition = (nodeId: string, x: number, y: number) => {
    const anchorNode = graph.nodes.find((node) => node.id === nodeId);
    if (!anchorNode) {
      return;
    }

    const nextX = isGridSnapEnabled ? snapCoordinate(x) : x;
    const nextY = isGridSnapEnabled ? snapCoordinate(y) : y;

    const selectedSet = new Set(selectedNodeIds.includes(nodeId) ? selectedNodeIds : [nodeId]);
    const deltaX = nextX - anchorNode.position.x;
    const deltaY = nextY - anchorNode.position.y;

    commitGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        selectedSet.has(node.id)
          ? {
              ...node,
              position: {
                x: node.position.x + deltaX,
                y: node.position.y + deltaY,
              },
            }
          : node,
      ),
    }));
  };

  const addGroupAt = (x: number, y: number) => {
    const newGroup: GraphGroup = {
      id: makeGroupId(),
      title: "Group",
      position: {
        x: isGridSnapEnabled ? snapCoordinate(x) : x,
        y: isGridSnapEnabled ? snapCoordinate(y) : y,
      },
      size: {
        width: 420,
        height: 260,
      },
    };

    commitGraph((current) => ({
      ...current,
      groups: [...current.groups, newGroup],
    }));
  };

  const moveGroup = (groupId: string, x: number, y: number, nodeIds: string[]) => {
    const group = graph.groups.find((entry) => entry.id === groupId);
    if (!group) {
      return;
    }

    const nextX = isGridSnapEnabled ? snapCoordinate(x) : x;
    const nextY = isGridSnapEnabled ? snapCoordinate(y) : y;
    const deltaX = nextX - group.position.x;
    const deltaY = nextY - group.position.y;
    const nodeIdSet = new Set(nodeIds);

    commitGraph((current) => ({
      ...current,
      groups: current.groups.map((entry) =>
        entry.id === groupId
          ? {
              ...entry,
              position: { x: nextX, y: nextY },
            }
          : entry,
      ),
      nodes: current.nodes.map((node) =>
        nodeIdSet.has(node.id)
          ? {
              ...node,
              position: {
                x: node.position.x + deltaX,
                y: node.position.y + deltaY,
              },
            }
          : node,
      ),
    }));
  };

  const resizeGroup = (groupId: string, x: number, y: number, width: number, height: number) => {
    commitGraph((current) => ({
      ...current,
      groups: current.groups.map((entry) =>
        entry.id === groupId
          ? {
              ...entry,
              position: { x, y },
              size: {
                width: Math.max(220, width),
                height: Math.max(140, height),
              },
            }
          : entry,
      ),
    }));
  };

  const renameGroup = (groupId: string, title: string) => {
    commitGraph((current) => ({
      ...current,
      groups: current.groups.map((entry) =>
        entry.id === groupId
          ? {
              ...entry,
              title,
            }
          : entry,
      ),
    }));
  };

  const removeGroup = (groupId: string) => {
    commitGraph((current) => ({
      ...current,
      groups: current.groups.filter((entry) => entry.id !== groupId),
    }));
  };

  const addNodeAt = (definitionType: string, x: number, y: number) => {
    const definition = defaultNodeRegistry.get(definitionType);
    if (!definition) {
      return;
    }

    const newNode = buildNodeFromDefinition(
      definition,
      isGridSnapEnabled ? snapCoordinate(x) : x,
      isGridSnapEnabled ? snapCoordinate(y) : y,
    );
    commitGraph((current) => ({
      ...current,
      nodes: [...current.nodes, newNode],
    }), { selection: [newNode.id] });
  };

  const startConnection = (nodeId: string, portId: string) => {
    setPendingConnection({ nodeId, portId });
  };

  const completeConnection = (toNodeId: string, toPortId: string) => {
    if (!pendingConnection) {
      return;
    }

    if (pendingConnection.nodeId === toNodeId) {
      setPendingConnection(null);
      return;
    }

    commitGraph((current) => {
      const targetNode = current.nodes.find((node) => node.id === toNodeId);
      const targetDefinition = targetNode ? defaultNodeRegistry.get(targetNode.type) : null;
      const targetPort = targetDefinition?.inputs.find((port) => port.id === toPortId);
      const allowMultiple =
        Boolean(targetPort?.allowMultiple) || (targetNode?.type === "output.signal" && toPortId === "signal");

      const nextEdges = current.edges.filter((edge) => {
        if (
          edge.fromNodeId === pendingConnection.nodeId &&
          edge.fromPortId === pendingConnection.portId &&
          edge.toNodeId === toNodeId &&
          edge.toPortId === toPortId
        ) {
          return false;
        }

        if (allowMultiple) {
          return true;
        }

        return !(edge.toNodeId === toNodeId && edge.toPortId === toPortId);
      });

      const newEdge: GraphEdge = {
        id: makeEdgeId(),
        fromNodeId: pendingConnection.nodeId,
        fromPortId: pendingConnection.portId,
        toNodeId,
        toPortId,
      };

      return {
        ...current,
        edges: [...nextEdges, newEdge],
      };
    });

    setPendingConnection(null);
  };

  const removeEdge = (edgeId: string) => {
    setSelectedPreviewEdgeIds((current) => current.filter((id) => id !== edgeId));
    commitGraph((current) => ({
      ...current,
      edges: current.edges.filter((edge) => edge.id !== edgeId),
    }));
  };

  const updateNodeConfig = (nodeId: string, key: string, value: string | number | boolean | string[]) => {
    commitGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              config: {
                ...node.config,
                [key]: value,
              },
            }
          : node,
      ),
    }));
  };

  const addPortalOutChannel = (nodeId: string) => {
    commitGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => {
        if (node.id !== nodeId || node.type !== "utility.portalOut") {
          return node;
        }

        const channels = getPortalOutChannels(node.config);
        const nextChannels = [...channels, `channel-${channels.length + 1}`];

        return {
          ...node,
          config: {
            ...node.config,
            channel: nextChannels[0],
            channels: nextChannels,
          },
        };
      }),
    }));
  };

  const updatePortalOutChannel = (nodeId: string, index: number, value: string) => {
    commitGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => {
        if (node.id !== nodeId || node.type !== "utility.portalOut") {
          return node;
        }

        const channels = getPortalOutChannels(node.config);
        if (index < 0 || index >= channels.length) {
          return node;
        }

        const nextChannels = [...channels];
        nextChannels[index] = value;

        return {
          ...node,
          config: {
            ...node.config,
            channel: nextChannels[0],
            channels: nextChannels,
          },
        };
      }),
    }));
  };

  const removePortalOutChannel = (nodeId: string, index: number) => {
    commitGraph((current) => {
      const node = current.nodes.find((entry) => entry.id === nodeId && entry.type === "utility.portalOut");
      if (!node) {
        return current;
      }

      const channels = getPortalOutChannels(node.config);
      if (index <= 0 || index >= channels.length) {
        return current;
      }

      const nextChannels = channels.filter((_, channelIndex) => channelIndex !== index);
      const removedPortId = getPortalOutOutputId(index);

      return {
        ...current,
        nodes: current.nodes.map((entry) =>
          entry.id === nodeId
            ? {
                ...entry,
                config: {
                  ...entry.config,
                  channel: nextChannels[0],
                  channels: nextChannels,
                },
              }
            : entry,
        ),
        edges: current.edges
          .filter((edge) => !(edge.fromNodeId === nodeId && edge.fromPortId === removedPortId))
          .map((edge) => {
            if (edge.fromNodeId !== nodeId) {
              return edge;
            }

            const outputIndex = getPortalOutOutputIndex(edge.fromPortId);
            if (outputIndex === null || outputIndex <= index) {
              return edge;
            }

            return {
              ...edge,
              fromPortId: getPortalOutOutputId(outputIndex - 1),
            };
          }),
      };
    });
  };

  const addPortalInChannel = (nodeId: string) => {
    commitGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => {
        if (node.id !== nodeId || node.type !== "utility.portalIn") {
          return node;
        }

        const channels = getPortalInChannels(node.config);
        const nextChannels = [...channels, `channel-${channels.length + 1}`];

        return {
          ...node,
          config: {
            ...node.config,
            channel: nextChannels[0],
            channels: nextChannels,
          },
        };
      }),
    }));
  };

  const updatePortalInChannel = (nodeId: string, index: number, value: string) => {
    commitGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => {
        if (node.id !== nodeId || node.type !== "utility.portalIn") {
          return node;
        }

        const channels = getPortalInChannels(node.config);
        if (index < 0 || index >= channels.length) {
          return node;
        }

        const nextChannels = [...channels];
        nextChannels[index] = value;

        return {
          ...node,
          config: {
            ...node.config,
            channel: nextChannels[0],
            channels: nextChannels,
          },
        };
      }),
    }));
  };

  const removePortalInChannel = (nodeId: string, index: number) => {
    commitGraph((current) => {
      const node = current.nodes.find((entry) => entry.id === nodeId && entry.type === "utility.portalIn");
      if (!node) {
        return current;
      }

      const channels = getPortalInChannels(node.config);
      if (index <= 0 || index >= channels.length) {
        return current;
      }

      const nextChannels = channels.filter((_, channelIndex) => channelIndex !== index);
      const removedPortId = getPortalInInputId(index);

      return {
        ...current,
        nodes: current.nodes.map((entry) =>
          entry.id === nodeId
            ? {
                ...entry,
                config: {
                  ...entry.config,
                  channel: nextChannels[0],
                  channels: nextChannels,
                },
              }
            : entry,
        ),
        edges: current.edges
          .filter((edge) => !(edge.toNodeId === nodeId && edge.toPortId === removedPortId))
          .map((edge) => {
            if (edge.toNodeId !== nodeId) {
              return edge;
            }

            const inputIndex = getPortalInInputIndex(edge.toPortId);
            if (inputIndex === null || inputIndex <= index) {
              return edge;
            }

            return {
              ...edge,
              toPortId: getPortalInInputId(inputIndex - 1),
            };
          }),
      };
    });
  };

  const addLogicInput = (nodeId: string) => {
    commitGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => {
        if (node.id !== nodeId || (node.type !== "logic.and" && node.type !== "logic.or")) {
          return node;
        }

        const inputs = getLogicInputLabels(node.config);
        const nextInputs = [...inputs, `Input ${inputs.length + 1}`];

        return {
          ...node,
          config: {
            ...node.config,
            inputs: nextInputs,
          },
        };
      }),
    }));
  };

  const updateLogicInput = (nodeId: string, index: number, value: string) => {
    commitGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => {
        if (node.id !== nodeId || (node.type !== "logic.and" && node.type !== "logic.or")) {
          return node;
        }

        const inputs = getLogicInputLabels(node.config);
        if (index < 0 || index >= inputs.length) {
          return node;
        }

        const nextInputs = [...inputs];
        nextInputs[index] = value;

        return {
          ...node,
          config: {
            ...node.config,
            inputs: nextInputs,
          },
        };
      }),
    }));
  };

  const removeLogicInput = (nodeId: string, index: number) => {
    commitGraph((current) => {
      const node = current.nodes.find(
        (entry) => entry.id === nodeId && (entry.type === "logic.and" || entry.type === "logic.or"),
      );
      if (!node) {
        return current;
      }

      const inputs = getLogicInputLabels(node.config);
      if (index < 2 || index >= inputs.length) {
        return current;
      }

      const nextInputs = inputs.filter((_, inputIndex) => inputIndex !== index);
      const removedPortId = getLogicInputId(index);

      return {
        ...current,
        nodes: current.nodes.map((entry) =>
          entry.id === nodeId
            ? {
                ...entry,
                config: {
                  ...entry.config,
                  inputs: nextInputs,
                },
              }
            : entry,
        ),
        edges: current.edges
          .filter((edge) => !(edge.toNodeId === nodeId && edge.toPortId === removedPortId))
          .map((edge) => {
            if (edge.toNodeId !== nodeId) {
              return edge;
            }

            const inputIndex = getLogicInputIndex(edge.toPortId);
            if (inputIndex === null || inputIndex <= index) {
              return edge;
            }

            return {
              ...edge,
              toPortId: getLogicInputId(inputIndex - 1),
            };
          }),
      };
    });
  };

  const renameNode = (nodeId: string, title: string) => {
    commitGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              title,
            }
          : node,
      ),
    }));
  };

  const removeNode = (nodeId: string) => {
    const nextSelection = selectedNodeIds.filter((id) => id !== nodeId);
    commitGraph((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter((edge) => edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId),
    }), { selection: nextSelection });
    setPendingConnection((current) => (current?.nodeId === nodeId ? null : current));
  };

  const handleUndo = () => {
    if (historyState.index === 0) {
      return;
    }

    const nextIndex = historyState.index - 1;
    const nextGraph = JSON.parse(historyState.snapshots[nextIndex]) as StrategyGraph;
    setHistoryState((current) => ({ ...current, index: nextIndex }));
    setGraph(nextGraph);
    setSelectedNodeIds([]);
    setPendingConnection(null);
  };

  const handleRedo = () => {
    if (historyState.index >= historyState.snapshots.length - 1) {
      return;
    }

    const nextIndex = historyState.index + 1;
    const nextGraph = JSON.parse(historyState.snapshots[nextIndex]) as StrategyGraph;
    setHistoryState((current) => ({ ...current, index: nextIndex }));
    setGraph(nextGraph);
    setSelectedNodeIds([]);
    setPendingConnection(null);
  };

  const handleCopy = () => {
    const payload = createClipboardPayload(graph, selectedNodeIds);
    if (!payload) {
      return;
    }
    setClipboard(payload);
  };

  const handleCut = () => {
    const payload = createClipboardPayload(graph, selectedNodeIds);
    if (!payload) {
      return;
    }

    setClipboard(payload);
    const selectedSet = new Set(selectedNodeIds);
    commitGraph(
      {
        nodes: graph.nodes.filter((node) => !selectedSet.has(node.id)),
        edges: graph.edges.filter(
          (edge) => !selectedSet.has(edge.fromNodeId) && !selectedSet.has(edge.toNodeId),
        ),
        groups: graph.groups,
      },
      { selection: [] },
    );
  };

  const handlePaste = () => {
    if (!clipboard) {
      return;
    }

    const nextPasteCount = pasteCount + 1;
    const remapped = remapClipboardPayload(clipboard, nextPasteCount);
    setPasteCount(nextPasteCount);
    commitGraph(
      (current) => ({
        ...current,
        nodes: [...current.nodes, ...remapped.nodes],
        edges: [...current.edges, ...remapped.edges],
      }),
      { selection: remapped.nodes.map((node) => node.id) },
    );
  };

  const handleDeleteSelected = () => {
    if (selectedNodeIds.length === 0) {
      return;
    }

    const selectedSet = new Set(selectedNodeIds);
    commitGraph(
      {
        nodes: graph.nodes.filter((node) => !selectedSet.has(node.id)),
        edges: graph.edges.filter(
          (edge) => !selectedSet.has(edge.fromNodeId) && !selectedSet.has(edge.toNodeId),
        ),
        groups: graph.groups,
      },
      { selection: [] },
    );
    setPendingConnection(null);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        setIsNodesLibraryOpen(true);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        handleDeleteSelected();
        return;
      }

      if (!modifier) {
        return;
      }

      if (key === "s" && event.shiftKey) {
        event.preventDefault();
        handleSaveAs();
        return;
      }

      if (key === "s") {
        event.preventDefault();
        handleSave();
        return;
      }

      if (key === "n") {
        event.preventDefault();
        handleNew();
        return;
      }

      if (key === "o") {
        event.preventDefault();
        refreshStoredDocuments();
        setIsOpenDialogVisible(true);
        return;
      }

      if (key === "a") {
        event.preventDefault();
        setSelectedNodeIds(graph.nodes.map((node) => node.id));
        return;
      }

      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (key === "z") {
        event.preventDefault();
        handleUndo();
        return;
      }

      if (key === "y") {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (key === "c") {
        event.preventDefault();
        handleCopy();
        return;
      }

      if (key === "x") {
        event.preventDefault();
        handleCut();
        return;
      }

      if (key === "v") {
        event.preventDefault();
        handlePaste();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [graph, selectedNodeIds, clipboard, historyState]);

  const runGraph = () => {
    if (isRunningBacktest) {
      return;
    }

    setIsRunningBacktest(true);
    setExecutingNodeId(null);
    setErrorNodeId(null);

    void runBacktest(graph, {
      onNodeStart: (nodeId) => {
        flushSync(() => {
          setExecutingNodeId(nodeId);
          setErrorNodeId(null);
        });
      },
      onNodeComplete: (nodeId) => {
        flushSync(() => {
          setExecutingNodeId((current) => (current === nodeId ? null : current));
        });
      },
      onNodeError: (nodeId, error) => {
        flushSync(() => {
          setExecutingNodeId(null);
          setErrorNodeId(nodeId);
        });
        appendRuntimeLog(makeRuntimeLogEntry("error", error.message, error.stack));
      },
    })
      .then((result) => {
        setBacktestResult(result);
        setSelectedPreviewEdgeIds((current) =>
          current.filter((edgeId) => Boolean(result.previewSeriesByEdgeId[edgeId])),
        );
        setErrorNodeId(null);
      })
      .catch(() => {})
      .finally(() => {
        setExecutingNodeId(null);
        setIsRunningBacktest(false);
      });
  };

  return (
    <>
      <Canvas
        nodes={graph.nodes}
        edges={graph.edges}
        groups={graph.groups}
        definitions={definitions}
        selectedNodeIds={selectedNodeIds}
        pendingConnection={pendingConnection}
        documentName={currentDocumentName}
        isDirty={isDirty}
        onNew={handleNew}
        onOpen={() => {
          refreshStoredDocuments();
          setIsOpenDialogVisible(true);
        }}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onImport={handleImportClick}
        onExport={handleExport}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        onOpenNodesLibrary={() => setIsNodesLibraryOpen(true)}
        onOpenStrategyCollection={() => {
          refreshStoredDocuments();
          setIsStrategyCollectionOpen(true);
        }}
        onOpenExecutionLog={() => setIsExecutionLogOpen(true)}
        onOpenDocumentation={() => setIsDocumentationOpen(true)}
        onOpenAbout={() => setIsAboutOpen(true)}
        onViewportCenterChange={(center) => {
          viewportCenterRef.current = center;
        }}
        onCameraChange={(nextCamera) => {
          cameraStateRef.current = areCamerasEqual(cameraStateRef.current, nextCamera)
            ? cameraStateRef.current
            : nextCamera;
        }}
        initialCamera={loadedCameraState}
        canUndo={historyState.index > 0}
        canRedo={historyState.index < historyState.snapshots.length - 1}
        canCopy={selectedNodeIds.length > 0}
        canCut={selectedNodeIds.length > 0}
        canPaste={clipboard !== null}
        canOpenExecutionLog={backtestResult !== null}
        isGridSnapEnabled={isGridSnapEnabled}
        onToggleGridSnap={() => setIsGridSnapEnabled((current) => !current)}
        onAutoAlign={() => commitGraph((current) => autoAlignGraph(current, definitionsByType), { selection: selectedNodeIds })}
        onSelectSingleNode={(nodeId) => setSelectedNodeIds(nodeId ? [nodeId] : [])}
        onToggleNodeSelection={(nodeId) => setSelectedNodeIds((current) => toggleSelection(current, nodeId))}
        onSelectNodes={(nodeIds) => setSelectedNodeIds(nodeIds)}
        onSelectPreviewEdge={(edgeId, additive = false) => {
          setSelectedPreviewEdgeIds((current) => {
            if (!edgeId) {
              return [];
            }

            if (!additive) {
              return [edgeId];
            }

            return current.includes(edgeId)
              ? current.filter((id) => id !== edgeId)
              : [...current, edgeId];
          });
        }}
        onMoveNode={updateNodePosition}
        onAddGroup={addGroupAt}
        onMoveGroup={moveGroup}
        onResizeGroup={resizeGroup}
        onRenameGroup={renameGroup}
        onDeleteGroup={removeGroup}
        onAddNode={addNodeAt}
        onStartConnection={startConnection}
        onCompleteConnection={completeConnection}
        onRemoveEdge={removeEdge}
        onClearPendingConnection={() => setPendingConnection(null)}
        onUpdateNodeConfig={updateNodeConfig}
        onAddPortalOutChannel={addPortalOutChannel}
        onUpdatePortalOutChannel={updatePortalOutChannel}
        onRemovePortalOutChannel={removePortalOutChannel}
        onAddPortalInChannel={addPortalInChannel}
        onUpdatePortalInChannel={updatePortalInChannel}
        onRemovePortalInChannel={removePortalInChannel}
        onAddLogicInput={addLogicInput}
        onUpdateLogicInput={updateLogicInput}
        onRemoveLogicInput={removeLogicInput}
        onRenameNode={renameNode}
        onDeleteNode={removeNode}
        onRun={runGraph}
        isRunningBacktest={isRunningBacktest}
        executingNodeId={executingNodeId}
        errorNodeId={errorNodeId}
        backtestResult={backtestResult}
        selectedPreviewEdgeIds={selectedPreviewEdgeIds}
      />

      {isNodesLibraryOpen ? (
        <NodesLibraryWindow
          definitions={definitions}
          onAddNode={(definitionType) =>
            addNodeAt(definitionType, viewportCenterRef.current.x - 120, viewportCenterRef.current.y - 80)
          }
          onAddGroup={() => {
            addGroupAt(viewportCenterRef.current.x - 210, viewportCenterRef.current.y - 130);
            setIsNodesLibraryOpen(false);
          }}
          onClose={() => setIsNodesLibraryOpen(false)}
        />
      ) : null}

      {isStrategyCollectionOpen ? (
        <StrategyCollectionWindow
          documents={storedDocuments}
          definitionsByType={definitionsByType}
          onOpen={handleOpen}
          onRename={handleRenameStoredDocument}
          onDelete={handleDeleteStoredDocument}
          onClose={() => setIsStrategyCollectionOpen(false)}
        />
      ) : null}

      {isExecutionLogOpen && backtestResult ? (
        <div className="dialog-backdrop" onClick={() => setIsExecutionLogOpen(false)}>
          <div className="results-log-window" onClick={(event) => event.stopPropagation()}>
            <div className="open-dialog-header">
              <div>
                <h2>Execution Log</h2>
                <p className="window-subtitle">Full backtest log for the current result.</p>
              </div>
              <button type="button" className="dialog-close" onClick={() => setIsExecutionLogOpen(false)}>
                ×
              </button>
            </div>

            <div className="results-log-window-list">
              {backtestResult.logs.map((log) => (
                <p key={log}>{log}</p>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {isDocumentationOpen ? (
        <DocumentationWindow topics={documentationTopics} onClose={() => setIsDocumentationOpen(false)} />
      ) : null}

      {isAboutOpen ? <AboutWindow onClose={() => setIsAboutOpen(false)} /> : null}

      {nameDialogState ? (
        <NameDialog
          title={nameDialogState.title}
          label="Strategy name"
          initialValue={nameDialogState.initialValue}
          submitLabel={nameDialogState.submitLabel}
          onSubmit={submitNameDialog}
          onClose={() => setNameDialogState(null)}
        />
      ) : null}

      {deleteDialogState ? (
        <DeleteDialog
          name={deleteDialogState.name}
          onConfirm={confirmDeleteStoredDocument}
          onClose={() => setDeleteDialogState(null)}
        />
      ) : null}

      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={handleImportFile}
      />

      {runtimeLogs.length > 0 ? (
        <div className="error-logger">
          <div className="error-logger-header">
            <strong>Runtime Errors</strong>
            <button type="button" className="error-logger-clear" onClick={() => setRuntimeLogs([])}>
              Clear
            </button>
          </div>
          <div className="error-logger-list">
            {runtimeLogs.map((entry) => (
              <article key={entry.id} className="error-logger-item">
                <div className="error-logger-source">{entry.source}</div>
                <div className="error-logger-message">{entry.message}</div>
                {entry.details ? <pre className="error-logger-details">{entry.details}</pre> : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {isOpenDialogVisible ? (
        <div className="dialog-backdrop" onClick={() => setIsOpenDialogVisible(false)}>
          <div className="open-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="open-dialog-header">
              <h2>Open Strategy</h2>
              <button type="button" className="dialog-close" onClick={() => setIsOpenDialogVisible(false)}>
                ×
              </button>
            </div>
            <div className="open-dialog-list">
              {storedDocuments.length === 0 ? (
                <p className="dialog-empty">No saved strategies yet. Use `Save` or `Save As` first.</p>
              ) : (
                storedDocuments.map((document) => (
                  <button
                    key={document.name}
                    type="button"
                    className="open-dialog-item"
                    onClick={() => handleOpen(document.name)}
                  >
                    <strong>{document.name}</strong>
                    <span>{new Date(document.updatedAt).toLocaleString()}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function NodesLibraryWindow({
  definitions,
  onAddNode,
  onAddGroup,
  onClose,
}: {
  definitions: NodeDefinition[];
  onAddNode: (definitionType: string) => void;
  onAddGroup: () => void;
  onClose: () => void;
}) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [search, setSearch] = useState("");
  const grouped = useMemo(() => {
    return definitions.reduce<Record<string, NodeDefinition[]>>((acc, definition) => {
      acc[definition.category] ??= [];
      acc[definition.category].push(definition);
      return acc;
    }, {});
  }, [definitions]);

  const categories = useMemo(() => Object.keys(grouped), [grouped]);
  const [activeCategory, setActiveCategory] = useState<string>(categories[0] ?? "");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    if (!categories.includes(activeCategory)) {
      setActiveCategory(categories[0] ?? "");
    }
  }, [categories, activeCategory]);

  useEffect(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  const filteredNodes = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const base = needle ? definitions : activeCategory ? grouped[activeCategory] ?? [] : definitions;
    if (!needle) {
      return base;
    }

    return base.filter((definition) => {
      const haystack = `${definition.title} ${definition.description} ${definition.type}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [activeCategory, definitions, grouped, search]);

  const showGroupItem = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle) {
      return "group".includes(needle);
    }
    return activeCategory === "Utility";
  }, [search, activeCategory]);

  const totalItemCount = filteredNodes.length + (showGroupItem ? 1 : 0);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [activeCategory, search]);

  useEffect(() => {
    if (totalItemCount === 0) {
      setHighlightedIndex(0);
      return;
    }

    if (highlightedIndex > totalItemCount - 1) {
      setHighlightedIndex(totalItemCount - 1);
    }
  }, [totalItemCount, highlightedIndex]);

  useEffect(() => {
    const item = itemRefs.current[highlightedIndex];
    if (!listRef.current || !item) {
      return;
    }

    item.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  }, [highlightedIndex]);

  const addDefinitionAndClose = (definitionType: string) => {
    onAddNode(definitionType);
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="nodes-library-window" onClick={(event) => event.stopPropagation()}>
        <div className="nodes-library-header">
          <div>
            <h2>Nodes Library</h2>
            <p>Browse node categories and search available building blocks.</p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="nodes-library-search">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search nodes"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }

              if (totalItemCount === 0) {
                return;
              }

              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlightedIndex((current) => (current + 1) % totalItemCount);
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlightedIndex((current) => (current - 1 + totalItemCount) % totalItemCount);
                return;
              }

              if (event.key === "Enter") {
                event.preventDefault();
                if (showGroupItem && highlightedIndex === 0) {
                  onAddGroup();
                  onClose();
                } else {
                  const definition = filteredNodes[highlightedIndex - (showGroupItem ? 1 : 0)];
                  if (definition) {
                    addDefinitionAndClose(definition.type);
                  }
                }
              }
            }}
          />
        </div>

        <div className="nodes-library-body">
          <aside className="nodes-library-categories">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={`nodes-library-category ${category === activeCategory ? "is-active" : ""}`}
                onClick={() => setActiveCategory(category)}
              >
                {category}
              </button>
            ))}
          </aside>

          <section ref={listRef} className="nodes-library-list">
            {totalItemCount === 0 ? (
              <p className="nodes-library-empty">No nodes matched your search.</p>
            ) : (
              <>
                {showGroupItem ? (
                  <button
                    key="__group__"
                    ref={(element) => { itemRefs.current[0] = element; }}
                    type="button"
                    className={`nodes-library-card ${highlightedIndex === 0 ? "is-highlighted" : ""}`}
                    onMouseEnter={() => setHighlightedIndex(0)}
                    onClick={() => { onAddGroup(); onClose(); }}
                  >
                    <div className="nodes-library-card-top">
                      <span className="nodes-library-color" style={{ background: "#6b7280" }} />
                      <strong>Group</strong>
                    </div>
                    <p>Create a group container to organise nodes on the canvas.</p>
                    <small>utility.group</small>
                  </button>
                ) : null}
                {filteredNodes.map((definition, index) => {
                  const itemIndex = index + (showGroupItem ? 1 : 0);
                  return (
                    <button
                      key={definition.type}
                      ref={(element) => { itemRefs.current[itemIndex] = element; }}
                      type="button"
                      className={`nodes-library-card ${itemIndex === highlightedIndex ? "is-highlighted" : ""}`}
                      onMouseEnter={() => setHighlightedIndex(itemIndex)}
                      onClick={() => addDefinitionAndClose(definition.type)}
                    >
                      <div className="nodes-library-card-top">
                        <span className="nodes-library-color" style={{ background: definition.color }} />
                        <strong>{definition.title}</strong>
                      </div>
                      <p>{definition.description}</p>
                      <small>{definition.type}</small>
                    </button>
                  );
                })}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [boundaryLogs, setBoundaryLogs] = useState<RuntimeLogEntry[]>([]);

  const handleBoundaryError = (entry: RuntimeLogEntry) => {
    setBoundaryLogs((current) => [entry, ...current].slice(0, 8));
  };

  return (
    <RuntimeErrorBoundary onError={handleBoundaryError}>
      <AppInner />
      {boundaryLogs.length > 0 ? (
        <div className="error-logger is-boundary">
          <div className="error-logger-header">
            <strong>React Errors</strong>
          </div>
          <div className="error-logger-list">
            {boundaryLogs.map((entry) => (
              <article key={entry.id} className="error-logger-item">
                <div className="error-logger-source">{entry.source}</div>
                <div className="error-logger-message">{entry.message}</div>
                {entry.details ? <pre className="error-logger-details">{entry.details}</pre> : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </RuntimeErrorBoundary>
  );
}
