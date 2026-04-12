import type { NodeModule } from "../../core/types";

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" ? value : fallback;
}

function normalizeCurrency(value: unknown, fallback: string) {
  return String(value ?? fallback)
    .trim()
    .toUpperCase();
}

function isValidCurrency(code: string) {
  return /^[A-Z]{3}$/.test(code);
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

type EcbResponse = {
  dataSets?: Array<{
    series?: Record<
      string,
      {
        observations?: Record<string, [number, ...unknown[]]>;
      }
    >;
  }>;
  structure?: {
    dimensions?: {
      observation?: Array<{
        id?: string;
        values?: Array<{
          id?: string;
        }>;
      }>;
    };
  };
};

function extractTimePeriods(payload: EcbResponse) {
  return (
    payload.structure?.dimensions?.observation?.find((dimension) => dimension.id === "TIME_PERIOD")
      ?.values ?? []
  )
    .map((entry) => entry.id)
    .filter((entry): entry is string => typeof entry === "string");
}

const ecbFxNode: NodeModule = {
  definition: {
    type: "data.ecbFx",
    title: "ECB FX Fetcher",
    description: "Fetch historical daily FX reference data from the ECB.",
    color: "#2f855a",
    inputs: [],
    outputs: [
      { id: "dataset", label: "Dataset", kind: "dataset" },
      { id: "product", label: "Product", kind: "product" },
    ],
    fields: [
      { key: "base", label: "Base Currency", type: "text", defaultValue: "EUR" },
      { key: "quote", label: "Quote Currency", type: "text", defaultValue: "USD" },
      { key: "lookback", label: "Lookback Bars", type: "number", defaultValue: 120 },
    ],
  },
  executor: {
    type: "data.ecbFx",
    run: async ({ node }) => {
      const base = normalizeCurrency(node.config.base, "EUR");
      const quote = normalizeCurrency(node.config.quote, "USD");
      const lookback = Math.max(5, Math.floor(readNumber(node.config.lookback, 120)));

      if (!isValidCurrency(base) || !isValidCurrency(quote)) {
        throw new Error("ECB FX Fetcher requires 3-letter ISO currency codes.");
      }

      if (base === quote) {
        const timestamps = Array.from({ length: lookback }, (_, index) => {
          const date = new Date();
          date.setUTCDate(date.getUTCDate() - (lookback - index - 1));
          return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
        });
        const ones = timestamps.map(() => 1);
        const symbol = `${base}/${quote}`;
        return {
          dataset: {
            symbol,
            interval: "1d",
            bars: lookback,
            timestamps,
            open: ones,
            high: ones,
            low: ones,
            close: ones,
          },
          product: {
            symbol,
            assetType: "forex",
            marketData: {
              symbol,
              interval: "1d",
              timestamps,
              open: ones,
              high: ones,
              low: ones,
              close: ones,
            },
          },
        };
      }

      const endDate = new Date();
      const startDate = new Date(endDate);
      startDate.setUTCDate(startDate.getUTCDate() - Math.max(lookback * 2, 30));

      const url = new URL(`https://data-api.ecb.europa.eu/service/data/EXR/D.${quote}.${base}.SP00.A`);
      url.searchParams.set("startPeriod", formatDate(startDate));
      url.searchParams.set("endPeriod", formatDate(endDate));
      url.searchParams.set("format", "jsondata");

      let payload: EcbResponse;

      try {
        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        payload = (await response.json()) as EcbResponse;
      } catch (error) {
        throw new Error(
          `ECB FX Fetcher failed to fetch ${base}/${quote}: ${error instanceof Error ? error.message : "Unknown error."}`,
        );
      }

      const timePeriods = extractTimePeriods(payload);
      const seriesEntry = payload.dataSets?.[0]?.series
        ? Object.values(payload.dataSets[0].series)[0]
        : undefined;
      const observations = seriesEntry?.observations ?? {};

      const rows = Object.entries(observations)
        .map(([index, observation]) => {
          const timeIndex = Number(index);
          const close = Number(observation?.[0]);
          const timestamp = timePeriods[timeIndex];
          if (!Number.isFinite(close) || !timestamp) {
            return null;
          }
          return {
            timestamp: new Date(`${timestamp}T00:00:00Z`).toISOString(),
            close: Number(close.toFixed(6)),
          };
        })
        .filter((entry): entry is { timestamp: string; close: number } => entry !== null)
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
        .slice(-lookback);

      if (rows.length === 0) {
        throw new Error(`ECB FX Fetcher returned no data for ${base}/${quote}.`);
      }

      const timestamps = rows.map((row) => row.timestamp);
      const close = rows.map((row) => row.close);
      const symbol = `${base}/${quote}`;

      return {
        dataset: {
          symbol,
          interval: "1d",
          bars: rows.length,
          timestamps,
          open: close,
          high: close,
          low: close,
          close,
        },
        product: {
          symbol,
          assetType: "forex",
          marketData: {
            symbol,
            interval: "1d",
            timestamps,
            open: close,
            high: close,
            low: close,
            close,
          },
        },
      };
    },
  },
};

export default ecbFxNode;
