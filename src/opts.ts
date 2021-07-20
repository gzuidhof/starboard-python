export type StarboardPythonPluginOpts = {
  artifactsUrl?: string;
  workerUrl?: string;
};

// Global singleton
let pluginOpts: StarboardPythonPluginOpts = {};

export function getPluginOpts() {
  return pluginOpts;
}

export function setPluginOpts(opts: StarboardPythonPluginOpts) {
  pluginOpts = opts;
}
