import type { NodeModule } from "../../core/types";
import { toNumericSeries, type TimezoneMode } from "./shared";

function getParts(epochMs: number, timezone: TimezoneMode) {
  const date = new Date(epochMs);
  if (timezone === "local") {
    const dayOfWeek = date.getDay();
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      dayOfWeek,
      isoWeekday: dayOfWeek === 0 ? 7 : dayOfWeek,
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
      millisecond: date.getMilliseconds(),
    };
  }

  const dayOfWeek = date.getUTCDay();
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    dayOfWeek,
    isoWeekday: dayOfWeek === 0 ? 7 : dayOfWeek,
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
  };
}

const partsNode: NodeModule = {
  definition: {
    type: "datetime.parts",
    title: "DateTime Parts",
    description: "Extract calendar and clock components from epoch timestamps.",
    color: "#0ea5e9",
    inputs: [{ id: "timestamp", label: "Timestamp (ms)", kind: "number" }],
    outputs: [
      { id: "year", label: "Year", kind: "number" },
      { id: "month", label: "Month", kind: "number" },
      { id: "day", label: "Day", kind: "number" },
      { id: "dayOfWeek", label: "Weekday (0-6)", kind: "number" },
      { id: "isoWeekday", label: "ISO Weekday (1-7)", kind: "number" },
      { id: "hour", label: "Hour", kind: "number" },
      { id: "minute", label: "Minute", kind: "number" },
      { id: "second", label: "Second", kind: "number" },
      { id: "millisecond", label: "Millisecond", kind: "number" },
    ],
    fields: [
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
    ],
  },
  executor: {
    type: "datetime.parts",
    run: ({ inputs, node }) => {
      const series = toNumericSeries(inputs.timestamp);
      const timezone = String(node.config.timezone ?? "utc") as TimezoneMode;

      if (!series || series.values.length === 0) {
        throw new Error("DateTime Parts requires numeric timestamp input in epoch milliseconds.");
      }

      const partsByIndex = series.values.map((entry) => getParts(entry, timezone));
      const fallbackTimestamps = series.values.map((entry) => new Date(entry).toISOString());
      const timestamps = series.timestamps.length > 0 ? series.timestamps : fallbackTimestamps;
      const outputSeries = (values: number[]) => ({ values, timestamps });

      return {
        year: outputSeries(partsByIndex.map((entry) => entry.year)),
        month: outputSeries(partsByIndex.map((entry) => entry.month)),
        day: outputSeries(partsByIndex.map((entry) => entry.day)),
        dayOfWeek: outputSeries(partsByIndex.map((entry) => entry.dayOfWeek)),
        isoWeekday: outputSeries(partsByIndex.map((entry) => entry.isoWeekday)),
        hour: outputSeries(partsByIndex.map((entry) => entry.hour)),
        minute: outputSeries(partsByIndex.map((entry) => entry.minute)),
        second: outputSeries(partsByIndex.map((entry) => entry.second)),
        millisecond: outputSeries(partsByIndex.map((entry) => entry.millisecond)),
      };
    },
  },
};

export default partsNode;
