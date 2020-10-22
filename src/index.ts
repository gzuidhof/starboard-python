import { CellTypeDefinition, CellHandlerAttachParameters, CellElements, Cell } from "starboard-notebook/dist/src/types";
import * as lithtmlImport from "lit-html";
import { Runtime, ControlButton } from "starboard-notebook/dist/src/runtime";

import { loadPyodide } from "./pyodide.js";
import { Pyodide as PyodideType } from "./typings";

// @ts-ignore
import css from "./pyodide-styles.css";

declare global {
    interface Window {
      pyodide: PyodideType;
      runtime: Runtime
      $_: any;
    }
}


export function registerPython() {
    let CURRENT_HTML_OUTPUT_ELEMENT: HTMLElement | undefined = undefined;

    /**
     * Dummy object to act like that used by Iodide.
     * This is used for libraries that output to html (e.g. matplotlib), we imitate
     * iodide's API here. Alternatively we could fork Pyodide and change the Python code, but
     * let's avoid that for as long as possible.
     */
    (window as any).iodide = {
        output: {
            // Create a new element with tagName
            // and add it to an element with id "root".
            element: (tagName: string) => {
                const elem = document.createElement(tagName);
                if (!CURRENT_HTML_OUTPUT_ELEMENT) {
                    console.log("HTML output from pyodide but nowhere to put it, will append to body instead.")
                    document.querySelector("body")!.appendChild(elem);
                } else {
                    CURRENT_HTML_OUTPUT_ELEMENT.appendChild(elem);
                }
                
                return elem;
            }
        }
    };

    /** Naughty matplotlib WASM backend captures and disables contextmenu globally.. hack to prevent that */
    window.addEventListener("contextmenu", function (event) {
        if (event.target instanceof HTMLElement && event.target.id.startsWith("matplotlib_") && event.target.tagName === "CANVAS") {
            return false;
        }
        event.stopPropagation();
    }, true);

    /* These globals are exposed by Starboard Notebook. We can re-use them so we don't have to bundle them again. */
    const runtime = window.runtime;

    const html = runtime.exports.libraries.LitHtml.html;
    const lithtml = runtime.exports.libraries.LitHtml;

    const StarboardTextEditor = runtime.exports.elements.StarboardTextEditor;
    const ConsoleOutputElement = runtime.exports.elements.ConsoleOutputElement;
    const cellControlsTemplate = runtime.exports.templates.cellControls;
    const icons = runtime.exports.templates.icons;

    const PYTHON_CELL_TYPE_DEFINITION: CellTypeDefinition = {
        name: "Python",
        // @ts-ignore Ignore to be removed after updating typings.
        cellType: ["python", "python3", "pypy", "py"],
        createHandler: (cell: Cell, runtime: Runtime) => new PythonCellHandler(cell, runtime),
    }

    function isPyProxy(val: any) {
        return typeof val === 'function' && window.pyodide._module.PyProxy.isPyProxy(val)
    }

    class PythonCellHandler {
        private elements!: CellElements;
        private editor: any;
        private outputElement: any;

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
            const tooltip = this.isCurrentlyRunning ? "Run Cell": "Cell is running";
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
            const pyoPromise = loadPyodide();
            const codeToRun = this.cell.textContent;

            this.lastRunId++;
            const currentRunId = this.lastRunId;
            this.isCurrentlyRunning = true;
            
            this.outputElement = new ConsoleOutputElement();
            this.outputElement.hook(this.runtime.consoleCatcher);
            
            const htmlOutput = document.createElement("div");
            lithtml.render(html`${this.outputElement}${htmlOutput}`, this.elements.bottomElement);
            CURRENT_HTML_OUTPUT_ELEMENT = htmlOutput;

            // We load the pyodide runtime and show an icon while that is happening..
            this.isCurrentlyLoadingPyodide = true;
            lithtml.render(this.getControls(), this.elements.topControlsElement);
            await pyoPromise;
            this.isCurrentlyLoadingPyodide = false;
            lithtml.render(this.getControls(), this.elements.topControlsElement);

            let val = undefined;
            try {
                val = await window.pyodide.runPythonAsync(codeToRun, (msg) => console.log(msg), (err) => console.error("ERROR", err));
                window.$_ = val;

                if (val !== undefined) {
                    if (val instanceof HTMLElement) {
                        htmlOutput.appendChild(val);  
                    }
                    else if (isPyProxy(val)) {
                        let hadHTMLOutput = false;
                        if (val._repr_html_ !== undefined) {
                            let result = val._repr_html_();
                            if (typeof result === 'string') {
                                let div = document.createElement('div');
                                div.className = 'rendered_html';
                                div.appendChild(new DOMParser().parseFromString(result, 'text/html').body.firstChild as any);
                                htmlOutput.appendChild(div);
                                hadHTMLOutput = true;
                            }
                        }
                        if (!hadHTMLOutput) {
                            this.outputElement.addEntry({
                                method: "result",
                                data: [val]
                            });
                        }
                    } else {
                        this.outputElement.addEntry({
                            method: "result",
                            data: [val]
                        });
                    }
                }
            } catch(e) {
                this.outputElement.addEntry({
                    method: "error",
                    data: [e]
                });
            }

            // Not entirely sure this has to be awaited, is any output delayed by a tick from pyodide?
            await this.outputElement.unhookAfterOneTick(this.runtime.consoleCatcher);

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


    const styleSheet = document.createElement("style")
    styleSheet.id = "pyodide-styles";
    styleSheet.innerHTML = css
    document.head.appendChild(styleSheet)
    // @ts-ignore
    PYTHON_CELL_TYPE_DEFINITION.cellType.forEach((cellTypeIdentifier: string) => {
        runtime.definitions.cellTypes.register(cellTypeIdentifier, PYTHON_CELL_TYPE_DEFINITION);
    })
    
}
