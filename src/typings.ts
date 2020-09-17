export declare type Pyodide = {
    runPython(code: string, messageCallback?: (msg: any) => void, errorCallback?: (err: any) => void): any;
    runPythonAsync(code: string, messageCallback?: (msg: any) => void, errorCallback?: (err: any) => void): Promise<any>;
    loadPackage(names: string, messageCallback?: (msg: any) => void, errorCallback?: (err: any) => void): Promise<any>;
    loadedPackages(packages: string[]): any;
    globals: any;
    pyimport: () => any;
    version: () => string;
    autocomplete: any;
    checkABI: any;
    _module: any;
}