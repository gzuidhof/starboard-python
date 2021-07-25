/// <reference no-default-lib="true"/>
/// <reference lib="es2020" />
/// <reference lib="WebWorker" />

import "../pyodide/pyodide";
import type { Pyodide as PyodideType } from "../pyodide/typings";
import type { KernelManagerType, WorkerKernel } from "./kernel";
import { assertUnreachable } from "../util";
import { PyodideWorkerOptions, PyodideWorkerResult } from "./worker-message";

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
  proxiedGlobalThis: undefined | any;

  constructor(options: { id: string } & PyodideWorkerOptions) {
    this.kernelId = options.id;
    this.options = options;
  }
  async init(): Promise<any> {
    this.proxiedGlobalThis = this.proxyGlobalThis(this.options.globalThisId);

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
        if (this.proxiedGlobalThis) {
          // Fix "from js import ..."
          /* self.pyodide.unregisterJsModule("js"); // Not needed, since register conveniently overwrites existing things */
          self.pyodide.registerJsModule("js", this.proxiedGlobalThis); // TODO: Or should we register a new module? Like js_main
        }
      });
  }
  async runCode(code: string): Promise<any> {
    let result = await self.pyodide.runPythonAsync(code).catch((error) => error);
    let displayType: PyodideWorkerResult["display"];

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
    const encoder = new TextEncoder();
    let input = new Uint8Array();
    let inputIndex = -1; // -1 means that we just returned null
    function stdin() {
      if (inputIndex === -1) {
        const text = self.manager.input();
        input = encoder.encode(text + (text.endsWith("\n") ? "" : "\n"));
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

  private proxyGlobalThis(id?: string) {
    // Special cases for the globalThis object. We don't need to proxy everything
    const noProxy = new Set<string | symbol>([
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

      // Special cases for the pyodide globalThis
      "$$",
      "pyodide",
      "__name__",
      "__package__",
      "__path__",
      "__loader__",

      // Pyodide likes checking for lots of properties, like the .stack property to check if something is an error
      // https://github.com/pyodide/pyodide/blob/c8436c33a7fbee13e1ded97c0bbdaa7d635f2745/src/core/jsproxy.c#L1631
      "stack",
      "get",
      "set",
      "has",
      "size",
      "length",
      "then",
      "includes",
      "next",
      Symbol.iterator,
    ]);
    return self.manager.proxy && id
      ? self.manager.proxy.wrapExcluderProxy(self.manager.proxy.getObjectProxy(id), globalThis, noProxy)
      : globalThis;
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
