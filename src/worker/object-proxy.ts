import { v4 as uuidv4 } from "uuid";
import { AsyncMemory } from "./async-memory";

// TODO: Comment here https://github.com/Gaubee/blog/issues/118

const SERIALIZATION = {
  UNDEFINED: 0,
  NULL: 1,
  FALSE: 2,
  TRUE: 3,
  NUMBER: 4,
  DATE: 5,
  STRING: 10,
  BIGINT: 11,
  OBJECT: 255,
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8");

const encodeFloat = useFloatEncoder();
const decodeFloat = useFloatDecoder();

function useFloatEncoder() {
  // https://stackoverflow.com/a/14379836/3492994
  const temp = new ArrayBuffer(8);
  const tempFloat64 = new Float64Array(temp);
  const tempUint8 = new Uint8Array(temp);

  return function (value: number): Uint8Array {
    tempFloat64[0] = value;
    return tempUint8;
  };
}

function useFloatDecoder() {
  const temp = new ArrayBuffer(8);
  const tempFloat64 = new Float64Array(temp);
  const tempUint8 = new Uint8Array(temp);

  return function (value: Uint8Array): number {
    tempUint8.set(value);
    return tempFloat64[0];
  };
}

/**
 * Lets one other thread access the objects on this thread.
 * Usually runs on the main thread.
 */
export class ObjectProxyHost {
  readonly rootReferences = new Map<string, any>();
  readonly temporaryReferences = new Map<string, any>();
  readonly memory: AsyncMemory;

  private writeMemoryContinuation?: () => void;

  constructor(memory: AsyncMemory) {
    this.memory = memory;
  }

  /** Creates a valid, random id for a given object */
  private getId(value: any) {
    return uuidv4() + "-" + (typeof value === "function" ? "f" : "o");
  }

  registerRootObject(value: any) {
    const id = this.getId(value);
    this.rootReferences.set(id, value);
    return id;
  }

  registerTempObject(value: any) {
    const id = this.getId(value);
    this.temporaryReferences.set(id, value);
    return id;
  }

  clearTemporary() {
    this.temporaryReferences.clear();
  }

  getObject(id: string) {
    return this.rootReferences.get(id) ?? this.temporaryReferences.get(id);
  }

  // A serializePostMessage isn't needed here, because all we're ever going to pass to the worker are ids

  serializeMemory(value: any, memory: AsyncMemory) {
    memory.writeSize(8); // Anything that fits into 8 bytes is fine

    // Simple primitives. Guaranteed to fit into the shared memory.
    if (value === undefined) {
      memory.memory[0] = SERIALIZATION.UNDEFINED;
      memory.unlockSize();
    } else if (value === null) {
      memory.memory[0] = SERIALIZATION.NULL;
      memory.unlockSize();
    } else if (value === false) {
      memory.memory[0] = SERIALIZATION.FALSE;
      memory.unlockSize();
    } else if (value === true) {
      memory.memory[0] = SERIALIZATION.TRUE;
      memory.unlockSize();
    } else if (typeof value === "number") {
      memory.memory[0] = SERIALIZATION.NUMBER;
      memory.memory.set(encodeFloat(value), 1);
      memory.unlockSize();
    } else if (value instanceof Date) {
      memory.memory[0] = SERIALIZATION.DATE;
      const time = value.getTime();
      memory.memory.set(encodeFloat(time), 1);
      memory.unlockSize();
    }
    // Variable length primitives. Not guaranteed to fit into the shared memory, but we know their size.
    else if (typeof value === "string") {
      memory.memory[0] = SERIALIZATION.STRING;
      // A string encoded in utf-8 uses at most 4 bytes per character
      // Actually, I could use the encodeInto API and then check if {read} < string.length
      if (value.length * 4 <= memory.memory.byteLength) {
        const { written } = textEncoder.encodeInto(value, memory.memory.subarray(1)); // TODO: Wait what the heck, this doesn't work on Opera?
        if (written === undefined) {
          throw new Error("Text encoder failed to report the number of written bytes");
        }
        memory.writeSize(written);
        memory.unlockSize();
      } else {
        const bytes = textEncoder.encode(value);
        const memorySize = memory.memory.byteLength;
        let offset = 0;
        let remainingBytes = bytes.byteLength;
        memory.memory.set(bytes.subarray(offset, memorySize - 1), 1);
        offset += memorySize - 1;
        remainingBytes -= memorySize - 1;
        this.writeMemoryContinuation = () => {
          if (remainingBytes > 0) {
            memory.memory.set(bytes.subarray(offset, memorySize), 0);
            offset += memorySize;
            remainingBytes -= memorySize;
          } else {
            this.writeMemoryContinuation = undefined;
          }
          memory.unlockSize();
        };
        memory.writeSize(bytes.byteLength);
        memory.unlockSize();
      }
    } else if (typeof value === "bigint") {
      memory.memory[0] = SERIALIZATION.BIGINT;
      const digits = value.toString();
      // TODO: Implement this (just like the text ^)
      console.warn("Not implemented");
      memory.unlockSize();
    }
    // Object. Serialized as ID, guaranteed to fit into shared memory
    else {
      memory.memory[0] = SERIALIZATION.OBJECT;
      const id = this.registerTempObject(value);
      const { written } = textEncoder.encodeInto(id, memory.memory.subarray(1));
      memory.writeSize(written ?? 128);
      memory.unlockSize();
    }
  }

  /**
   * Deserializes an object that was sent through postMessage
   */
  deserializePostMessage(value: any): any {
    if (typeof value === "object" && value !== null) {
      // Special cases
      if (value.id) return this.getObject(value.id);
      if (value.value) return value.value;
    }
    // It's a primitive
    return value;
  }

  handleProxyMessage(message: ProxyMessage, memory: AsyncMemory) {
    if (message.type === "proxy-reflect") {
      const method = Reflect[message.method];
      const args = (message.arguments ?? []).map((v) => this.deserializePostMessage(v));
      const result = (method as any)(this.getObject(message.target), ...args);
      // Write result to shared memory
      this.serializeMemory(result, memory);
    } else if (message.type === "proxy-shared-memory") {
      // Write remaining data to shared memory
      if (this.writeMemoryContinuation === undefined) {
        console.warn("No more data to write to shared memory");
      } else {
        this.writeMemoryContinuation();
      }
    } else {
      console.warn("Unknown proxy message", message);
    }
  }
}

/**
 * Allows this thread to access objects from another thread.
 * Must run on a worker thread.
 */
export class ObjectProxyClient {
  readonly objectId = Symbol("id");
  readonly memory: AsyncMemory;
  readonly postMessage: (message: ProxyMessage) => void;
  constructor(memory: AsyncMemory, postMessage: (message: ProxyMessage) => void) {
    this.memory = memory;
    this.postMessage = postMessage;
  }

  /**
   * Serializes an object so that it can be sent using postMessage
   */
  serializePostMessage(value: any): any {
    if (isSimplePrimitive(value)) {
      return value;
    } else if (isVariableLengthPrimitive(value)) {
      return value;
    } else if (value[this.objectId]) {
      return { id: value[this.objectId] };
    } else {
      return { value: value }; // Might fail to get serialized
    }
  }

  /**
   * Deserializes an object from a shared array buffer. Can return a proxy.
   */
  deserializeMemory(memory: AsyncMemory) {
    const numberOfBytes = memory.readSize();

    // Uint8Arrays have the convenient property of having 1 byte per element.
    let resultBytes: Uint8Array;
    if (numberOfBytes <= memory.sharedMemory.byteLength) {
      resultBytes = memory.memory;
    } else {
      const memorySize = memory.sharedMemory.byteLength;
      let offset = 0;
      let remainingBytes = numberOfBytes;
      resultBytes = new Uint8Array(numberOfBytes);
      while (remainingBytes >= memorySize) {
        resultBytes.set(memory.memory, offset);
        offset += memorySize;
        remainingBytes -= memorySize;
        memory.lockSize();
        this.postMessage({ type: "proxy-shared-memory" });
        memory.waitForSize();
      }
      if (remainingBytes > 0) {
        resultBytes.set(memory.memory.subarray(0, remainingBytes), offset);
      }
    }

    // Simple primitives. Guaranteed to fit into the shared memory.
    if (resultBytes[0] === SERIALIZATION.UNDEFINED) {
      return undefined;
    } else if (resultBytes[0] === SERIALIZATION.NULL) {
      return null;
    } else if (resultBytes[0] === SERIALIZATION.FALSE) {
      return false;
    } else if (resultBytes[0] === SERIALIZATION.TRUE) {
      return true;
    } else if (resultBytes[0] === SERIALIZATION.NUMBER) {
      return decodeFloat(resultBytes.subarray(1, 9));
    } else if (resultBytes[0] === SERIALIZATION.DATE) {
      const date = new Date();
      date.setTime(decodeFloat(resultBytes.subarray(1, 9)));
      return date;
    }
    // Variable length primitives. We already read all of their data
    else if (resultBytes[0] === SERIALIZATION.STRING) {
      return textDecoder.decode(resultBytes.subarray(1));
    } else if (resultBytes[0] === SERIALIZATION.BIGINT) {
      return BigInt(textDecoder.decode(resultBytes.subarray(1)));
    }
    // Object. Serialized as ID, guaranteed to fit into shared memory
    else if (resultBytes[0] === SERIALIZATION.OBJECT) {
      const id = textDecoder.decode(resultBytes.subarray(1));
      return this.getObjectProxy(id);
    } else {
      console.warn("Unknown type", resultBytes[0]);
      return null;
    }
  }

  /**
   * Calls a Reflect function on an object from the other thread
   * @returns The result of the operation, can be a primitive or a proxy
   */
  private proxyReflect(method: keyof typeof Reflect, target: any, args: any[]) {
    this.memory.lock();
    this.postMessage({
      type: "proxy-reflect",
      method: method,
      target: this.serializePostMessage(target),
      arguments: args.map((v) => this.serializePostMessage(v)),
    });
    this.memory.waitForSize();
    const value = this.deserializeMemory(this.memory);
    this.memory.unlockWorker();
    return value;
  }

  /** Checks if an id encodes a function. Mostly a silly hack to ensure that proxies can work as expected */
  private isFunction(id: string) {
    return id.endsWith("-f");
  }

  /**
   * Gets a proxy object for a given id
   */
  getObjectProxy<T = any>(id: string): T {
    // TODO: deep proxy https://github.com/samvv/js-proxy-deep
    const client = this;

    return new Proxy(
      {},
      {
        get(target, prop, receiver) {
          if (prop === client.objectId) {
            return id;
          }

          /* const value = Reflect.get(target, prop, receiver); */
          const value = client.proxyReflect("get", target, [prop, receiver]);

          if (typeof value !== "function") return value;
          /* Functions need special handling
           * https://stackoverflow.com/questions/27983023/proxy-on-dom-element-gives-error-when-returning-functions-that-implement-interfa
           * https://stackoverflow.com/questions/37092179/javascript-proxy-objects-dont-work
           */
          return new Proxy(value, {
            apply(_, thisArg, args) {
              // thisArg: the object the function was called with. Can be the proxy or something else
              // receiver: the object the propery was gotten from. Is always the proxy or something inheriting from the proxy
              // target: the original object

              // TODO: Or maybe thisArg[client.objectId] === receiver[client.objectId]?
              const calledWithProxy = thisArg === receiver;

              /* return Reflect.apply(value, calledWithProxy ? target : thisArg, args); */
              const value = client.proxyReflect("apply", calledWithProxy ? target : thisArg, args ?? []);
              return value;
            },
          });
        },
        // TODO:
        /*set(target, prop, value, receiver) {
        return Reflect.set(target, prop, value, receiver);
      },
      ownKeys(target) {
        return Reflect.ownKeys(target);
      },
      has(target, prop) {
        return Reflect.has(target, prop);
      },
      defineProperty(target, prop, attributes) {
        return Reflect.defineProperty(target, prop, attributes);
      },
      deleteProperty(target, prop) {
        return Reflect.deleteProperty(target, prop);
      },
      getOwnPropertyDescriptor(target, prop) {
        return Reflect.getOwnPropertyDescriptor(target, prop);
      },
      isExtensible(target) {
        return Reflect.isExtensible(target);
      },
      preventExtensions(target) {
        return Reflect.preventExtensions(target);
      },
      getPrototypeOf(target) {
        return Reflect.getPrototypeOf(target);
      },
      setPrototypeOf(target, proto) {
        return Reflect.setPrototypeOf(target, proto);
      },*/

        // For function objects (client.isFunction(id))
        /*apply(target, thisArg, argumentsList) {
        return Reflect.apply(target, thisArg, argumentsList);
      },
      construct(target, argumentsList, newTarget) {
        return Reflect.construct(target, argumentsList, newTarget)
      }*/
      }
    ) as T;
  }
}

function isSimplePrimitive(value: any) {
  if (value === undefined) {
    return true;
  } else if (value === null) {
    return true;
  } else if (value === false) {
    return true;
  } else if (value === true) {
    return true;
  } else if (typeof value === "number") {
    return true;
  } else if (value instanceof Date) {
    return true;
  } else {
    return false;
  }
}

function isVariableLengthPrimitive(value: any) {
  if (typeof value === "string") {
    return true;
  } else if (typeof value === "bigint") {
    return true;
  }
}

export type ProxyMessage =
  | {
      type: "proxy-reflect";
      method: keyof typeof Reflect;
      /**
       * An object id
       */
      target: string;
      /**
       * Further parameters. Have to be serialized
       */
      arguments?: any[];
    }
  | {
      /** For requesting more bytes from the shared memory*/
      type: "proxy-shared-memory";
    };
