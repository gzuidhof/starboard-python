export declare type Pyodide = {
  runPython(code: string, messageCallback?: (msg: any) => void, errorCallback?: (err: any) => void): any;
  runPythonAsync(code: string, messageCallback?: (msg: any) => void, errorCallback?: (err: any) => void): Promise<any>;
  loadPackage(names: string, messageCallback?: (msg: any) => void, errorCallback?: (err: any) => void): Promise<any>;
  loadedPackages(packages: string[]): any;
  globals: any;

  version: () => string;
  checkABI: any;
  _module: any;
  isPyProxy(v: any): boolean;
};
