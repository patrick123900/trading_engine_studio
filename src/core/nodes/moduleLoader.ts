import type { NodeDefinition, NodeModule } from "../types";

interface LoadedNodeModule {
  category: string;
  definition: NodeDefinition;
  executor?: NodeModule["executor"];
}

const CATEGORY_COLORS: Record<string, string> = {
  Data: "#2f855a",
  Indicator: "#0f766e",
  Logic: "#2563eb",
  Output: "#c53030",
  Trading: "#7c3aed",
  Utility: "#6b7280",
};

function normalizeModule(path: string, moduleValue: unknown): LoadedNodeModule | null {
  const match = path.match(/\/nodes\/([^/]+)\/[^/]+\.ts$/);
  const category = match?.[1];
  if (!category) {
    return null;
  }

  const candidate =
    moduleValue && typeof moduleValue === "object" && "default" in moduleValue
      ? (moduleValue as { default?: unknown }).default
      : moduleValue;

  if (!candidate || typeof candidate !== "object" || !("definition" in candidate)) {
    return null;
  }

  const nodeModule = candidate as NodeModule;
  return {
    category,
    definition: {
      ...nodeModule.definition,
      category,
      color: CATEGORY_COLORS[category] ?? nodeModule.definition.color,
    },
    executor: nodeModule.executor,
  };
}

const discoveredModules = import.meta.glob("../../nodes/*/*.ts", { eager: true });

export const loadedNodeModules = Object.entries(discoveredModules)
  .map(([path, moduleValue]) => normalizeModule(path, moduleValue))
  .filter((entry): entry is LoadedNodeModule => entry !== null)
  .sort((a, b) => a.definition.title.localeCompare(b.definition.title));

export const loadedNodeDefinitions = loadedNodeModules.map((entry) => entry.definition);
export const loadedNodeExecutors = loadedNodeModules
  .map((entry) => entry.executor)
  .filter((executor): executor is NonNullable<LoadedNodeModule["executor"]> => executor !== undefined);
