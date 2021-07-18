// https://v8.dev/features/atomics

/**
 * Web Worker Usage:
 * 1. Lock "web worker"
 * 2. Lock "shared memory"
 * 3. Notify main thread (Main thread does stuff)
 * 4. Wait for "shared memory" unlock
 * 5. Read size buffer
 * 6. Ensure that the shared memory is large enough
 * 7. Notify main thread (Main thread does stuff)
 * 8. Wait for "web worker" unlock
 * 9. Read shared memory
 *
 * Main Thread Usage:
 * 1. Get notification
 * 2. Do operations
 * 3. Serialize result
 * 4. Write size into the size buffer (TODO: About here-ish, it should be possible to directly write the data & skip some stuff)
 * 5. Unlock "shared memory" (Worker does stuff)
 * 6. Get notification
 * 7. Write data into shared memory
 * 8. Unlock "web worker" (Worker does stuff)
 */
export class AsyncMemory {
  static LOCK_WORKER_INDEX = 0;
  static LOCK_SIZE_INDEX = 2;
  static SIZE_INDEX = 4;
  static UNLOCKED = 0;
  static LOCKED = 1;

  sharedLock: SharedArrayBuffer;
  lockAndSize: Int32Array;

  sharedMemory: SharedArrayBuffer;
  memory: Uint8Array;

  constructor(sharedLock: SharedArrayBuffer, sharedMemory?: SharedArrayBuffer) {
    this.sharedLock = sharedLock;
    this.lockAndSize = new Int32Array(this.sharedLock);
    if (this.lockAndSize.length < 8) {
      throw new Error("Expected an array with at least 8x32 bits");
    }

    this.sharedMemory = sharedMemory ?? new SharedArrayBuffer(100);
    this.memory = new Uint8Array(this.sharedMemory);
  }

  lock() {
    this.lockWorker();
    this.lockSize();
    Atomics.store(this.lockAndSize, AsyncMemory.SIZE_INDEX, 0);
  }

  private lockWorker() {
    while (true) {
      const oldValue = Atomics.compareExchange(
        this.lockAndSize,
        AsyncMemory.LOCK_WORKER_INDEX,
        AsyncMemory.UNLOCKED, // old value
        AsyncMemory.LOCKED // new value
      );
      if (oldValue === AsyncMemory.UNLOCKED) {
        return;
      }
      Atomics.wait(
        this.lockAndSize,
        AsyncMemory.LOCK_WORKER_INDEX,
        AsyncMemory.LOCKED // another thread is holding the lock
      );
    }
  }

  private lockSize() {
    while (true) {
      const oldValue = Atomics.compareExchange(
        this.lockAndSize,
        AsyncMemory.LOCK_SIZE_INDEX,
        AsyncMemory.UNLOCKED, // old value
        AsyncMemory.LOCKED // new value
      );
      if (oldValue === AsyncMemory.UNLOCKED) {
        return;
      }
      Atomics.wait(
        this.lockAndSize,
        AsyncMemory.LOCK_SIZE_INDEX,
        AsyncMemory.LOCKED // another thread is holding the lock
      );
    }
  }

  /**
   * Only legal if the worker is locked
   */
  waitForSize() {
    Atomics.wait(this.lockAndSize, AsyncMemory.LOCK_SIZE_INDEX, AsyncMemory.LOCKED);
  }

  /**
   * Only legal if the size has been unlocked
   */
  waitForWorker() {
    Atomics.wait(this.lockAndSize, AsyncMemory.LOCK_WORKER_INDEX, AsyncMemory.LOCKED);
  }

  /**
   * Should be called from the main thread!
   * Only legal if the worker is locked and the size is locked
   */
  writeSize(value: number) {
    return Atomics.store(this.lockAndSize, AsyncMemory.SIZE_INDEX, value);
  }

  /**
   * Only legal if the worker is locked but the size is not
   */
  readSize(): number {
    return Atomics.load(this.lockAndSize, AsyncMemory.SIZE_INDEX);
  }

  resize(newSize: number) {
    this.sharedMemory = new SharedArrayBuffer(newSize);
    this.memory = new Uint8Array(this.sharedMemory);
    return this.sharedMemory;
  }

  /**
   * Should be called from the main thread!
   */
  unlockSize() {
    const oldValue = Atomics.compareExchange(
      this.lockAndSize,
      AsyncMemory.LOCK_SIZE_INDEX,
      AsyncMemory.LOCKED, // old value
      AsyncMemory.UNLOCKED // new value
    );
    if (oldValue != AsyncMemory.LOCKED) {
      throw new Error("Tried to unlock, but was already unlocked");
    }
    Atomics.notify(this.lockAndSize, AsyncMemory.LOCK_SIZE_INDEX);
  }
  /**
   * Should be called from the main thread!
   */
  unlockWorker() {
    const oldValue = Atomics.compareExchange(
      this.lockAndSize,
      AsyncMemory.LOCK_WORKER_INDEX,
      AsyncMemory.LOCKED, // old value
      AsyncMemory.UNLOCKED // new value
    );
    if (oldValue != AsyncMemory.LOCKED) {
      throw new Error("Tried to unlock, but was already unlocked");
    }
    Atomics.notify(this.lockAndSize, AsyncMemory.LOCK_WORKER_INDEX);
  }
}
