// @ts-ignore
import css from "./pyodide/pyodide-styles.css";
import { getPluginOpts } from "./opts";
import { v4 as uuidv4 } from "uuid";
import type { WorkerMessage, WorkerResponse } from "./worker/worker-message";
import { assertUnreachable } from "./util";
import { AsyncMemory } from "./worker/async-memory";
import { serialize } from "./worker/serialize-object";

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

export async function loadPyodide(artifactsUrl?: string) {
  if (pyodideLoadSingleton) return pyodideLoadSingleton;

  loadingStatus = "loading";
  // TODO: Make the worker constructor configureable (plugin settings)
  const worker = new Worker(new URL("pyodide-worker.js", import.meta.url));
  const asyncMemory = getAsyncMemory();
  let dataToTransfer: Uint8Array | undefined = undefined;

  worker.postMessage({
    type: "initialize",
    options: {
      artifactsUrl: artifactsUrl || getPluginOpts().artifactsUrl || (window as any).pyodideArtifactsUrl,
      lockBuffer: asyncMemory?.sharedLock,
      dataBuffer: asyncMemory?.sharedMemory,
    },
  } as WorkerMessage);

  pyodideLoadSingleton = new Promise((resolve, reject) => {
    // Only the resolve case is handled for now
    worker.addEventListener(
      "message",
      (ev) => {
        if (ev.data && (ev.data as WorkerResponse).type === "initialized") {
          resolve(worker);
        }
      },
      {
        once: true,
      }
    );
  });

  worker.addEventListener("message", (e) => {
    if (!e.data) return;
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
          callback(data.value);
        }
        break;
      }
      case "console": {
        // TODO: Maybe this should directly hook into the console catcher?
        (console as any)?.[data.method](...data.data);
        break;
      }
      case "stdin": {
        if (!asyncMemory) return; // Stdin is unsupported
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
      console.log(data);
      worker.postMessage({
        type: "run",
        id: id,
        code: code,
        data: data,
      } as WorkerMessage);
    } catch (e) {
      // It failed to be copied. Usually that means that the object cannot be cloned that easily.
      // TODO: Handle this more gracefully
      reject(e);
      runningCode.delete(id);
    }
  });
}
