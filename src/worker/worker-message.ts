export type PyodideWorkerOptions = {
  artifactsUrl?: string;
};

export type PyodideWorkerResult = {
  display?: "default" | "html" | "latex";
  value: any; // TODO: Normal objects can be normal objects, python proxies might need a bit of comlink
};
