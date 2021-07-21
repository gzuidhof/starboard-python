// @ts-ignore
import css from "./pyodide/pyodide-styles.css";
import { getPluginOpts } from "./opts";
import { v4 as uuidv4 } from "uuid";
import type { WorkerMessage, WorkerResponse } from "./worker/worker-message";
import { assertUnreachable } from "./util";
import { AsyncMemory } from "./worker/async-memory";
import { serialize } from "./worker/serialize-object";
import type { Runtime } from "starboard-notebook/dist/src/types";
import { exposeObject } from "./worker/object-proxy";

let setupStatus: "unstarted" | "started" | "completed" = "unstarted";
let loadingStatus: "unstarted" | "loading" | "ready" = "unstarted";
let pyodideLoadSingleton: Promise<Worker> | undefined = undefined;
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
    const asyncMemory: AsyncMemory = new AsyncMemory(
      new SharedArrayBuffer(8 * Int32Array.BYTES_PER_ELEMENT),
      new SharedArrayBuffer(100)
    );
    return asyncMemory;
  } else {
    return null;
  }
}

async function convertResult(runtime: Runtime, data: WorkerResponse & { type: "result" }) {
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

export async function loadPyodide(runtime: Runtime, artifactsUrl?: string, workerUrl?: string) {
  if (pyodideLoadSingleton) return pyodideLoadSingleton;

  loadingStatus = "loading";
  const worker = workerUrl ? new Worker(workerUrl) : new Worker(new URL("pyodide-worker.js", import.meta.url));
  const asyncMemory = getAsyncMemory();
  const globalThisId = exposeObject(globalThis);
  const getInputId = exposeObject(prompt);
  let dataToTransfer: Uint8Array | undefined = undefined;

  pyodideLoadSingleton = new Promise((resolve, reject) => {
    // Only the resolve case is handled for now
    function handleInitMessage(ev: MessageEvent<any>) {
      if (ev.data && (ev.data as WorkerResponse).type === "initialized") {
        worker.removeEventListener("message", handleInitMessage);
        resolve(worker);
      }
    }
    worker.addEventListener("message", handleInitMessage);
  });

  worker.addEventListener("message", (e) => {
    if (!e.data) {
      console.warn("Pyodide worker sent unexpected message:", e);
      return;
    }
    const data = e.data as WorkerResponse;
    switch (data.type) {
      case "initialized": {
        // Ignore
        break;
      }
      case "result": {
        const callback = runningCode.get(data.id);
        if (!callback) {
          console.warn("Missing Python callback");
        } else {
          convertResult(runtime, data).then(callback);
        }
        break;
      }
      case "console": {
        (console as any)?.[data.method](...data.data);
        break;
      }
      case "stdin": {
        if (!asyncMemory) return;

        const userInput = prompt("Input"); // TODO: Replace this with a proper input thingy
        dataToTransfer = serialize(userInput);
        asyncMemory.writeSize(dataToTransfer.buffer.byteLength);
        asyncMemory.unlockSize();
        break;
      }
      case "data-buffer": {
        if (!asyncMemory) break;
        // Resize buffer
        if (data.dataBuffer) {
          asyncMemory.sharedMemory = data.dataBuffer;
          asyncMemory.memory = new Uint8Array(asyncMemory.sharedMemory);
        }
        // Write data
        if (dataToTransfer) {
          asyncMemory.memory.set(dataToTransfer);
          dataToTransfer = undefined;
        }
        asyncMemory.unlockWorker();
        break;
      }
      default: {
        assertUnreachable(data);
      }
    }
  });

  worker.postMessage({
    type: "initialize",
    options: {
      artifactsUrl: artifactsUrl || getPluginOpts().artifactsUrl || (window as any).pyodideArtifactsUrl,
      lockBuffer: asyncMemory?.sharedLock,
      dataBuffer: asyncMemory?.sharedMemory,
    },
  } as WorkerMessage);

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

  const worker = await pyodideLoadSingleton;
  return new Promise((resolve, reject) => {
    runningCode.set(id, (result) => {
      resolve(result);
      runningCode.delete(id);
    });

    try {
      worker.postMessage({
        type: "run",
        id: id,
        code: code,
      } as WorkerMessage);
    } catch (e) {
      console.warn(e, data);
      // It failed to be copied. Usually that means that the object cannot be cloned that easily.
      // TODO: Handle this more gracefully
      reject(e);
      runningCode.delete(id);
    }
  });
}
