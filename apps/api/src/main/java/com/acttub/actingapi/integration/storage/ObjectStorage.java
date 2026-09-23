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

    /**
     * 서버가 직접 객체를 올린다 — 리딩 녹음처럼 작아서 올릴 자리를 따로 받지 않는 파일(reading.recording).
     * 같은 키에 다시 올리면 덮어쓴다.
     */
    void upload(String objectKey, String mimeType, Path source);

    void delete(String objectKey);
}
