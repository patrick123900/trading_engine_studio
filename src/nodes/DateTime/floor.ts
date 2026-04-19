import type { NodeModule } from "../../core/types";
import { MS_PER_DAY, outputScalarOrSeries, toNumericSeries, type TimezoneMode } from "./shared";

type FloorUnit = "minute" | "hour" | "day" | "week" | "month" | "year";

function floorEpochMs(epochMs: number, unit: FloorUnit, timezone: TimezoneMode, weekStartsOn: number) {
  const date = new Date(epochMs);

  if (timezone === "local") {
    switch (unit) {
      case "minute":
        return new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          date.getHours(),
          date.getMinutes(),
          0,
          0,
        ).getTime();
      case "hour":
        return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), 0, 0, 0).getTime();
      case "day":
        return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime();
      case "week": {
        const dayOfWeek = date.getDay();
        const offset = (7 + dayOfWeek - weekStartsOn) % 7;
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset, 0, 0, 0, 0).getTime();
      }
      case "month":
        return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0).getTime();
      case "year":
      default:
        return new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0).getTime();
    }
  }

  switch (unit) {
    case "minute":
      return Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        0,
        0,
      );
    case "hour":
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), 0, 0, 0);
    case "day":
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0);
    case "week": {
      const dayOfWeek = date.getUTCDay();
      const offset = (7 + dayOfWeek - weekStartsOn) % 7;
      const flooredDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0);
      return flooredDay - offset * MS_PER_DAY;
    }
    case "month":
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0);
    case "year":
    default:
      return Date.UTC(date.getUTCFullYear(), 0, 1, 0, 0, 0, 0);
  }
}

const floorNode: NodeModule = {
  definition: {
    type: "datetime.floor",
    title: "DateTime Floor",
    description: "Round timestamps down to a selected calendar/time boundary.",
    color: "#0ea5e9",
    inputs: [{ id: "timestamp", label: "Timestamp (ms)", kind: "number" }],
    outputs: [
      { id: "epochMs", label: "Epoch (ms)", kind: "number" },
      { id: "iso", label: "ISO", kind: "any" },
    ],
    fields: [
      {
        key: "unit",
        label: "Unit",
        type: "select",
        defaultValue: "day",
        options: [
          { label: "Minute", value: "minute" },
          { label: "Hour", value: "hour" },
          { label: "Day", value: "day" },
          { label: "Week", value: "week" },
          { label: "Month", value: "month" },
          { label: "Year", value: "year" },
        ],
      },
      {
        key: "timezone",
        label: "Timezone",
        type: "select",
        defaultValue: "utc",
        options: [
          { label: "UTC", value: "utc" },
          { label: "Local", value: "local" },
        ],
      },
      {
        key: "weekStartsOn",
        label: "Week Starts On",
        type: "select",
        defaultValue: "monday",
        options: [
          { label: "Monday", value: "monday" },
          { label: "Sunday", value: "sunday" },
        ],
      },
    ],
  },
  executor: {
    type: "datetime.floor",
    run: ({ inputs, node }) => {
      const source = toNumericSeries(inputs.timestamp);
      if (!source || source.values.length === 0) {
        throw new Error("DateTime Floor requires numeric timestamp input in epoch milliseconds.");
      }

      const unit = String(node.config.unit ?? "day") as FloorUnit;
      const timezone = String(node.config.timezone ?? "utc") as TimezoneMode;
      const weekStartsOn = String(node.config.weekStartsOn ?? "monday") === "sunday" ? 0 : 1;
      const values = source.values.map((entry) => floorEpochMs(entry, unit, timezone, weekStartsOn));
      const timestamps = values.map((entry) => new Date(entry).toISOString());

      return {
        epochMs: {
          values,
          timestamps,
        },
        iso: outputScalarOrSeries(timestamps),
      };
    },
  },
};

export default floorNode;
