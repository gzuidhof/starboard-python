// @ts-ignore
import css from "./pyodide-styles.css";

import {loadPyodide as loadPy} from "./pyodide";

let setupStatus: "unstarted" | "started" | "completed" = "unstarted"
let loadingStatus: "unstarted" | "loading" | "ready" = "unstarted";

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

    const styleSheet = document.createElement("style")
    styleSheet.id = "pyodide-styles";
    styleSheet.innerHTML = css
    document.head.appendChild(styleSheet)

    setupStatus = "completed";
}

export async function loadPyodide() {
    loadingStatus = "loading";
    await loadPy() as Promise<void>;
    loadingStatus = "ready";
}

export function getPyodideLoadingStatus() {
    return loadingStatus;
}
