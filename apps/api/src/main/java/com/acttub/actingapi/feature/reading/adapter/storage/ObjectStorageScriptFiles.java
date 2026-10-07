package com.acttub.actingapi.feature.reading.adapter.storage;

import java.nio.file.Path;
import java.util.Optional;

import com.acttub.actingapi.feature.reading.app.ScriptFileStorage;
import com.acttub.actingapi.integration.storage.NoCredentialsError;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import org.springframework.stereotype.Component;

/** 대본 원본 파일 포트를 오브젝트 스토리지로 구현한다. 스토리지가 없는 기동에서는 올릴 자리가 503 이다. */
@Component
class ObjectStorageScriptFiles implements ScriptFileStorage {
    private final Optional<ObjectStorage> configured;

    ObjectStorageScriptFiles(Optional<ObjectStorage> configured) {
        this.configured = configured;
    }

    @Override
    public void requireConfigured() {
        storage();
    }

    @Override
    public String presignUpload(String objectKey, String contentType, long byteSize, int expiresInSeconds) {
        return storage().presignUpload(objectKey, contentType, byteSize, expiresInSeconds);
    }

    @Override
    public Long size(String objectKey) {
        StoredObjectMetadata metadata = storage().head(objectKey);
        return metadata == null ? null : metadata.sizeBytes();
    }

    @Override
    public void download(String objectKey, Path destination) {
        storage().downloadToPath(objectKey, destination);
    }

    private ObjectStorage storage() {
        return configured.orElseThrow(() -> new NoCredentialsError("storage is not configured"));
    }
}
