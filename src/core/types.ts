export type NodeCategory = string;
export type PortKind = "dataset" | "series" | "number" | "boolean" | "signal" | "product" | "any";
export type InputControlType = "text" | "number" | "select" | "symbol" | "checkbox";

export interface PortDefinition {
  id: string;
  label: string;
  kind: PortKind;
  allowMultiple?: boolean;
}

export interface NodeFieldOption {
  label: string;
  value: string;
}

export interface NodeFieldDefinition {
  key: string;
  label: string;
  type: InputControlType;
  defaultValue: string | number | boolean;
  helpText?: string;
  options?: NodeFieldOption[];
}

export interface NodeDefinition {
  type: string;
  title: string;
  category: NodeCategory;
  description: string;
  color: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  fields: NodeFieldDefinition[];
}

export interface GraphNode {
  id: string;
  type: string;
  title: string;
  position: {
    x: number;
    y: number;
  };
  config: Record<string, string | number | boolean | string[]>;
}

export interface GraphEdge {
  id: string;
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
}

export interface GraphGroup {
  id: string;
  title: string;
  position: {
    x: number;
    y: number;
  };
  size: {
    width: number;
    height: number;
  };
}

export interface StrategyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups: GraphGroup[];
}

export interface GraphCameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface ExecutionContext {
  graph: StrategyGraph;
  node: GraphNode;
  inputs: Record<string, unknown>;
}

export interface NodeExecutor {
  type: string;
  run: (context: ExecutionContext) => Promise<unknown> | unknown;
}

export interface NodeModule {
  definition: Omit<NodeDefinition, "category"> & { category?: NodeCategory };
  executor?: NodeExecutor;
}

export interface EquityPoint {
  timestamp: string;
  equity: number;
}

export interface CandlePoint {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TradeMarker {
  timestamp: string;
  price: number;
  event: "entry" | "exit";
  direction: "long" | "short";
}

export interface TradeSummary {
  totalTrades: number;
  winRate: number;
  netProfit: number;
  maxDrawdown: number;
  endingEquity: number;
  strategyReturn: number;
  buyHoldReturn: number;
  sharpeRatio: number;
}

export interface SeriesPreview {
  edgeId: string;
  sourceNodeId: string;
  sourceNodeTitle: string;
  sourcePortId: string;
  sourcePortLabel: string;
  values: number[];
  timestamps: string[];
}

export interface BacktestResult {
  graphName: string;
  summary: TradeSummary;
  equityCurve: EquityPoint[];
  buyHoldCurve: EquityPoint[];
  priceSeries: CandlePoint[];
  tradeMarkers: TradeMarker[];
  previewSeriesByEdgeId: Record<string, SeriesPreview>;
  logs: string[];
}
