// TODO: If Starboard gets more languages that can run in workers,
//       we might want to put all of them in the same worker.
//       That way, they could talk to each other. If that happens,
//       the types right here have to be moved to starboard-notebook.
//       Automatic comlinking would also be cool btw.
export type WorkerMessage =
  | {
      type: "initialize";
      options: {
        artifactsUrl?: string;
        lockBuffer?: SharedArrayBuffer;
        dataBuffer?: SharedArrayBuffer;
        // Other options like the packages to start with can be passed here
      };
    }
  | {
      type: "run";
      id: string;
      code: string;
    };

export type WorkerResponse =
  | {
      type: "initialized";
    }
  | {
      type: "result";
      id: string;
      display?: "default" | "html" | "latex";
      value: any; // TODO: Normal objects can be normal objects, python proxies might need a bit of comlink
    }
  | {
      type: "console";
      method: string;
      data: any[];
    }
  | {
      type: "stdin";
    }
  | {
      type: "data-buffer";
      dataBuffer?: SharedArrayBuffer;
    };
