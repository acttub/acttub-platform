package com.acttub.actingapi.storage;

public interface ObjectStorage {
    String presignUpload(
            String objectKey,
            String mimeType,
            long sizeBytes,
            int expiresInSeconds);

    StoredObjectMetadata head(String objectKey);
}
