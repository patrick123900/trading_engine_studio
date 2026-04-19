import type { NodeModule } from "../../core/types";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND, MS_PER_WEEK } from "./shared";

function readNumber(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function unitToMs(unit: string) {
  switch (unit) {
    case "week":
      return MS_PER_WEEK;
    case "day":
      return MS_PER_DAY;
    case "hour":
      return MS_PER_HOUR;
    case "minute":
      return MS_PER_MINUTE;
    case "second":
      return MS_PER_SECOND;
    case "millisecond":
    default:
      return 1;
  }
}

const durationNode: NodeModule = {
  definition: {
    type: "datetime.duration",
    title: "Duration Constant",
    description: "Emit a duration as epoch milliseconds for datetime arithmetic.",
    color: "#0ea5e9",
    inputs: [],
    outputs: [{ id: "value", label: "Milliseconds", kind: "number" }],
    fields: [
      { key: "amount", label: "Amount", type: "number", defaultValue: 1 },
      {
        key: "unit",
        label: "Unit",
        type: "select",
        defaultValue: "day",
        options: [
          { label: "Milliseconds", value: "millisecond" },
          { label: "Seconds", value: "second" },
          { label: "Minutes", value: "minute" },
          { label: "Hours", value: "hour" },
          { label: "Days", value: "day" },
          { label: "Weeks", value: "week" },
        ],
      },
    ],
  },
  executor: {
    type: "datetime.duration",
    run: ({ node }) => {
      const amount = readNumber(node.config.amount, 1);
      const unit = String(node.config.unit ?? "day").toLowerCase();
      return amount * unitToMs(unit);
    },
  },
};

export default durationNode;
