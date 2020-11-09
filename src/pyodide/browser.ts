import { loadPyodide } from "./loader";

(self as any).languageLoaderPlugin = loadPyodide();
