export type TimestampMode = "auto" | "milliseconds" | "seconds" | "iso";
export type TimezoneMode = "utc" | "local";

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;
export const MS_PER_WEEK = 7 * MS_PER_DAY;

export interface NumericSeries {
  values: number[];
  timestamps: string[];
}

function normalizeEpochFromNumber(value: number, mode: TimestampMode) {
  if (!Number.isFinite(value)) {
    return null;
  }

  switch (mode) {
    case "seconds":
      return value * MS_PER_SECOND;
    case "milliseconds":
      return value;
    case "iso":
      return null;
    case "auto":
    default:
      return Math.abs(value) < 100_000_000_000 ? value * MS_PER_SECOND : value;
  }
}

function parseTimestampValue(value: unknown, mode: TimestampMode) {
  if (value instanceof Date) {
    const epochMs = value.getTime();
    return Number.isFinite(epochMs) ? epochMs : null;
  }

  if (typeof value === "number") {
    return normalizeEpochFromNumber(value, mode);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (mode === "seconds" || mode === "milliseconds") {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return normalizeEpochFromNumber(numeric, mode);
  }

  if (mode === "auto") {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return normalizeEpochFromNumber(numeric, "auto");
    }
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractRawTimestampValues(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    if ("timestamps" in value) {
      const timestamps = (value as { timestamps?: unknown }).timestamps;
      if (Array.isArray(timestamps)) {
        return timestamps;
      }
    }

    if ("values" in value) {
      const values = (value as { values?: unknown }).values;
      if (Array.isArray(values)) {
        return values;
      }
    }

    if ("value" in value) {
      return extractRawTimestampValues((value as { value?: unknown }).value);
    }
  }

  if (typeof value === "string" || typeof value === "number" || value instanceof Date) {
    return [value];
  }

  return null;
}

export function toNumericSeries(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return {
      values: [value],
      timestamps: [] as string[],
    };
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    return {
      values: value,
      timestamps: [] as string[],
    };
  }

  if (value && typeof value === "object" && "values" in value) {
    const values = (value as { values?: unknown }).values;
    const timestamps = (value as { timestamps?: unknown }).timestamps;
    if (Array.isArray(values) && values.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
      return {
        values,
        timestamps: Array.isArray(timestamps)
          ? timestamps.filter((entry): entry is string => typeof entry === "string")
          : [],
      };
    }
  }

  if (value && typeof value === "object" && "value" in value) {
    return toNumericSeries((value as { value?: unknown }).value);
  }

  return null;
}

export function toTimestampSeries(value: unknown, mode: TimestampMode) {
  const rawValues = extractRawTimestampValues(value);
  if (!rawValues || rawValues.length === 0) {
    return null;
  }

  const values: number[] = [];
  for (let index = 0; index < rawValues.length; index += 1) {
    const parsed = parseTimestampValue(rawValues[index], mode);
    if (parsed === null || !Number.isFinite(parsed)) {
      throw new Error(`Unable to parse timestamp at index ${index + 1}.`);
    }
    values.push(parsed);
  }

  return {
    values,
    timestamps: values.map((entry) => new Date(entry).toISOString()),
  };
}

export function outputScalarOrSeries(values: unknown[]) {
  return values.length === 1 ? values[0] : values;
}
