// see
// https://github.com/jvilk/BrowserFS/blob/master/src/generic/emscripten_fs.ts
// https://github.com/emscripten-core/emscripten/blob/main/src/library_nodefs.js
// https://github.com/emscripten-core/emscripten/blob/main/src/library_memfs.js
// https://github.com/emscripten-core/emscripten/blob/main/src/library_workerfs.js
// https://github.com/curiousdannii/emglken/blob/master/src/emglkenfs.js

// TODO: Use the types from starboard?
type SyncResult<T, E = Error> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      status: number;
      error: E;
      detail?: string;
    };

export interface NotebookFilesystemSync {
  /**
   * Get a file or directory at a given path.
   * @returns The contents of the file. `null` corresponds to a directory
   */
  get(opts: { path: string }): SyncResult<string | null>;

  /**
   * Creates or replaces a file or directory at a given path.
   * @param opts.value The contents of the file. `null` corresponds to a directory
   */
  put(opts: { path: string; value: string | null }): SyncResult<undefined>;

  /**
   * Deletes a file or directory at a given path
   */
  delete(opts: { path: string }): SyncResult<undefined>;

  /**
   * Move a file or directory to a new path. Can be used for renaming
   */
  move(opts: { path: string; newPath: string }): SyncResult<undefined>;

  /**
   * List the files in a directory
   */
  listDirectory(opts: { path: string }): SyncResult<string[]>;
}

export interface EMFSNode {
  name: string;
  mode: number;
  parent: EMFSNode;
  mount: { opts: { root: string } };
  id: any;
  timestamp: any;
  stream_ops: any;
  node_ops: any;
}

export interface EMFSStream {
  node: EMFSNode;
  position: number;
  fileData?: Uint8Array;
}

const DIR_MODE = 16895; // 040777
const FILE_MODE = 33206; // 100666
const SEEK_CUR = 1;
const SEEK_END = 2;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

export class EMFS {
  FS: any;
  ERRNO_CODES: any;
  CUSTOM_FS: NotebookFilesystemSync;

  constructor(FS: any, ERRNO_CODES: any, CUSTOM_FS: NotebookFilesystemSync) {
    this.FS = FS;
    this.ERRNO_CODES = ERRNO_CODES;
    this.CUSTOM_FS = CUSTOM_FS;

    this.node_ops.getattr = (node: EMFSNode) => {
      return {
        dev: 1,
        ino: node.id,
        mode: node.mode,
        nlink: 1,
        uid: 0,
        gid: 0,
        rdev: undefined,
        size: 0,
        atime: new Date(node.timestamp),
        mtime: new Date(node.timestamp),
        ctime: new Date(node.timestamp),
        blksize: 4096,
        blocks: 0,
      };
    };
    this.node_ops.setattr = (node: EMFSNode, attr: any) => {
      // Doesn't really do anything
      if (attr.mode !== undefined) {
        node.mode = attr.mode;
      }
      if (attr.timestamp !== undefined) {
        node.timestamp = attr.timestamp;
      }
    };
    this.node_ops.lookup = (parent: EMFSNode, name: string) => {
      const path = realPath(parent, name);
      const result = this.CUSTOM_FS.get({ path });
      if (!result.ok) {
        // I wish Javascript had inner exceptions
        throw this.FS.genericErrors[this.ERRNO_CODES["ENOENT"]];
      }
      return this.createNode(parent, name, result.data === null ? DIR_MODE : FILE_MODE);
    };
    this.node_ops.mknod = (parent: EMFSNode, name: string, mode: number, dev?: any) => {
      const node = this.createNode(parent, name, mode, dev);
      const path = realPath(node);
      try {
        if (this.FS.isDir(node.mode)) {
          let result = this.CUSTOM_FS.put({ path, value: null });
          if (!result.ok) {
            throw result.error;
          }
        } else {
          let result = this.CUSTOM_FS.put({ path, value: "" });
          if (!result.ok) {
            throw result.error;
          }
        }
      } catch (e) {
        throw e;
      }
      return node;
    };
    this.node_ops.rename = (oldNode: EMFSNode, newDir: EMFSNode, newName: string) => {
      const oldPath = realPath(oldNode);
      const newPath = realPath(newDir, newName);
      try {
        let result = this.CUSTOM_FS.move({ path: oldPath, newPath: newPath });
        if (!result.ok) {
          throw result.error;
        }
      } catch (e) {
        throw e;
      }
      oldNode.name = newName;
    };
    this.node_ops.unlink = (parent: EMFSNode, name: string) => {
      const path = realPath(parent, name);
      try {
        let result = this.CUSTOM_FS.delete({ path });
        if (!result.ok) {
          throw result.error;
        }
      } catch (e) {
        throw e;
      }
    };
    this.node_ops.rmdir = (parent: EMFSNode, name: string) => {
      const path = realPath(parent, name);
      try {
        let result = this.CUSTOM_FS.delete({ path });
        if (!result.ok) {
          throw result.error;
        }
      } catch (e) {
        throw e;
      }
    };
    this.node_ops.readdir = (node: EMFSNode) => {
      const path = realPath(node);
      try {
        let result = this.CUSTOM_FS.listDirectory({ path });
        if (!result.ok) {
          throw result.error;
        }
        return result.data;
      } catch (e) {
        throw e;
      }
    };
    this.node_ops.symlink = (parent: EMFSNode, newName: string, oldPath: string) => {
      throw new FS.ErrnoError(this.ERRNO_CODES["EPERM"]);
    };
    this.node_ops.readlink = (node: EMFSNode) => {
      throw new FS.ErrnoError(this.ERRNO_CODES["EPERM"]);
    };

    this.stream_ops.open = (stream: EMFSStream) => {
      const path = realPath(stream.node);
      try {
        if (FS.isFile(stream.node.mode)) {
          const result = this.CUSTOM_FS.get({ path });
          if (!result.ok) {
            throw result.error;
          }
          if (result.data === null) {
            return;
          }
          stream.fileData = encoder.encode(result.data);
        }
      } catch (e) {
        throw e;
      }
    };
    this.stream_ops.close = (stream: EMFSStream) => {
      const path = realPath(stream.node);
      try {
        if (FS.isFile(stream.node.mode) && stream.fileData) {
          const text = decoder.decode(stream.fileData);
          stream.fileData = undefined;
          let result = this.CUSTOM_FS.put({ path, value: text });
          if (!result.ok) {
            throw result.error;
          }
        }
      } catch (e) {
        const error = new FS.ErrnoError(this.ERRNO_CODES["EPERM"]);
        error.cause = e;
        throw error;
      }
    };
    this.stream_ops.read = (
      stream: EMFSStream,
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number
    ) => {
      if (length <= 0) return 0;

      const size = Math.min((stream.fileData?.length ?? 0) - position, length);
      try {
        buffer.set(stream.fileData!.subarray(position, position + size), offset);
      } catch (e) {
        throw e;
      }
      return size;
    };
    this.stream_ops.write = (
      stream: EMFSStream,
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number
    ) => {
      if (length <= 0) return 0;
      stream.node.timestamp = Date.now();

      try {
        if (position + length > (stream.fileData?.length ?? 0)) {
          // Resize
          const oldData = stream.fileData ?? new Uint8Array();
          stream.fileData = new Uint8Array(position + length);
          stream.fileData.set(oldData);
        }

        // Write
        stream.fileData!.set(buffer.subarray(offset, offset + length), position);

        return length;
      } catch (e) {
        throw e;
      }
    };
    this.stream_ops.llseek = (stream: EMFSStream, offset: number, whence: number) => {
      let position = offset;
      if (whence === SEEK_CUR) {
        position += stream.position;
      } else if (whence === SEEK_END) {
        if (this.FS.isFile(stream.node.mode)) {
          try {
            // Not sure, but let's see
            position += stream.fileData!.length;
          } catch (e) {
            throw e;
          }
        }
      }

      if (position < 0) {
        throw new FS.ErrnoError(this.ERRNO_CODES["EINVAL"]);
      }

      return position;
    };
  }

  mount(mount: { opts: { root: string } }) {
    return this.createNode(null, "/", DIR_MODE, 0);
  }

  createNode(parent: EMFSNode | null, name: string, mode: number, dev?: any) {
    if (!this.FS.isDir(mode) && !this.FS.isFile(mode)) {
      throw new this.FS.ErrnoError(this.ERRNO_CODES["EINVAL"]);
    }
    let node = this.FS.createNode(parent, name, mode);
    node.node_ops = this.node_ops;
    node.stream_ops = this.stream_ops;
    return node;
  }

  node_ops = {} as any;
  stream_ops = {} as any;
}

function realPath(node: EMFSNode, fileName?: string) {
  const parts = [];
  while (node.parent !== node) {
    parts.push(node.name);
    node = node.parent;
  }
  parts.push(node.mount.opts.root);
  parts.reverse();
  if (fileName !== undefined && fileName !== null) {
    parts.push(fileName);
  }
  return parts.join("/");
}
