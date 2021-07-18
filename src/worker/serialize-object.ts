// TODO: Find some better way of doing this (maybe by using a library or something)
// It should be able to handle more than just this

const decoder = new TextDecoder("utf-8");
const encoder = new TextEncoder();

export function serialize(obj: any): Uint8Array {
  const text = JSON.stringify(obj);
  return encoder.encode(text);
}

export function deserialize(buffer: Uint8Array, size: number): any {
  const text = decoder.decode(buffer.slice(0, size));
  return JSON.parse(text);
}
