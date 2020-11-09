// @ts-ignore
import css from "./pyodide-styles.css";
import { getBaseUrl } from "./pyodide/util";

let hasPrefetched = false;

export function prefetchPyodideFiles() {
    if (!hasPrefetched) {
        const baseUrl = getBaseUrl();
        for (const file of ["pyodide.asm.wasm", "pyodide.asm.js", "pyodide.asm.data", "pyodide.asm.data.js", "packages.json"]) {
            const link = document.createElement(`link`);
            link.rel = `prefetch`;
            link.href = `${baseUrl}${file}`;
            document.head.appendChild(link);
        }
        hasPrefetched = true;
    }
}

export function injectPyodideStyles() {
    if (!document.querySelector("#pyodide-styles")) {
        const styleSheet = document.createElement("style")
        styleSheet.id = "pyodide-styles";
        styleSheet.innerHTML = css
        document.head.appendChild(styleSheet)
    }
}
