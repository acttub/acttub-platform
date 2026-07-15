const CANONICAL_BUCKET = "practice-videos";
const CANONICAL_PATH = /^users\/[^/]+\/practice-sessions\/[^/]+\/take\.(?:mp4|mov)$/u;

async function inspect(storage, bucket, path) {
  const parts = path.split("/");
  const fileName = parts.pop();
  const { data, error } = await storage.from(bucket).list(parts.join("/"), { limit: 2, search: fileName });
  if (error) throw Object.assign(new Error("storage inspection failed"), { code: "storage_inspection_failed" });
  const object = data?.find((entry) => entry.name === fileName);
  if (!object) return null;
  const rawSize = object.metadata?.size ?? object.size;
  const sizeBytes = Number(rawSize);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw Object.assign(new Error("invalid cleanup object metadata"), { code: "invalid_cleanup_object" });
  }
  return { sizeBytes };
}

export async function deleteUploadObject({ storage, bucket, path, recordObserved = async () => {} }) {
  if (bucket !== CANONICAL_BUCKET || !CANONICAL_PATH.test(path)) {
    throw Object.assign(new Error("invalid cleanup object"), { code: "invalid_cleanup_object" });
  }
  const before = await inspect(storage, bucket, path);
  if (!before) return { objectExisted: false, observedSizeBytes: null, cleanedSizeBytes: null };
  await recordObserved(before.sizeBytes);
  const { error } = await storage.from(bucket).remove([path]);
  if (error) throw Object.assign(new Error("storage cleanup failed"), { code: "storage_delete_failed" });
  if (await inspect(storage, bucket, path)) {
    throw Object.assign(new Error("storage cleanup was not confirmed"), { code: "storage_delete_failed" });
  }
  return { objectExisted: true, observedSizeBytes: before.sizeBytes, cleanedSizeBytes: before.sizeBytes };
}
