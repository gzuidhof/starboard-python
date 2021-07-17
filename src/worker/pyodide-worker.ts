// This worker will not be inlined. Maybe it should, so that it's easier to consume this package without setting up anything?
// Inlining a worker would work, however we might want to be able to use this as both a web worker and a shared worker :thinking:
// btw, the separate entrypoint is so that if we import util.ts, we won't get shared bundles
// after all, imports in web workers don't work in all browsers just yet...
// By the way, please design this so that multiple thingies can access the same worker. Everyone is responsible for their own 'scope' and their own variables, even if this will never work 100%

// Questions:
// - Should the worker stuff be optional?
// - SharedWorker support? (especially for development?)
// - Interrupting? (Make sure to enable COOP/COEP) (Also relevant https://github.com/pyodide/pyodide/pull/852 )
// - Preloading? ( https://github.com/pyodide/pyodide/issues/1576 )
// - Check out asyncio ( https://github.com/pyodide/pyodide/issues/245 )
// - Restarting? ( https://github.com/pyodide/pyodide/issues/703 )
// - Eval code? https://github.com/pyodide/pyodide/pull/1083
/// <reference no-default-lib="true"/>
/// <reference lib="es2020" />
/// <reference lib="WebWorker" />

import "../pyodide/pyodide";
import type { Pyodide as PyodideType } from "../pyodide/typings";

import { assertUnreachable } from "../util";
import { WorkerMessage, WorkerResponse } from "./worker-message";

declare global {
  interface WorkerGlobalScope {
    pyodide: PyodideType;
    loadPyodide(config: { indexURL: string }): Promise<void>;
  }
}

// TODO: Good enough for now, but I'd like to replace it with a console catcher
const originalConsole = self.console;
/*self.console = new Proxy(self.console, {
  get(target, prop, receiver) {
    const method = (target as any)[prop];
    if (method) {
      return function (...args: any[]) {
        self.postMessage({
          type: "console",
          method: prop,
          data: args,
        } as WorkerResponse);
      };
    }
  },
});*/

let pyodideLoadSingleton: Promise<void> | undefined = undefined;

self.addEventListener("message", async (e: MessageEvent) => {
  if (!e.data) return;
  const data = e.data as WorkerMessage;
  switch (data.type) {
    case "initialize": {
      if (pyodideLoadSingleton !== undefined) return;

      //consoleCatcher.hook(consoleMessageCallback);
      let artifactsURL = data.options.artifactsUrl || "https://cdn.jsdelivr.net/pyodide/v0.17.0/full/";
      if (!artifactsURL.endsWith("/")) artifactsURL += "/";
      self.importScripts(artifactsURL + "pyodide.js");
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
      pyodideLoadSingleton = self.loadPyodide({ indexURL: artifactsURL }).then(() => {
        self.postMessage({
          type: "initialized",
        } as WorkerResponse);
        //consoleCatcher.unhook(consoleMessageCallback);
      });
      break;
    }
    case "run": {
      //consoleCatcher.hook(consoleMessageCallback);
      console.log("Running ", data);
      if (self.pyodide.globals.set) {
        Object.entries(data.data).forEach(([key, value]) => {
          self.pyodide.globals.set?.(key, value); // Should we clear them afterwards again?
        });
      }
      let result = await self.pyodide.runPythonAsync(data.code);
      if (result && result.toJs) {
        result = result.toJs();
      }
      console.log("Result ", result);
      self.postMessage({
        type: "result",
        id: data.id,
        value: result,
      } as WorkerResponse);
      //consoleCatcher.unhook(consoleMessageCallback);
      break;
    }
    default: {
      assertUnreachable(data);
    }
  }
});
