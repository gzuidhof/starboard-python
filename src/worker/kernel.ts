import { v4 as uuidv4 } from "uuid";
import { AsyncMemory } from "./async-memory";
import type { ProxyMessage } from "./object-proxy";

function assertUnreachable(_x: never): never {
  throw new Error("This case should have never been reached");
}

/**
 * Manages all the kernels in this worker
 */
export class WorkerKernelManager {
  readonly kernels = new Map<string, WorkerKernel>();

  readonly mainProxy: Window;

  asyncMemory: AsyncMemory | undefined;

  constructor() {
    self.addEventListener("message", async (e: MessageEvent) => {
      if (!e.data) {
        console.warn("Kernel worker received unexpected message:", e);
        return;
      }
      const data = e.data as WorkerMessage;
      switch (data.type) {
        case "initialize": {
          if (data.asyncMemory) {
            this.asyncMemory = new AsyncMemory(data.asyncMemory.lockBuffer, data.asyncMemory.dataBuffer);
          }
          if (data.globalThisId) {
          }
          if (data.getInputId) {
          }
          // TODO: input function (also an object) id
          // TODO: window object id
        }
        case "import-kernel": {
          try {
            importScripts(data.url);
            const kernelClass = (globalThis as any)[data.className];
            const kernel: WorkerKernel = new kernelClass(data.options);
            this.kernels.set(kernel.id, kernel);
            kernel.init().then(() => {
              this.postMessage({
                type: "kernel-initialized",
                id: data.id,
                kernelId: kernel.id,
              });
            });
          } catch (e) {
            this.postMessage({
              type: "error",
              id: data.id,
              error: e + "",
            });
          }
          break;
        }
        case "run": {
          try {
            const kernel = this.kernels.get(data.kernelId);
            if (!kernel) {
              throw new Error("Failed to find kernel with id " + data.kernelId);
            }
            const result = await kernel.runCode(data.code);
            this.postMessage({
              type: "result",
              id: data.id,
              value: result, // TODO: Wrap the result
            });
          } catch (e) {
            this.postMessage({
              type: "error",
              id: data.id,
              error: e + "",
            });
          }
          break;
        }
        case "custom": {
          const kernel = this.kernels.get(data.kernelId);
          if (kernel) {
            kernel.customMessage(data.message);
          } else {
            console.warn("Custom message was sent to an nonexistent kernel", data);
          }
          break;
        }
        default: {
          assertUnreachable(data);
          break;
        }
      }
    });

    if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
      this.mainProxy = new Proxy<Window>({} as any, {});
    } else {
      // @ts-ignore
      this.mainProxy = window;
    }
  }

  postMessage(message: WorkerResponse) {
    self.postMessage(message);
  }

  log(kernel: WorkerKernel, ...args: string[]) {
    this.postMessage({
      kernelId: kernel.id,
      type: "console",
      method: "log",
      data: args,
    });
  }

  logWarning(kernel: WorkerKernel, ...args: string[]) {
    this.postMessage({
      kernelId: kernel.id,
      type: "console",
      method: "warn",
      data: args,
    });
  }

  logError(kernel: WorkerKernel, ...args: string[]) {
    this.postMessage({
      kernelId: kernel.id,
      type: "console",
      method: "error",
      data: args,
    });
  }

  /**
   * Requests one line of user input
   */
  input(): string {
    return "\n";
  }
}

/**
 * The object managing all the kernels in this web worker
 */
export const manager = new WorkerKernelManager();

/**
 * Every message has an id to identify the communication and a type
 */
export type WorkerMessage =
  | {
      type: "initialize";
      asyncMemory?: {
        lockBuffer: SharedArrayBuffer;
        dataBuffer: SharedArrayBuffer;
      };
      globalThisId?: string;
      getInputId?: string;
    }
  | {
      type: "import-kernel";
      id: string;
      url: string;
      className: string;
      options: any;
    }
  | {
      type: "run";
      id: string;
      kernelId: string;
      code: string;
    }
  | {
      type: "custom";
      kernelId: string;
      message: any;
    }
  | ProxyMessage;

/**
 * Every response has an id to identify the communication and a type
 */
export type WorkerResponse =
  | {
      type: "kernel-initialized";
      id: string;
      kernelId: string;
    }
  | {
      type: "result";
      id: string;
      value: any;
    }
  | {
      type: "console";
      kernelId: string;
      method: "log" | "warn" | "error";
      data: string[];
    }
  | {
      type: "error";
      id: string;
      error: string;
    }
  | {
      type: "custom";
      kernelId: string;
      message: any;
    };

/**
 * A single kernel, usually for a specific cell type.
 *
 * Warning: Worker-kernels shouldn't import this class. Instead, they should `extends globalThis.WorkerKernel`
 */
export abstract class WorkerKernel {
  /**
   * Runtime ID to uniquely identify this kernel when sending messages
   */
  readonly id: string;

  constructor(options: any) {
    this.id = uuidv4();
  }

  abstract init(): Promise<any>;
  abstract runCode(code: string): Promise<any>;

  abstract customMessage(message: any): void;
}

declare global {
  interface WorkerGlobalScope {
    WorkerKernel: typeof WorkerKernel;
  }
}

// @ts-ignore
globalThis.WorkerKernel = WorkerKernel;
