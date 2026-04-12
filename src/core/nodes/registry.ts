import type { NodeDefinition } from "../types";
import { loadedNodeDefinitions } from "./moduleLoader";

export class NodeRegistry {
  private definitions = new Map<string, NodeDefinition>();

  constructor(definitions: NodeDefinition[]) {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  register(definition: NodeDefinition) {
    this.definitions.set(definition.type, definition);
  }

  get(type: string) {
    return this.definitions.get(type);
  }

  list() {
    return Array.from(this.definitions.values());
  }

  byCategory() {
    return this.list().reduce<Record<string, NodeDefinition[]>>((acc, definition) => {
      acc[definition.category] ??= [];
      acc[definition.category].push(definition);
      return acc;
    }, {});
  }
}

export const defaultNodeRegistry = new NodeRegistry(loadedNodeDefinitions);
