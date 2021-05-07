/**
 * Matplotlib currently creates a dom element which never gets attached to the DOM.
 * Without a way to specify our own DOM node creation function, we override it here - saving us from shipping our own matplotlib package.
 */
export function patchMatplotlib(module: { runPythonSimple: (code: string) => any }) {
  module.runPythonSimple(`import matplotlib
import matplotlib.pyplot
from js import pyodide as jspyodide

def create_root_element(self):
  el = jspyodide.matplotlibHelpers.createElement("div");
  return el

matplotlib.backends.wasm_backend.FigureCanvasWasm.create_root_element = create_root_element
`);
}
