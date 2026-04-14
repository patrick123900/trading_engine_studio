import type { PortDefinition } from "../types";

const DEFAULT_PORTAL_CHANNEL = "main";
const PRIMARY_PORTAL_PORT_ID = "value";

export function normalizePortalChannel(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed || DEFAULT_PORTAL_CHANNEL;
}

export function getPortalOutChannels(config: Record<string, unknown>) {
  const rawChannels = config.channels;
  if (Array.isArray(rawChannels)) {
    const normalized = rawChannels
      .map((entry) => normalizePortalChannel(entry))
      .filter((entry) => entry.length > 0);

    if (normalized.length > 0) {
      return normalized;
    }
  }

  return [normalizePortalChannel(config.channel)];
}

export function getPortalInChannels(config: Record<string, unknown>) {
  const rawChannels = config.channels;
  if (Array.isArray(rawChannels)) {
    const normalized = rawChannels
      .map((entry) => normalizePortalChannel(entry))
      .filter((entry) => entry.length > 0);

    if (normalized.length > 0) {
      return normalized;
    }
  }

  return [normalizePortalChannel(config.channel)];
}

export function getPortalChannelPortId(index: number) {
  return index <= 0 ? PRIMARY_PORTAL_PORT_ID : `${PRIMARY_PORTAL_PORT_ID}_${index + 1}`;
}

export function getPortalChannelPortIndex(portId: string) {
  if (portId === PRIMARY_PORTAL_PORT_ID) {
    return 0;
  }

  const match = /^value_(\d+)$/.exec(portId);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 2) {
    return null;
  }

  return parsed - 1;
}

export function getPortalOutOutputId(index: number) {
  return getPortalChannelPortId(index);
}

export function getPortalOutOutputIndex(portId: string) {
  return getPortalChannelPortIndex(portId);
}

export function buildPortalOutOutputs(config: Record<string, unknown>): PortDefinition[] {
  return getPortalOutChannels(config).map((channel, index) => ({
    id: getPortalOutOutputId(index),
    label: channel,
    kind: "any",
  }));
}

export function getPortalInInputId(index: number) {
  return getPortalChannelPortId(index);
}

export function getPortalInInputIndex(portId: string) {
  return getPortalChannelPortIndex(portId);
}

export function buildPortalInInputs(config: Record<string, unknown>): PortDefinition[] {
  return getPortalInChannels(config).map((channel, index) => ({
    id: getPortalInInputId(index),
    label: channel,
    kind: "any",
  }));
}
