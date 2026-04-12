import type { NodeModule } from "../../core/types";
import eiaBulkSeries from "../../data/eiaBulkSeries.json";

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" ? value : fallback;
}

const EIA_PRESETS = {
  brentDaily: {
    label: "Brent Spot Price (Daily)",
  },
  brentWeekly: {
    label: "Brent Spot Price (Weekly)",
  },
  brentMonthly: {
    label: "Brent Spot Price (Monthly)",
  },
  wtiDaily: {
    label: "WTI Spot Price (Daily)",
  },
  wtiWeekly: {
    label: "WTI Spot Price (Weekly)",
  },
  wtiMonthly: {
    label: "WTI Spot Price (Monthly)",
  },
  henryHubDaily: {
    label: "Henry Hub Natural Gas (Daily)",
  },
  henryHubWeekly: {
    label: "Henry Hub Natural Gas (Weekly)",
  },
  henryHubMonthly: {
    label: "Henry Hub Natural Gas (Monthly)",
  },
} as const;

type EiaPresetKey = keyof typeof EIA_PRESETS;

type EiaHistoryRecord = {
  label: string;
  timestamps: string[];
  values: number[];
};

const eiaBulkSeriesMap = eiaBulkSeries as Record<string, EiaHistoryRecord>;

const eiaBulkNode: NodeModule = {
  definition: {
    type: "data.eiaBulk",
    title: "EIA Bulk Energy",
    description: "Fetch historical energy price series from bundled EIA bulk open data.",
    color: "#2f855a",
    inputs: [],
    outputs: [{ id: "series", label: "Series", kind: "series" }],
    fields: [
      {
        key: "preset",
        label: "Series",
        type: "select",
        defaultValue: "brentDaily",
        options: Object.entries(EIA_PRESETS).map(([value, preset]) => ({
          label: preset.label,
          value,
        })),
      },
      { key: "lookback", label: "Lookback Bars", type: "number", defaultValue: 500 },
    ],
  },
  executor: {
    type: "data.eiaBulk",
    run: ({ node }) => {
      const presetKey = String(node.config.preset ?? "brentDaily") as EiaPresetKey;
      const preset = EIA_PRESETS[presetKey] ?? EIA_PRESETS.brentDaily;
      const lookback = Math.max(10, Math.floor(readNumber(node.config.lookback, 500)));

      const history = eiaBulkSeriesMap[presetKey];
      if (!history || history.label !== preset.label) {
        throw new Error(`EIA Bulk Energy could not find "${preset.label}" in bundled history.`);
      }

      const timestamps = history.timestamps.slice(-lookback);
      const values = history.values.slice(-lookback);

      if (timestamps.length === 0 || values.length === 0) {
        throw new Error(`EIA Bulk Energy returned no usable data for ${preset.label}.`);
      }

      return {
        values,
        timestamps,
      };
    },
  },
};

export default eiaBulkNode;
