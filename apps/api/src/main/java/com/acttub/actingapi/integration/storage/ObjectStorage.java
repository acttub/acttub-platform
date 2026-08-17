package com.acttub.actingapi.integration.storage;

import java.nio.file.Path;

public interface ObjectStorage {
    String presignUpload(
            String objectKey,
            String mimeType,
            long sizeBytes,
            int expiresInSeconds);

    String presignPlayback(String objectKey, int expiresInSeconds);

    StoredObjectMetadata head(String objectKey);

    StoredObjectMetadata downloadToPath(String objectKey, Path destination);

    void delete(String objectKey);
}
