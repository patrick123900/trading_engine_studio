# Trading Engine Studio

Trading Engine Studio is a browser-based visual editor for building and backtesting trading strategies with nodes.

You create a graph of data, indicator, arithmetic, logic, signal, execution, and utility nodes, then run the graph to simulate positions, inspect results, and explore output series directly inside the editor.

## Features

- Node-based strategy editor with drag-and-drop connections
- Infinite-style canvas with panning, zooming, grid, snapping, groups, and auto-align
- In-app node library, strategy collection, documentation, about page, and execution log
- Historical data nodes for:
  - equities via `YFinance Fetcher`
  - crypto via `Crypto Market Data`
  - ECB FX reference rates
  - EIA energy series
  - World Bank commodity series
  - crypto sentiment via `Crypto Fear & Greed`
- Strategy building nodes for:
  - indicators like `RSI` and `Moving Average`
  - arithmetic like `Add`, `Subtract`, `Multiply`, `Divide`, `Min`, `Max`, `Abs`, `Offset`, `Normalize Pair`
  - logic like `Comparison`, `Crosses Above`, `Crosses Below`, `AND`, `OR`, `NOT`
  - signals and execution modeling
  - portal routing utilities
- Backtest execution with:
  - long and short signals
  - close signals
  - reverse-position behavior
  - slippage and commission
  - configurable fill anchors
  - starting capital and dynamic position sizing
- Results pane with:
  - normalized charting
  - key metrics
  - Sharpe ratio
  - CSV export
  - output-series inspection after a run

## What It Runs On

Right now the application runs client-side in the browser.

That means:

- graph editing is client-side
- backtest execution is client-side
- strategy saves are browser-local unless exported
- there is currently no required backend or database for normal use

## Persistence

Trading Engine Studio currently stores strategies in the browser on the machine and browser profile where you save them.

If you want to move strategies between machines or browsers, use:

- `File -> Export`
- `File -> Import`

The editor also remembers some session preferences in browser storage, such as grid snapping.

## Stack

- React 18
- TypeScript
- Vite
- Heroicons
- Nginx for static deployment

## Project Structure

```text
src/
  components/       UI components such as the canvas and results panel
  core/
    engine/         Backtest runner and execution logic
    nodes/          Registry and shared node-loading helpers
    storage/        Browser persistence helpers
    types.ts        Shared graph, result, and node contracts
  data/             Bundled datasets used by some nodes
  nodes/            Node modules grouped by category
    Arithmetic/
    Data/
    Indicator/
    Logic/
    Output/
    Trading/
    Utility/
  styles/           App styling
```

## Local Development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Docker Deployment

The repo already includes:

- `Dockerfile`
- `docker-compose.yml`
- `nginx.conf`

Build and run with Docker Compose:

```bash
docker compose up -d --build
```

By default the app is served on:

```text
http://<host>:8080
```

The container is a static deployment:

1. build the Vite app
2. serve `dist/` with Nginx

## How Strategies Are Modeled

At a high level, a strategy usually looks like this:

1. Fetch market data with a data node
2. Derive numeric series with indicators, arithmetic, or OHLC extraction
3. Convert logic into trade intent with one or more `Signal` nodes
4. Feed `Product` plus signals into `Trade Execution`
5. Run the graph and inspect chart, metrics, logs, and output previews

Example flow:

```text
YFinance Fetcher
  -> RSI
  -> Comparison
  -> Signal
  -> Trade Execution
```

## Current Scope and Limitations

- The app is primarily a visual strategy-design and backtesting tool
- Some nodes use live public APIs, others use bundled historical datasets
- Saved strategies are not synced across browsers or machines
- The JavaScript bundle is currently large because of the growing feature set and bundled datasets
- There is no server-side job system yet for backtests or data refresh pipelines

## Documentation Inside the App

The editor includes a built-in manual under:

```text
Help -> Documentation
```

It covers:

- editor controls
- menus and windows
- signals and trade execution
- result interpretation
- node parameters and outputs
- data-node granularity and output formats

## Author

Patrick Kirk

GitHub:

https://github.com/patrick123900/trading_engine_studio
