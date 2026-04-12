import type { NodeModule } from "../../core/types";
import commodityHistory from "../../data/worldBankCommodityMonthly.json";

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" ? value : fallback;
}

const WORLD_BANK_COMMODITIES = {
  crudeOilAverage: "Crude oil, average",
  crudeOilBrent: "Crude oil, Brent",
  crudeOilWTI: "Crude oil, WTI",
  naturalGasUS: "Natural gas, US",
  naturalGasEurope: "Natural gas, Europe",
  coalAustralian: "Coal, Australian",
  aluminum: "Aluminum",
  copper: "Copper",
  nickel: "Nickel",
  zinc: "Zinc",
  ironOre: "Iron ore, cfr spot",
  gold: "Gold",
  silver: "Silver",
  platinum: "Platinum",
  wheatSrw: "Wheat, US SRW",
  wheatHrw: "Wheat, US HRW",
  maize: "Maize",
  soybean: "Soybeans",
  palmOil: "Palm oil",
  cocoa: "Cocoa",
  coffeeArabica: "Coffee, Arabica",
  cotton: "Cotton, A Index",
} as const;

type CommodityHistoryRecord = {
  label: string;
  timestamps: string[];
  values: number[];
};

const commodityHistoryMap = commodityHistory as Record<string, CommodityHistoryRecord>;

const worldBankCommodityNode: NodeModule = {
  definition: {
    type: "data.worldBankCommodity",
    title: "World Bank Commodity",
    description: "Fetch historical monthly commodity prices from the World Bank Pink Sheet.",
    color: "#2f855a",
    inputs: [],
    outputs: [{ id: "series", label: "Series", kind: "series" }],
    fields: [
      {
        key: "commodity",
        label: "Commodity",
        type: "select",
        defaultValue: "gold",
        options: Object.entries(WORLD_BANK_COMMODITIES).map(([value, label]) => ({ value, label })),
      },
      { key: "lookback", label: "Lookback Bars", type: "number", defaultValue: 120 },
    ],
  },
  executor: {
    type: "data.worldBankCommodity",
    run: async ({ node }) => {
      const commodityKey = String(node.config.commodity ?? "gold") as keyof typeof WORLD_BANK_COMMODITIES;
      const commodityLabel = WORLD_BANK_COMMODITIES[commodityKey] ?? WORLD_BANK_COMMODITIES.gold;
      const lookback = Math.max(12, Math.floor(readNumber(node.config.lookback, 120)));

      const history = commodityHistoryMap[commodityKey];
      if (!history || history.label !== commodityLabel) {
        throw new Error(`World Bank Commodity could not find "${commodityLabel}" in bundled history.`);
      }

      const timestamps = history.timestamps.slice(-lookback);
      const values = history.values.slice(-lookback);

      if (timestamps.length === 0 || values.length === 0) {
        throw new Error(`World Bank Commodity returned no usable data for "${commodityLabel}".`);
      }

      return {
        values,
        timestamps,
      };
    },
  },
};

export default worldBankCommodityNode;
