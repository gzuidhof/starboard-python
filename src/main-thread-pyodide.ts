import type { KernelManagerMessage, KernelManagerType, WorkerKernel } from "./worker/kernel";
import type { PyodideWorkerOptions } from "./worker/worker-message";
import { ObjectId } from "./worker/object-proxy";

export async function mainThreadPyodide(opts: KernelManagerMessage & { type: "import-kernel" }) {
  let pyodideWorkerOptions = opts.options as PyodideWorkerOptions;
  pyodideWorkerOptions.globalThisId = "";
  pyodideWorkerOptions.drawCanvasId = ""; // TODO:

  const fakeKernel: KernelManagerType = {
    proxy: undefined,
    postMessage(message) {},
    input: () => {
      return "";
    },
    kernels: new Map(),
    log(kernel, ...args) {
      console.log(args);
    },
    logWarning(kernel, ...args) {
      console.warn(args);
    },
    logError(kernel, ...args) {
      console.error(args);
    },
    [ObjectId]: "",
  };

  (globalThis as any).manager = fakeKernel;
  const kernel = await new Promise<WorkerKernel>((resolve, reject) => {
    try {
      const script = document.createElement("script");
      script.onload = function () {
        const KernelClass = (globalThis as any)[opts.className];
        if (!opts.options.id) {
          opts.options.id = opts.kernelId;
        }
        new KernelClass(pyodideWorkerOptions).init().then(() => {
          resolve(kernel);
        });
      };
      script.src = opts.url;
      document.head.appendChild(script);
    } catch (e) {
      reject(e);
    }
  });

  async function run(code: string) {
    const result = await kernel.runCode(code);
    return result;
  }

  return run;
}
