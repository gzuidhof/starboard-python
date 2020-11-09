export interface FlatPromise<T, E> {
    resolve: (value?: T) => void;
    reject: (reason?: E) => void;
    promise: Promise<T>;
}

/**
 * Creates a promise with the resolve and reject function outside of it, useful for tasks that may complete at any time.
 * Based on MIT licensed https://github.com/arikw/flat-promise, with typings added by gzuidhof.
 * @param executor 
 */
export function flatPromise<T = void, E = void>(
    executor?: (resolve: (value?: T) => void, reject: (reason?: E) => void) => void | Promise<void>
): FlatPromise<T, E> {
    let resolve!: (value?: T) => void;
    let reject!: (reason?: E) => void;

    const promise: Promise<T> = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });

    if (executor) {
        executor(resolve, reject);
    }

    return { promise, resolve, reject };
}
