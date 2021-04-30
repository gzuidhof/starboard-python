import { CellTypeDefinition, CellHandlerAttachParameters, CellElements, Cell, StarboardPlugin } from "starboard-notebook/dist/src/types";
import * as lithtmlImport from "lit-html";
import { Runtime, ControlButton } from "starboard-notebook/dist/src/types";

import { Pyodide as PyodideType } from "./typings";

import { getPyodideLoadingStatus, loadPyodide, setupPythonSupport, setGlobalPythonOutputElement } from "./global.js";
import { runStarboardPython } from "./run.js";
import { isPyProxy } from "./util";
import { setPluginOpts, StarboardPythonPluginOpts } from "./opts";

export { getPyodideLoadingStatus, setupPythonSupport, loadPyodide, setGlobalPythonOutputElement}
export { runStarboardPython } from "./run.js";

declare global {
    interface Window {
      pyodide: PyodideType;
      loadPyodide(opts?: {indexURL: string}): any;
      runtime: Runtime
      $_: any;
    }
}

export function registerPython() {
    setupPythonSupport();

    /* These globals are exposed by Starboard Notebook. We can re-use them so we don't have to bundle them again. */
    const runtime = window.runtime;
    const lithtml = runtime.exports.libraries.LitHtml;

    const StarboardTextEditor = runtime.exports.elements.StarboardTextEditor;
    const cellControlsTemplate = runtime.exports.templates.cellControls;
    const icons = runtime.exports.templates.icons;

    const PYTHON_CELL_TYPE_DEFINITION: CellTypeDefinition = {
        name: "Python",
        cellType: ["python", "python3", "ipython3", "pypy", "py"],
        createHandler: (cell: Cell, runtime: Runtime) => new PythonCellHandler(cell, runtime),
    }

    class PythonCellHandler {
        private elements!: CellElements;
        private editor: any;

        private lastRunId = 0;
        private isCurrentlyRunning: boolean = false;
        private isCurrentlyLoadingPyodide: boolean = false;

        cell: Cell;
        runtime: Runtime;

        constructor(cell: Cell, runtime: Runtime) {
            this.cell = cell;
            this.runtime = runtime;
        }

        private getControls(): lithtmlImport.TemplateResult | string {
            const icon = this.isCurrentlyRunning ? icons.ClockIcon : icons.PlayCircleIcon;
            const tooltip = this.isCurrentlyRunning ? "Cell is running": "Run Cell";
            const runButton: ControlButton = {
                icon,
                tooltip,
                callback: () => this.runtime.controls.emit({id: this.cell.id, type: "RUN_CELL"}),
            };
            let buttons = [runButton];

            if (this.isCurrentlyLoadingPyodide) {
                buttons = [{
                    icon: icons.GearsIcon,
                    tooltip: "Downloading and initializing Pyodide",
                    callback: () => {alert("Loading Python runtime. It's 5 to 15 MB in size, so it may take a while. It will be cached for next time.")}
                }, ...buttons]
            }

            return cellControlsTemplate({ buttons });
        }

        attach(params: CellHandlerAttachParameters): void {
            this.elements = params.elements;

            const topElement = this.elements.topElement;
            lithtml.render(this.getControls(), this.elements.topControlsElement);

            this.editor = new StarboardTextEditor(this.cell, this.runtime, {language: "python"});
            topElement.appendChild(this.editor);
        }

        async run() {
            const codeToRun = this.cell.textContent;

            this.lastRunId++;
            const currentRunId = this.lastRunId;
            this.isCurrentlyRunning = true;

            if (getPyodideLoadingStatus() !== "ready") {
                this.isCurrentlyLoadingPyodide = true;
                lithtml.render(this.getControls(), this.elements.topControlsElement);
            }
            const val = await runStarboardPython(this.runtime, codeToRun, this.elements.bottomElement);
            this.isCurrentlyLoadingPyodide = false;
            if (this.lastRunId === currentRunId) {
                this.isCurrentlyRunning = false;
                lithtml.render(this.getControls(), this.elements.topControlsElement);
            }

            return val;
        }

        focusEditor() {
            this.editor.focus();
        }

        async dispose() {
            this.editor.remove();
        }
    
    }

    runtime.definitions.cellTypes.register(PYTHON_CELL_TYPE_DEFINITION.cellType, PYTHON_CELL_TYPE_DEFINITION);
}

export const plugin: StarboardPlugin = {
    id: "starboard-python",
    metadata: {
        name: "Starboard Python",
    },
    exports: {
        getPyodideLoadingStatus: getPyodideLoadingStatus,
        runStarboardPython: runStarboardPython,
        isPyProxy: isPyProxy,
        setGlobalPythonOutputElement: setGlobalPythonOutputElement,
        loadPyodide: loadPyodide,
    },
    async register(opts: StarboardPythonPluginOpts = {}) {
        setPluginOpts(opts);
        registerPython();
    }
}