import type { PortDefinition } from "../types";

const DEFAULT_LOGIC_INPUTS = ["Left", "Right"];

function fallbackLabel(index: number) {
  if (index === 0) {
    return "Left";
  }

  if (index === 1) {
    return "Right";
  }

  return `Input ${index + 1}`;
}

function normalizeLogicInputLabel(value: unknown, index: number) {
  const raw = String(value ?? "");
  return raw.trim().length > 0 ? raw : fallbackLabel(index);
}

export function getLogicInputLabels(config: Record<string, unknown>) {
  const rawInputs = config.inputs;
  if (Array.isArray(rawInputs)) {
    const normalized = rawInputs.map((entry, index) => normalizeLogicInputLabel(entry, index));
    if (normalized.length >= 2) {
      return normalized;
    }
  }

  return DEFAULT_LOGIC_INPUTS;
}

export function getLogicInputId(index: number) {
  if (index === 0) {
    return "left";
  }

  if (index === 1) {
    return "right";
  }

  return `input_${index + 1}`;
}

export function getLogicInputIndex(portId: string) {
  if (portId === "left") {
    return 0;
  }

  if (portId === "right") {
    return 1;
  }

  const match = /^input_(\d+)$/.exec(portId);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 3) {
    return null;
  }

  return parsed - 1;
}

export function buildLogicInputs(config: Record<string, unknown>): PortDefinition[] {
  return getLogicInputLabels(config).map((label, index) => ({
    id: getLogicInputId(index),
    label,
    kind: "boolean",
  }));
}
