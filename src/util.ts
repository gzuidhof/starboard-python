export function isPyProxy(val: any) {
    return typeof val === 'function' && window.pyodide._module.PyProxy.isPyProxy(val)
}
