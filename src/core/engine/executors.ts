import { ExecutorRegistry } from "./executorRegistry";
import { loadedNodeExecutors } from "../nodes/moduleLoader";

export const defaultExecutorRegistry = new ExecutorRegistry();

loadedNodeExecutors.forEach((executor) => defaultExecutorRegistry.register(executor));
