import { KernelSource } from "./worker/kernel";

export type StarboardPythonPluginOpts = {
  artifactsUrl?: string;
  workerSource?: KernelSource;
  runInMainThread?: boolean;
};

// Global singleton
let pluginOpts: StarboardPythonPluginOpts = {};

export function getPluginOpts() {
  return pluginOpts;
}

export function setPluginOpts(opts: StarboardPythonPluginOpts) {
  pluginOpts = opts;
}
