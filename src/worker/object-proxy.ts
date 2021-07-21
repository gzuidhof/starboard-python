import { v4 as uuidv4 } from "uuid";
import { AsyncMemory } from "./async-memory";

/**
 * Lets one other thread access the objects on this thread.
 * Usually runs on the main thread.
 */
export class ObjectProxyHost {
  readonly rootReferences = new Map<string, any>();
  readonly temporaryReferences = new Map<string, any>();
  readonly memory: AsyncMemory;

  constructor(memory: AsyncMemory) {
    this.memory = memory;
  }

  registerRootObject(value: any) {
    const id = uuidv4();
    this.rootReferences.set(id, value);
    return id;
  }

  registerTempObject(value: any) {
    const id = uuidv4();
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

  serializeMemory(value: any, buffer: SharedArrayBuffer) {
    // Cases
    // number https://stackoverflow.com/questions/2003493/javascript-float-from-to-bits
    // undefined
    // null
    // boolean
    // date https://github.com/gzuidhof/console-feed/blob/b02d43a5d0e4eb61b8fd125015645dd77c94b24c/src/Transform/replicator/index.ts#L331-L339
    // string (arbitrary, known length)
    // bigint BigInt("9007199254740991") and .valueOf
    //
    // array, object, symbol, function, error, typedarray, dom element, map, set, ... (will cause a temp reference to get registered)
    //
    // too big for the buffer, then we need to serialize a part of it, write it into the buffer,
    // wait until the other side has read it and continue writing
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

      // TODO: Write the result back through asyncmemory
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
    // TODO: Implement this

    // Ensure buffer size
    const numberOfBytes = memory.readSize();
    if (numberOfBytes > memory.sharedMemory.byteLength) {
      // TODO: Streaming
      self.postMessage({
        type: "data-buffer",
        dataBuffer: memory.resize(numberOfBytes),
      } as WorkerResponse);
    } else {
      self.postMessage({
        type: "data-buffer",
      } as WorkerResponse);
    }
    // Wait (blocking)
    memory.waitForWorker();
    // Read the result
    const result = deserialize(memory.memory, numberOfBytes);

    // TODO: Optionally wrap it in a proxy. Oh boi

    return result;
  }

  /**
   * Calls a Reflect function on an object from the other thread
   * @returns The result of the operation, can be a primitive or a proxy
   */
  private proxyReflect(method: keyof typeof Reflect, target: any, args: any[]) {
    this.memory.lock();
    this.postMessage({
      type: "proxy-reflect",
      method: "get",
      target: this.serializePostMessage(target),
      arguments: args.map((v) => this.serializePostMessage(v)),
    });
    this.memory.waitForSize();
    const value = this.deserializeMemory(this.memory);
    return value;
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
        // TODO: Uh oh, I need to distinguish between object and function proxies
        // For function objects
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

// Cases
// number https://stackoverflow.com/questions/2003493/javascript-float-from-to-bits
// undefined
// null
// boolean
// date https://github.com/gzuidhof/console-feed/blob/b02d43a5d0e4eb61b8fd125015645dd77c94b24c/src/Transform/replicator/index.ts#L331-L339
// string (arbitrary, known length)
// bigint BigInt("9007199254740991") and .valueOf
//
// array, object, symbol, function, error, typedarray, dom element, map, set, ... (grab the id from those, otherwise try to directly put them into the result)
//

function isSimplePrimitive(value: any) {
  if (value === undefined) {
    return true;
  } else if (value === null) {
    return true;
  } else if (value === true) {
    return true;
  } else if (value === false) {
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

export type ProxyMessage = {
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
};
