# Trading Engine Studio

First-pass scaffold for a visual scripting webapp used to build and backtest trading strategies with modular nodes.

## What is included

- A React + TypeScript frontend shell for a node-based editor.
- Shared graph and node contracts in `src/core/types.ts`.
- A registry-driven node system in `src/core/nodes`.
- A mock backtest runner and executor registry in `src/core/engine`.
- Example starter nodes:
  - `YFinance Fetcher`
  - `RSI`
  - `Fixed Value`
  - `Comparison`
  - `Entry Signal`

## Architecture direction

- `NodeDefinition` describes how a node appears in the UI and how it connects to other nodes.
- `NodeRegistry` makes custom nodes pluggable without hard-coding editor logic.
- `ExecutorRegistry` gives each node type a backend execution hook, separate from UI metadata.
- `StrategyGraph` stores the serialized graph independently of rendering.
- `runBacktest` is currently mocked, but it already establishes the execution boundary where real node executors can be introduced.

## Next steps

1. Add persistent graph editing: create, move, connect, and configure nodes.
2. Introduce a real backend API for data retrieval and backtest jobs.
3. Split node definitions from node executors so nodes can be versioned and loaded dynamically.
4. Add dedicated output nodes for entries, exits, risk sizing, and performance metrics.

## Local development

```bash
npm install
npm run dev
```
