import type { StrategyGraph } from "../core/types";

export const mockGraph: StrategyGraph = {
  nodes: [
    {
      id: "node-1",
      type: "data.yfinance",
      title: "YFinance Fetcher",
      position: { x: 80, y: 80 },
      config: { symbol: "AAPL", interval: "1d", lookback: 250 },
    },
    {
      id: "node-2",
      type: "indicator.rsi",
      title: "RSI",
      position: { x: 360, y: 80 },
      config: { period: 14 },
    },
    {
      id: "node-3",
      type: "logic.fixedValue",
      title: "Fixed Value",
      position: { x: 360, y: 300 },
      config: { value: 30 },
    },
    {
      id: "node-4",
      type: "logic.comparison",
      title: "Comparison",
      position: { x: 650, y: 180 },
      config: { operator: "lt" },
    },
    {
      id: "node-5",
      type: "output.signal",
      title: "Signal",
      position: { x: 930, y: 180 },
      config: { side: "long" },
    },
    {
      id: "node-6",
      type: "trading.execution",
      title: "Trade Execution",
      position: { x: 1210, y: 180 },
      config: {},
    },
  ],
  edges: [
    { id: "edge-0", fromNodeId: "node-1", fromPortId: "dataset", toNodeId: "node-2", toPortId: "dataset" },
    { id: "edge-1", fromNodeId: "node-2", fromPortId: "series", toNodeId: "node-4", toPortId: "left" },
    { id: "edge-2", fromNodeId: "node-3", fromPortId: "value", toNodeId: "node-4", toPortId: "right" },
    { id: "edge-3", fromNodeId: "node-4", fromPortId: "result", toNodeId: "node-5", toPortId: "signal" },
    { id: "edge-4", fromNodeId: "node-1", fromPortId: "product", toNodeId: "node-6", toPortId: "product" },
    { id: "edge-5", fromNodeId: "node-5", fromPortId: "signal", toNodeId: "node-6", toPortId: "signals" },
  ],
};
