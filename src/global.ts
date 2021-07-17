// @ts-ignore
import css from "./pyodide/pyodide-styles.css";
import { getPluginOpts } from "./opts";
import { v4 as uuidv4 } from "uuid";
import type { WorkerMessage, WorkerResponse } from "./worker/worker-message";
import { assertUnreachable } from "./util";

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

export async function loadPyodide(artifactsUrl?: string) {
  if (pyodideLoadSingleton) return pyodideLoadSingleton;

  loadingStatus = "loading";
  const worker = new Worker(new URL("pyodide-worker.js", import.meta.url));
  worker.postMessage({
    type: "initialize",
    options: {
      artifactsUrl: artifactsUrl || getPluginOpts().artifactsUrl || (window as any).pyodideArtifactsUrl,
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
      reject(e);
    }
  });
}
