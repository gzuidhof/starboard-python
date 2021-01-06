export async function resolveImports(code: string) {
    const pyodideModule: any = self.pyodide.pyimport("pyodide");

    const imports = pyodideModule.find_imports(code);
    console.log(imports)
}