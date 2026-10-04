export declare const workerRuntimeDependencies: string[];
export declare function workerPackage(source: Record<string, unknown>, lock: Record<string, unknown>): {
  name: string;
  version: string;
  private: boolean;
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
  overrides?: Record<string, string>;
};
export declare function verifyWorkerLock(original: Record<string, unknown>, reduced: Record<string, unknown>): void;
export declare function measureDirectory(directory: string): { bytes: number; files: number };
