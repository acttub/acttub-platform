interface StorageObjectEntry {
  name: string;
  metadata?: { size?: number | string | null } | null;
  size?: number | string | null;
}

interface StorageBucketClient {
  list(path: string, options: { limit: number; search: string }): PromiseLike<{ data: StorageObjectEntry[] | null; error: unknown }>;
  remove(paths: string[]): PromiseLike<{ error: unknown }>;
}

export function deleteUploadObject(input: {
  storage: { from(bucket: string): StorageBucketClient };
  bucket: string;
  path: string;
  recordObserved?: (sizeBytes: number) => Promise<unknown>;
}): Promise<{ objectExisted: boolean; observedSizeBytes: number | null; cleanedSizeBytes: number | null }>;
