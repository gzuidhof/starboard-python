// TODO: Questions: (guido)
// - Should the worker stuff be optional?
// - SharedWorker support? (especially for development?)
// - Interrupting? (Also relevant https://github.com/pyodide/pyodide/pull/852 )
// - Preloading? ( https://github.com/pyodide/pyodide/issues/1576 )
// - Check out asyncio ( https://github.com/pyodide/pyodide/issues/245 )
// - Restarting? ( https://github.com/pyodide/pyodide/issues/703 )
// - Eval code? https://github.com/pyodide/pyodide/pull/1083
// - design this so that multiple thingies can access the same kernel. Everyone is responsible for their own 'scope' and their own variables, even if this will never work 100%
// - it should be possible to define multiple 'kernels' that run in the same worker
// - test matplotlib, pretty sure that it currently doesn't work
/// <reference no-default-lib="true"/>
/// <reference lib="es2020" />
/// <reference lib="WebWorker" />

import "../pyodide/pyodide";
import type { Pyodide as PyodideType } from "../pyodide/typings";
import { assertUnreachable } from "../util";
import { WorkerMessage, WorkerResponse } from "./worker-message";
import { intArrayFromString, UTF8ArrayToString } from "./emscripten-utils";
import { AsyncMemory } from "./async-memory";
import { deserialize } from "./serialize-object";

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

// TODO:
// document that COOP/COEP is required

/**
 * TODO:
 * # Async Python research
 * ## Interrupt execution
 * sys.settrace() and SharedArrayBuffer
 * https://github.com/pyodide/pyodide/issues/676
 * ## Syncify
 * https://github.com/pyodide/pyodide/pull/1547
 * ## Relevant issues for documentation/commenting
 * https://github.com/pyodide/pyodide/issues/1504
 */

let pyodideLoadSingleton: Promise<void> | undefined = undefined;
let asyncMemory: AsyncMemory | undefined = undefined;

self.addEventListener("message", async (e: MessageEvent) => {
  if (!e.data) return;
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

      // TODO: deep proxy https://github.com/samvv/js-proxy-deep
      const globalProxy = new Proxy(globalThis, {
        get(target, prop, receiver) {
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
        /*set(target, prop, value, receiver) {
          return Reflect.set(target, prop, value, receiver);
        },
        ownKeys(target) {
          return Reflect.ownKeys(target);
        },
        has(target, prop) {
          return Reflect.has(target, prop);
        },
        defineProperty(target, prop, attributes) {
          return Reflect.defineProperty(target, prop, attributes);
        },
        deleteProperty(target, prop) {
          return Reflect.deleteProperty(target, prop);
        },
        getOwnPropertyDescriptor(target, prop) {
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
        isExtensible(target) {
          return Reflect.isExtensible(target);
        },
        preventExtensions(target) {
          return Reflect.preventExtensions(target);
        },
        getPrototypeOf(target) {
          return Reflect.getPrototypeOf(target);
        },
        setPrototypeOf(target, proto) {
          return Reflect.setPrototypeOf(target, proto);
        },*/
        // For function objects
        /*apply(target, thisArg, argumentsList) {
          return Reflect.apply(target, thisArg, argumentsList);
        },
        construct(target, argumentsList, newTarget) {
          return Reflect.construct(target, argumentsList, newTarget)
        }*/
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
      let result = await self.pyodide.runPythonAsync(data.code);
      if (result && result.toJs) {
        result = result.toJs();
        result?.destroy();
      }
      console.log("Result ", result);
      self.postMessage({
        type: "result",
        id: data.id,
        value: result,
      } as WorkerResponse);
      break;
    }
    default: {
      assertUnreachable(data);
    }
  }
});

function createStdin() {
  let input: number[] = [];
  let inputIndex = -1; // -1 means that we just returned null
  function stdin() {
    if (inputIndex === -1) {
      input = intArrayFromString(getInput(), true, 0); // getInput() will always return a string ending in "\n"
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

function getInput() {
  if (asyncMemory === undefined) return "\n";

  // TODO: Maybe we should also support the service worker approach
  // https://glitch.com/edit/#!/sleep-sw?path=worker.js%3A27%3A40

  // Lock the shared memory
  asyncMemory.lock();
  // Request info main thread
  self.postMessage({
    type: "stdin",
  } as WorkerResponse);
  // Wait (blocking)
  asyncMemory.waitForSize();
  // Ensure buffer size
  const numberOfBytes = asyncMemory.readSize();
  if (numberOfBytes > asyncMemory.sharedMemory.byteLength) {
    self.postMessage({
      type: "data-buffer",
      dataBuffer: asyncMemory.resize(numberOfBytes),
    } as WorkerResponse);
  } else {
    self.postMessage({
      type: "data-buffer",
    } as WorkerResponse);
  }
  // Wait (blocking)
  asyncMemory.waitForWorker();
  // Read the result
  const result = deserialize(asyncMemory.memory, numberOfBytes);

  return result ? result + "\n" : "\n";
}

function sendConsole({ method, args }: { method: string; args: string[] }) {
  self.postMessage({
    type: "console",
    method: method,
    data: args,
  } as WorkerResponse);
}
