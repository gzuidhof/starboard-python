import { AsyncMemory } from "./async-memory";
import { ObjectId, ObjectProxyClient, ProxyMessage } from "./object-proxy";

function assertUnreachable(_x: never): never {
  throw new Error("This case should have never been reached");
}

/**
 * Manages all the kernels in this worker.
 */
class KernelManager {
  readonly kernels = new Map<string, WorkerKernel>();

  asyncMemory: AsyncMemory | undefined;
  proxy: ObjectProxyClient | undefined;

  proxiedGlobalThis: undefined | any;

  /**
   * Requests one line of user input
   */
  input = () => "\n";

  constructor() {
    self.addEventListener("message", async (e: MessageEvent) => {
      if (!e.data) {
        console.warn("Kernel worker received unexpected message:", e);
        return;
      }
      console.log(e.data);
      const data = e.data as KernelManagerMessage;
      switch (data.type) {
        case "initialize": {
          if (data.asyncMemory) {
            this.asyncMemory = new AsyncMemory(data.asyncMemory.lockBuffer, data.asyncMemory.dataBuffer);
            this.proxy = new ObjectProxyClient(this.asyncMemory, (message) => {
              this.postMessage(message);
            });
            this.proxiedGlobalThis = this.proxyGlobalThis(data.globalThisId);
            if (data.getInputId) {
              this.input = this.proxy.getObjectProxy(data.getInputId);
            }
          } else {
            console.warn("Missing async memory, accessing objects from the main thread will not work");
          }

          break;
        }
        case "import-kernel": {
          try {
            importScripts(data.url);
            const KernelClass = (globalThis as any)[data.className];
            if (!data.options.id) {
              data.options.id = data.kernelId;
            }
            const kernel: WorkerKernel = new KernelClass(data.options);
            this.kernels.set(kernel.kernelId, kernel);
            kernel.init().then(() => {
              this.postMessage({
                type: "kernel-initialized",
                kernelId: kernel.kernelId,
              });
            });
          } catch (e) {
            this.postMessage({
              type: "error",
              kernelId: data.kernelId,
              id: "",
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
              kernelId: kernel.kernelId,
              id: data.id,
              value: result,
            });
          } catch (e) {
            this.postMessage({
              type: "error",
              kernelId: data.kernelId,
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
  }

  private proxyGlobalThis(id?: string) {
    // Special cases for the globalThis object. We don't need to proxy everything
    const noProxy = new Set<string>([
      "location",
      "navigator",
      "self",
      "importScripts",
      "addEventListener",
      "removeEventListener",
      "caches",
      "crypto",
      "indexedDB",
      "isSecureContext",
      "origin",
      "performance",
      "atob",
      "btoa",
      "clearInterval",
      "clearTimeout",
      "createImageBitmap",
      "fetch",
      "queueMicrotask",
      "setInterval",
      "setTimeout",
    ]);
    return this.proxy && id
      ? this.proxy.wrapExcluderProxy(this.proxy.getObjectProxy(id), globalThis, noProxy)
      : globalThis;
  }

  postMessage(message: KernelManagerResponse) {
    self.postMessage(message);
  }

  log(kernel: WorkerKernel, ...args: string[]) {
    this.postMessage({
      kernelId: kernel.kernelId,
      type: "console",
      method: "log",
      data: args,
    });
  }

  logWarning(kernel: WorkerKernel, ...args: string[]) {
    this.postMessage({
      kernelId: kernel.kernelId,
      type: "console",
      method: "warn",
      data: args,
    });
  }

  logError(kernel: WorkerKernel, ...args: string[]) {
    this.postMessage({
      kernelId: kernel.kernelId,
      type: "console",
      method: "error",
      data: args,
    });
  }

  [ObjectId] = "";
}

// https://stackoverflow.com/questions/49392409/in-typescript-how-to-export-the-type-of-a-private-class-without-exporting-class
export type KernelManagerType = InstanceType<typeof KernelManager>;

declare global {
  interface WorkerGlobalScope {
    /**
     * The object managing all the kernels in this web worker
     */
    manager: KernelManagerType;
  }
}

// @ts-ignore
globalThis.manager = new KernelManager();

/**
 * Every message has an id to identify the communication and a type
 */
export type KernelManagerMessage =
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
      kernelId: string;
      url: string;
      className: string;
      options: any;
    }
  | {
      type: "run";
      kernelId: string;
      id: string;
      code: string;
    }
  | {
      type: "custom";
      kernelId: string;
      message: any;
    };

/**
 * Every response has an id to identify the communication and a type
 */
export type KernelManagerResponse =
  | {
      type: "kernel-initialized";
      kernelId: string;
    }
  | {
      type: "result";
      kernelId: string;
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
      kernelId: string;
      id: string;
      error: string;
    }
  | {
      type: "custom";
      kernelId: string;
      message: any;
    }
  | ProxyMessage;

/**
 * A single kernel, usually for a specific cell type. Make sure to expose it in the global scope
 */
export interface WorkerKernel {
  /**
   * Runtime ID to uniquely identify this kernel when sending messages
   */
  readonly kernelId: string;

  init(): Promise<any>;

  /**
   * Runs code and returns a result
   * @returns A result that can be sent using postMessage
   */
  runCode(code: string): Promise<any>;
  customMessage(message: any): void;
}

declare var WorkerKernel: {
  new (options: { id: string; [key: string]: any }): WorkerKernel;
};

// export as namespace manager;
