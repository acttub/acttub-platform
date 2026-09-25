package com.acttub.actingapi.feature.video.adapter.storage;

import java.nio.file.Path;

import com.acttub.actingapi.feature.video.app.VideoStorage;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.NoCredentialsError;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

/**
 * 보관함이 쓰는 오브젝트 스토리지. 스토리지가 없는 기동(로컬·일부 테스트)에서는 빈이 없고, 그때는 올리기가
 * 503 {@code storage_not_configured} 이며 재생 주소는 {@code null} 이다 — 목록·상세는 그대로 열린다.
 */
@Component
class ObjectStorageVideos implements VideoStorage {
    private final ObjectProvider<ObjectStorage> storage;

    ObjectStorageVideos(ObjectProvider<ObjectStorage> storage) {
        this.storage = storage;
    }

    @Override
    public void requireConfigured() {
        if (storage.getIfAvailable() == null) {
            throw new NoCredentialsError("storage is not configured");
        }
    }

    @Override
    public String presignUpload(String objectKey, String contentType, long byteSize, int expiresInSeconds) {
        requireConfigured();
        return storage.getObject().presignUpload(objectKey, contentType, byteSize, expiresInSeconds);
    }

    @Override
    public String presignPlayback(String objectKey, int expiresInSeconds) {
        ObjectStorage available = storage.getIfAvailable();
        return available == null ? null : available.presignPlayback(objectKey, expiresInSeconds);
    }

    @Override
    public Stored head(String objectKey) {
        ObjectStorage available = storage.getIfAvailable();
        if (available == null) {
            return null;
        }
        StoredObjectMetadata metadata = available.head(objectKey);
        return metadata == null ? null : new Stored(metadata.sizeBytes(), metadata.etag());
    }

    @Override
    public boolean configured() {
        return storage.getIfAvailable() != null;
    }

    @Override
    public void download(String objectKey, Path destination) {
        requireConfigured();
        storage.getObject().downloadToPath(objectKey, destination);
    }

    @Override
    public void upload(String objectKey, String contentType, Path source) {
        requireConfigured();
        storage.getObject().upload(objectKey, contentType, source);
    }
}
