// @ts-ignore
import css from "./pyodide-styles.css";

import "./pyodide";
import { getPluginOpts } from "./opts";

let setupStatus: "unstarted" | "started" | "completed" = "unstarted"
let loadingStatus: "unstarted" | "loading" | "ready" = "unstarted";
let pyodideLoadSingleton: Promise<void> | undefined = undefined;

// A global value that is the current HTML element to attach matplotlib figures to..
// perhaps this can be done in a cleaner way.
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

export async function loadPyodide(artifactsUrl?: string) {
    if (pyodideLoadSingleton) return pyodideLoadSingleton

    loadingStatus = "loading";
    const artifactsURL = artifactsUrl || getPluginOpts().artifactsUrl || (window as any).pyodideArtifactsUrl || "https://cdn.jsdelivr.net/pyodide/v0.17.0/full/"
    pyodideLoadSingleton = (window as any).loadPyodide({indexURL: artifactsURL}) as Promise<void>;
    await pyodideLoadSingleton;
    loadingStatus = "ready";

    // TODO: perhaps we can do this in a cleaner way by passing an output element to runPython or something.
    (window.pyodide as any).matplotlibHelpers = {
        createElement: (tagName: string) => {
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

    return pyodideLoadSingleton;
}

export function getPyodideLoadingStatus() {
    return loadingStatus;
}
