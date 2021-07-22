// @ts-ignore
import css from "./pyodide/pyodide-styles.css";
import { getPluginOpts } from "./opts";
import { v4 as uuidv4 } from "uuid";
import { assertUnreachable } from "./util";
import type { KernelManagerMessage, KernelManagerResponse } from "./worker/kernel";
import type { PyodideWorkerOptions, PyodideWorkerResult } from "./worker/worker-message";
import { AsyncMemory } from "./worker/async-memory";
import type { Runtime } from "starboard-notebook/dist/src/types";
import { ObjectProxyHost } from "./worker/object-proxy";

let setupStatus: "unstarted" | "started" | "completed" = "unstarted";
let loadingStatus: "unstarted" | "loading" | "ready" = "unstarted";
let pyodideLoadSingleton: Promise<string> | undefined = undefined;
let kernelManager: Worker;
let objectProxyHost: ObjectProxyHost | null = null;
const runningCode = new Map<string, (value: any) => void>();

// A global value that is the current HTML element to attach matplotlib figures to..
// perhaps this can be done in a cleaner way.
let CURRENT_HTML_OUTPUT_ELEMENT: HTMLElement | undefined = undefined;

export function setGlobalPythonOutputElement(el: HTMLElement | undefined) {
  CURRENT_HTML_OUTPUT_ELEMENT = el;
}

/**
 * Initial setup for Python support, this includes only the synchronous parts (such as adding a stylesheet used for the output).
 * @returns
 */
export function setupPythonSupport() {
  if (setupStatus !== "unstarted") {
    return;
  }
  setupStatus = "started";

  /** Naughty matplotlib WASM backend captures and disables contextmenu globally.. hack to prevent that */
  window.addEventListener(
    "contextmenu",
    function (event) {
      if (
        event.target instanceof HTMLElement &&
        event.target.id.startsWith("matplotlib_") &&
        event.target.tagName === "CANVAS"
      ) {
        return false;
      }
      event.stopPropagation();
    },
    true
  );

  const styleSheet = document.createElement("style");
  styleSheet.id = "pyodide-styles";
  styleSheet.innerHTML = css;
  document.head.appendChild(styleSheet);

  setupStatus = "completed";
}

function getAsyncMemory() {
  if (
    "SharedArrayBuffer" in globalThis &&
    "Atomics" in globalThis &&
    (globalThis as any)["crossOriginIsolated"] !== false
  ) {
    return new AsyncMemory();
  } else {
    return null;
  }
}

async function convertResult(runtime: Runtime, data: PyodideWorkerResult) {
  if (data.display === "default") {
    return data.value;
  } else if (data.display === "html") {
    let div = document.createElement("div");
    div.className = "rendered_html cell-output-html";
    div.appendChild(new DOMParser().parseFromString(data.value, "text/html").body.firstChild as any);
    return div;
  } else if (data.display === "latex") {
    let div = document.createElement("div");
    div.className = "rendered_html cell-output-html";
    const katex = await runtime.exports.libraries.async.KaTeX();

    katex.render(data.value.replace(/^(\$?\$?)([^]*)\1$/, "$2"), div, {
      throwOnError: false,
      errorColor: " #cc0000",
      displayMode: true,
    });

    return div;
  } else {
    return data.value;
  }
}

function loadKernelManager() {
  // TODO: This part should be moved to starboard
  const kernelUrl: string | undefined = undefined;

  const worker = kernelUrl ? new Worker(kernelUrl) : new Worker(new URL("kernel.js", import.meta.url));

  // Since all kernels are running in the same worker, they might as well use the same async memory and object proxy
  const asyncMemory = getAsyncMemory();
  const objectProxyHost = asyncMemory ? new ObjectProxyHost(asyncMemory) : null;
  const globalThisId = objectProxyHost?.registerRootObject(globalThis);
  const getInputId = objectProxyHost?.registerRootObject(() => {
    prompt();
  });

  worker.addEventListener("message", (ev) => {
    if (!ev.data) {
      console.warn("Unexpected message from kernel manager", ev);
      return;
    }
    const data = ev.data as KernelManagerResponse;

    if (data.type === "proxy-reflect" || data.type === "proxy-shared-memory") {
      if (asyncMemory && objectProxyHost) {
        objectProxyHost.handleProxyMessage(data, asyncMemory);
      }
    }
  });

  worker.postMessage({
    type: "initialize",
    asyncMemory: asyncMemory
      ? {
          lockBuffer: asyncMemory.sharedLock,
          dataBuffer: asyncMemory.sharedMemory,
        }
      : undefined,
    globalThisId: globalThisId,
    getInputId: getInputId,
  } as KernelManagerMessage);

  return {
    kernelManager: worker,
    objectProxyHost: objectProxyHost,
  };
}

export async function loadPyodide(runtime: Runtime, artifactsUrl?: string, workerUrl?: string) {
  if (pyodideLoadSingleton) return pyodideLoadSingleton;

  const result = loadKernelManager();
  kernelManager = result.kernelManager;
  objectProxyHost = result.objectProxyHost;

  // Pyodide worker loading
  loadingStatus = "loading";

  const kernelId = uuidv4();

  pyodideLoadSingleton = new Promise((resolve, reject) => {
    // Only the resolve case is handled for now
    function handleInitMessage(ev: MessageEvent<any>) {
      if (!ev.data) return;
      const data = ev.data as KernelManagerResponse;
      if (data.type === "kernel-initialized" && data.kernelId === kernelId) {
        kernelManager.removeEventListener("message", handleInitMessage);

        resolve(kernelId);
      }
    }
    kernelManager.addEventListener("message", handleInitMessage);
  });

  kernelManager.addEventListener("message", (e) => {
    if (!e.data) return;

    const data = e.data as KernelManagerResponse;
    switch (data.type) {
      case "result": {
        if (data.kernelId !== kernelId) break;
        const callback = runningCode.get(data.id);
        if (!callback) {
          console.warn("Missing Python callback");
        } else {
          convertResult(runtime, data.value as PyodideWorkerResult).then(callback);
        }
        objectProxyHost?.clearTemporary();
        break;
      }
      case "console": {
        if (data.kernelId !== kernelId) break;
        (console as any)?.[data.method](...data.data);
        break;
      }
      case "error": {
        if (data.kernelId !== kernelId) break;
        console.error(data.error);
      }
      case "custom": {
        if (data.kernelId !== kernelId) break;
        // No custom messages so far
        break;
      }
      // Ignore
      case "kernel-initialized":
      case "proxy-reflect":
      case "proxy-shared-memory": {
        break;
      }
      default: {
        assertUnreachable(data);
      }
    }
  });

  kernelManager.postMessage({
    type: "import-kernel",
    className: "PyodideKernel",
    kernelId: kernelId,
    options: {
      artifactsUrl: artifactsUrl || getPluginOpts().artifactsUrl || (window as any).pyodideArtifactsUrl,
    } as PyodideWorkerOptions,
    url: workerUrl ?? new URL("pyodide-worker.js", import.meta.url) + "",
  } as KernelManagerMessage);

  await pyodideLoadSingleton;
  loadingStatus = "ready";

  return pyodideLoadSingleton;
}

export function getPyodideLoadingStatus() {
  return loadingStatus;
}

export async function runPythonAsync(code: string, data?: { [key: string]: any }) {
  if (!pyodideLoadSingleton) return;

  const id = uuidv4();

  const kernelId = await pyodideLoadSingleton;
  return new Promise((resolve, reject) => {
    runningCode.set(id, (result) => {
      resolve(result);
      runningCode.delete(id);
    });

    try {
      kernelManager.postMessage({
        type: "run",
        kernelId: kernelId,
        id: id,
        code: code,
      } as KernelManagerMessage);
    } catch (e) {
      console.warn(e, data);
      reject(e);
      runningCode.delete(id);
    }
  });
}
