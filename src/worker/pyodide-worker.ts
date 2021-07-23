/// <reference no-default-lib="true"/>
/// <reference lib="es2020" />
/// <reference lib="WebWorker" />

import "../pyodide/pyodide";
import type { Pyodide as PyodideType } from "../pyodide/typings";
import type { KernelManagerType, WorkerKernel } from "./kernel";
import { assertUnreachable } from "../util";
import { PyodideWorkerOptions, PyodideWorkerResult } from "./worker-message";
import { intArrayFromString } from "./emscripten-utils";

declare global {
  interface WorkerGlobalScope {
    /**
     * The object managing all the kernels in this web worker
     */
    manager: KernelManagerType;
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
  options: PyodideWorkerOptions;

  constructor(options: { id: string } & PyodideWorkerOptions) {
    this.kernelId = options.id;
    this.options = options;
  }
  async init(): Promise<any> {
    let artifactsURL = this.options.artifactsUrl || "https://cdn.jsdelivr.net/pyodide/v0.17.0/full/";
    if (!artifactsURL.endsWith("/")) artifactsURL += "/";

    /* self.importScripts(artifactsURL + "pyodide.js"); // Not used, we're importing our own pyodide.ts*/

    if (!self.manager.proxy) {
      console.warn("Missing object proxy, some Pyodide functionality will be restricted");
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

    await self
      .loadPyodide({
        indexURL: artifactsURL,
        stdin: this.createStdin(),
        print: (text) => {
          self.manager.log(this, text + "");
        },
        printErr: (text) => {
          self.manager.logError(this, text + "");
        },
      })
      .then(() => {
        if (self.manager.proxiedGlobalThis) {
          // Fix "from js import ..."
          /* self.pyodide.unregisterJsModule("js"); // Not needed, since register conveniently overwrites existing things */
          self.pyodide.registerJsModule("js", this.proxyGlobalThis(self.manager.proxiedGlobalThis)); // TODO: Or should we register a new module? Like js_main
        }
      });
  }
  async runCode(code: string): Promise<any> {
    console.log("Running ", code);
    let result = await self.pyodide.runPythonAsync(code).catch((error) => error);
    let displayType: PyodideWorkerResult["display"];
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
        this.destroyToJsResult(result);
        temp?.destroy();
        console.log("Converted result ", { result });
      }
    } else if (result instanceof self.pyodide.PythonError) {
      result = result + "";
    }

    return {
      display: displayType,
      value: result,
    } as PyodideWorkerResult;
  }
  customMessage(message: any): void {
    // No custom messages are supported nor used.
    return;
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

  private proxyGlobalThis(obj: any): any {
    // Special cases for the pyodide globalThis
    // In some cases, we'll end up with 4 nested proxies (this one, the kernel excluder proxy, the reflect proxy and the Pyodide js proxy)
    if (self.manager.proxy) {
      //const noProxy = new Set<string>(["$$", "__name__", "__package__", "__path__", "__loader__"]);
      //return self.manager.proxy.wrapExcluderProxy(obj, globalThis, noProxy);
    }

    return obj;
  }

  private destroyToJsResult(x: any) {
    if (!x) {
      return;
    }
    if (self.pyodide.isPyProxy(x)) {
      x.destroy();
      return;
    }
    if (x[Symbol.iterator]) {
      for (let k of x) {
        this.destroyToJsResult(k);
      }
    }
  }
}

// @ts-ignore
globalThis.PyodideKernel = PyodideKernel;

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
