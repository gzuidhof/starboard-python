/// <reference no-default-lib="true"/>
/// <reference lib="es2020" />
/// <reference lib="WebWorker" />

import "../pyodide/pyodide";
import type { Pyodide as PyodideType } from "../pyodide/typings";
import type { KernelManager, WorkerKernel } from "./kernel";
import { assertUnreachable } from "../util";
import { PyodideWorkerOptions, PyodideWorkerResult } from "./worker-message";
import { intArrayFromString } from "./emscripten-utils";
import { AsyncMemory } from "./async-memory";
import { deserialize } from "./serialize-object";

declare global {
  interface WorkerGlobalScope {
    /**
     * The object managing all the kernels in this web worker
     */
    manager: KernelManager;
  }
}

declare global {
  interface WorkerGlobalScope {
    pyodide: PyodideType;
    loadPyodide(config: {
      indexURL: string;
      stdin?: () => any | null;
      print?: (text: string) => void;
      printErr?: (text: string) => void;
    }): Promise<void>;
  }
}

class PyodideKernel implements WorkerKernel {
  kernelId: string;

  constructor(options: { id: string } & PyodideWorkerOptions) {
    this.kernelId = options.id;
  }
  init(): Promise<any> {
    throw new Error("Method not implemented.");
  }
  runCode(code: string): Promise<any> {
    throw new Error("Method not implemented.");
  }
  customMessage(message: any): void {
    throw new Error("Method not implemented.");
  }

  createStdin() {
    let input: number[] = [];
    let inputIndex = -1; // -1 means that we just returned null
    function stdin() {
      if (inputIndex === -1) {
        const text = self.manager.input();
        input = intArrayFromString(text + (text.endsWith("\n") ? "" : "\n"), true, 0);
        inputIndex = 0;
      }

      if (inputIndex < input.length) {
        let character = input[inputIndex];
        inputIndex++;
        return character;
      } else {
        inputIndex = -1;
        return null;
      }
    }
    return stdin;
  }
}

// TODO: Open a  Starboard kernel issue:
// - SharedWorker support? (especially for development?)
// - Interrupting? (Also relevant https://github.com/pyodide/pyodide/pull/852 and https://github.com/pyodide/pyodide/issues/676)
// - Restarting? ( https://github.com/pyodide/pyodide/issues/703 )
// - Shared filesystem

// TODO:
// document that COOP/COEP is required

/**
 * TODO:
 * # Async Python research
 * ## Syncify
 * https://github.com/pyodide/pyodide/pull/1547
 * ## Relevant issues for documentation/commenting
 * https://github.com/pyodide/pyodide/issues/1504
 */

let pyodideLoadSingleton: Promise<void> | undefined = undefined;
let asyncMemory: AsyncMemory | undefined = undefined;

self.addEventListener("message", async (e: MessageEvent) => {
  if (!e.data) {
    console.warn("Pyodide worker received unexpected message:", e);
    return;
  }
  const data = e.data as WorkerMessage;
  switch (data.type) {
    case "initialize": {
      if (pyodideLoadSingleton !== undefined) return;

      let artifactsURL = data.options.artifactsUrl || "https://cdn.jsdelivr.net/pyodide/v0.17.0/full/";
      if (!artifactsURL.endsWith("/")) artifactsURL += "/";

      /* self.importScripts(artifactsURL + "pyodide.js"); // Not used, we're importing our own pyodide.ts*/

      if (data.options.lockBuffer) {
        asyncMemory = new AsyncMemory(data.options.lockBuffer, data.options.dataBuffer);
      } else {
        console.warn("Missing lock buffer, some Pyodide functionality will be restricted");
      }

      (self.pyodide as any).matplotlibHelpers = {
        createElement: (tagName: string) => {
          // TODO:
          console.warn("Unsupported, plez implement");
          /*
            const elem = document.createElement(tagName);
            if (!CURRENT_HTML_OUTPUT_ELEMENT) {
              console.log("HTML output from pyodide but nowhere to put it, will append to body instead.");
              document.querySelector("body")!.appendChild(elem);
            } else {
              CURRENT_HTML_OUTPUT_ELEMENT.appendChild(elem);
            }
            return elem;*/
        },
      };

      const objectId = Symbol("id");

      const globalProxy = new Proxy(globalThis, {
        get(target, prop, receiver) {
          if (prop === objectId) {
            // TODO: return the id for this object
          }

          // https://stackoverflow.com/questions/27983023/proxy-on-dom-element-gives-error-when-returning-functions-that-implement-interfa
          // https://stackoverflow.com/questions/37092179/javascript-proxy-objects-dont-work
          const value = Reflect.get(target, prop, receiver);
          if (typeof value !== "function") return value;

          return new Proxy(value, {
            apply(_, thisArg, args) {
              // this: the object the function was called with. Can be the proxy or something else
              // receiver: the object the propery was gotten from. Is always the proxy or something inheriting from the proxy
              // target: the original object
              const calledWithProxy = thisArg === receiver;
              return Reflect.apply(value, calledWithProxy ? target : thisArg, args);
            },
          });
        },
      });

      pyodideLoadSingleton = self
        .loadPyodide({
          indexURL: artifactsURL,
          stdin: createStdin(),
          print: (text) => {
            sendConsole({
              method: "log",
              args: [text + ""],
            });
          },
          printErr: (text) => {
            sendConsole({
              method: "error",
              args: [text + ""],
            });
          },
        })
        .then(() => {
          // Fix "from js import ..."
          /* self.pyodide.unregisterJsModule("js"); // Not needed, since register conveniently overwrites existing things */
          self.pyodide.registerJsModule("js", globalProxy);

          self.postMessage({
            type: "initialized",
          } as WorkerResponse);
        });
      break;
    }
    case "run": {
      console.log("Running ", data);
      let result = await self.pyodide.runPythonAsync(data.code).catch((error) => error);
      let displayType: (WorkerResponse & { type: "result" })["display"];
      console.log("Result ", { result });

      if (self.pyodide.isPyProxy(result)) {
        if (result._repr_html_ !== undefined) {
          result = result._repr_html_();
          displayType = "html";
        } else if (result._repr_latex_ !== undefined) {
          result = result._repr_latex_();
          displayType = "latex";
        } else {
          const temp = result;
          result = result.toJs();
          temp?.destroy();
          console.log("Converted result ", { result });
        }
      }
      // TODO: Handle PythonError object (and check if there are other objects like that)

      try {
        self.postMessage({
          type: "result",
          id: data.id,
          display: displayType,
          value: result,
        } as WorkerResponse);
      } catch (e) {
        // Failed to serialize the result
        self.postMessage({
          type: "result",
          id: data.id,
          value: e + "",
        } as WorkerResponse);
      }
      break;
    }
    default: {
      assertUnreachable(data);
    }
  }
});

/*
function destroyToJsResult(x){
    if(!x){
        return;
    }
    if(pyodide.isPyProxy(x)){
        x.destroy();
        return;
    }
    if(x[Symbol.iterator]){
        for(let k of x){
            destroyToJsResult(k);
        }
    }
}*/
