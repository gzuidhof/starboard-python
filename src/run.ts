import { Runtime } from "starboard-notebook/dist/src/types";
import { loadPyodide, setGlobalPythonOutputElement as setGlobalPythonHtmlOutputElement, setupPythonSupport } from "./global";
import { isPyProxy } from "./util";

export async function runStarboardPython(runtime: Runtime, codeToRun: string, renderOutputIntoElement: HTMLElement): Promise<any>{
    setupPythonSupport();
    const pyoPromise = loadPyodide();

    const outputElement = new runtime.exports.elements.ConsoleOutputElement();
    outputElement.hook(runtime.consoleCatcher);

    const htmlOutput = document.createElement("div");
    const lithtml = runtime.exports.libraries.LitHtml;
    const html = lithtml.html;
    
    lithtml.render(html`${outputElement}${htmlOutput}`, renderOutputIntoElement);
    setGlobalPythonHtmlOutputElement(htmlOutput);

    await pyoPromise;

    let val = undefined;
    try {
        val = await window.pyodide.runPythonAsync(codeToRun/*, (msg) => console.log(msg), (err) => console.error("ERROR", err)*/);
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
                        div.className = 'rendered_html cell-output-html';
                        div.appendChild(new DOMParser().parseFromString(result, 'text/html').body.firstChild as any);
                        htmlOutput.appendChild(div);
                        hadHTMLOutput = true;
                    }
                } else if (val._repr_latex_ !== undefined) {
                    let result = val._repr_latex_();
                    if (typeof result === 'string') {
                        let div = document.createElement('div');
                        div.className = 'rendered_html cell-output-html';
                        const katex = await runtime.exports.libraries.async.KaTeX();
                        if (result.startsWith("$$")) {
                            result = result.substr(2, result.length-3)
                            katex.render(result, div, {"throwOnError": false, "errorColor": " #cc0000", displayMode: true});
                        } else if (result.startsWith("$")) {
                            result = result.substr(1, result.length-2)
                            katex.render(result, div, {"throwOnError": false, "errorColor": " #cc0000", displayMode: false});
                        }
                        htmlOutput.appendChild(div);
                        hadHTMLOutput = true;
                    }
                }
                if (!hadHTMLOutput) {
                    outputElement.addEntry({
                        method: "result",
                        data: [val]
                    });
                }
            } else {
                outputElement.addEntry({
                    method: "result",
                    data: [val]
                });
            }
        }
    } catch(e) {
        outputElement.addEntry({
            method: "error",
            data: [e.toString()]
        });
    }

    // Not entirely sure this has to be awaited, is any output delayed by a tick from pyodide?
    await outputElement.unhookAfterOneTick(runtime.consoleCatcher);

    return val;
}
