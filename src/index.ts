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
        name: "Python (experimental)",
        cellType: "py",
        createHandler: (cell: Cell, runtime: Runtime) => new PythonCellHandler(cell, runtime),
    }

    function gearsIcon({ width = 24, height = 24, hidden = false, title = 'Gears Icon'} = {}) {
        return html`
        <svg xmlns="http://www.w3.org/2000/svg" height=${height} viewBox="0 0 18 18" width=${width} fill="currentColor" aria-label=${title} aria-hidden="${hidden ? 'true' : 'false'}">
    <rect opacity="0" width="18" height="18" /><path class="a" d="M8.5965,12.893H7.534a3.0709,3.0709,0,0,0-.45-1.0895l.7565-.7565a.3035.3035,0,0,0,0-.429l-.46-.46a.3035.3035,0,0,0-.429,0l-.7555.757a3.07263,3.07263,0,0,0-1.089-.45V9.4035A.3035.3035,0,0,0,4.8035,9.1h-.607a.3035.3035,0,0,0-.3035.3035V10.466a3.07263,3.07263,0,0,0-1.089.45l-.7565-.758a.3035.3035,0,0,0-.429,0l-.46.46a.3035.3035,0,0,0,0,.429l.7565.757a3.0709,3.0709,0,0,0-.45,1.0895H.4035A.3035.3035,0,0,0,.1,13.197h0v.607a.3035.3035,0,0,0,.3035.3035H1.466a3.0709,3.0709,0,0,0,.45,1.0895l-.758.756a.3035.3035,0,0,0,0,.429l.46.46a.3035.3035,0,0,0,.429,0l.757-.757a3.07263,3.07263,0,0,0,1.089.45v1.0625a.3035.3035,0,0,0,.3035.3035h.607a.3035.3035,0,0,0,.3035-.3035V16.534a3.07263,3.07263,0,0,0,1.089-.45l.7565.7565a.3035.3035,0,0,0,.429,0l.46-.46a.3035.3035,0,0,0,0-.429L7.085,15.196a3.0709,3.0709,0,0,0,.45-1.0895H8.5975a.3035.3035,0,0,0,.3035-.3035v-.6065a.3035.3035,0,0,0-.3035-.3035ZM4.5,15.082A1.582,1.582,0,1,1,6.082,13.5h0A1.582,1.582,0,0,1,4.5,15.082Z" />
    <path d="M17.681,7.453l-1.4-.5715a4.37836,4.37836,0,0,0-.006-1.6785l1.405-.591a.4325.4325,0,0,0,.231-.566l-.361-.8545a.432.432,0,0,0-.5655-.23121l-.0005.00021L15.5785,3.55A4.38056,4.38056,0,0,0,14.383,2.372l.5715-1.4a.4325.4325,0,0,0-.237-.5635l-.8-.3265a.4325.4325,0,0,0-.5635.237l-.5715,1.4a4.38055,4.38055,0,0,0-1.6785.006L10.512.322A.432.432,0,0,0,9.9465.09079L9.946.091,9.0915.45a.4325.4325,0,0,0-.231.566L9.45,2.4215a4.3765,4.3765,0,0,0-1.178,1.196l-1.4-.5715a.4325.4325,0,0,0-.5635.237l-.3265.8a.4325.4325,0,0,0,.237.5635l1.4.5715a4.37836,4.37836,0,0,0,.006,1.6785l-1.405.591a.4325.4325,0,0,0-.231.566l.3595.854a.432.432,0,0,0,.5655.23121l.0005-.00021,1.405-.591a4.38043,4.38043,0,0,0,1.196,1.178l-.5715,1.4a.4325.4325,0,0,0,.237.5635l.8.3265a.4325.4325,0,0,0,.5635-.237l.5715-1.4a4.37757,4.37757,0,0,0,1.6785-.006l.591,1.405a.432.432,0,0,0,.5655.23121l.0005-.00021.8545-.3595a.4325.4325,0,0,0,.231-.566L14.45,9.6785A4.37607,4.37607,0,0,0,15.628,8.483l1.4.5715a.432.432,0,0,0,.5633-.23652l.0002-.00048.3265-.8a.4325.4325,0,0,0-.23624-.56419Zm-5.731.691A2.094,2.094,0,1,1,14.044,6.05,2.094,2.094,0,0,1,11.95,8.144Z" />
    </svg>`
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
                    icon: gearsIcon,
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
            const output: {method: string; data: any[]}[] = [];
            this.outputElement.logs = output;

            const htmlOutput = document.createElement("div");
            lithtml.render(html`${this.outputElement}${htmlOutput}`, this.elements.bottomElement);
            CURRENT_HTML_OUTPUT_ELEMENT = htmlOutput;

            // For deduplication, limits the updates to only one per animation frame.
            let hasUpdateScheduled = false;
            const consoleCallback = (msg: any) => {
                output.push(msg);

                if (!hasUpdateScheduled) {
                    window.setTimeout(() => {
                        if (this.outputElement) {
                            this.outputElement.logs = [...output];
                        }
                        hasUpdateScheduled = true;
                    });
                }
            };

            // We load the pyodide runtime and show an icon while that is happening..
            this.isCurrentlyLoadingPyodide = true;
            lithtml.render(this.getControls(), this.elements.topControlsElement);
            await pyoPromise;
            this.isCurrentlyLoadingPyodide = false;
            lithtml.render(this.getControls(), this.elements.topControlsElement);

            this.runtime.consoleCatcher.hook(consoleCallback);

            let val = undefined;
            try {
                val = await window.pyodide.runPythonAsync(codeToRun, (msg) => console.log(msg), (err) => console.error("ERROR", err));
                window.$_ = val;

                if (val !== undefined) {
                    if (isPyProxy(val)) {
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
                            output.push({
                                method: "result",
                                data: [val]
                            });
                        }

                    } else {
                        output.push({
                            method: "result",
                            data: [val]
                        });
                    }

                }
            } catch(e) {
                output.push({
                    method: "error",
                    data: [e]
                });
            }

            window.setTimeout(() => 
                this.runtime.consoleCatcher.unhook(consoleCallback)
            );

            if (this.lastRunId === currentRunId) {
                this.isCurrentlyRunning = false;
                lithtml.render(this.getControls(), this.elements.topControlsElement);
            }

            this.outputElement.logs = [...output];

            return val
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

    runtime.definitions.cellTypes.register("py", PYTHON_CELL_TYPE_DEFINITION);
}
