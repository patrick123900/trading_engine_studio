import type { NodeExecutor } from "../types";

export class ExecutorRegistry {
  private executors = new Map<string, NodeExecutor>();

  register(executor: NodeExecutor) {
    this.executors.set(executor.type, executor);
  }

  get(type: string) {
    return this.executors.get(type);
  }

  list() {
    return Array.from(this.executors.values());
  }
}
