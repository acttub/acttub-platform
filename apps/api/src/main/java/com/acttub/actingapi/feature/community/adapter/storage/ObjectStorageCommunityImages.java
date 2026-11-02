package com.acttub.actingapi.feature.community.adapter.storage;

import java.util.Optional;

import com.acttub.actingapi.feature.community.app.CommunityImageStorage;
import com.acttub.actingapi.integration.storage.NoCredentialsError;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import org.springframework.stereotype.Component;

/**
 * 게시판 사진 포트를 오브젝트 스토리지로 구현한다. {@code portfolio/adapter/storage/ObjectStoragePortfolioPhotos} 와 같은
 * 형태다 — 스토리지 빈이 없는 기동에서는 올리기가 예외로 떨어지고 보는 주소는 {@code null} 이다.
 */
@Component
class ObjectStorageCommunityImages implements CommunityImageStorage {
    private final Optional<ObjectStorage> configured;

    ObjectStorageCommunityImages(Optional<ObjectStorage> configured) {
        this.configured = configured;
    }

    @Override
    public void requireConfigured() {
        storage();
    }

    @Override
    public String presignUpload(String objectKey, String mimeType, long sizeBytes, int expiresInSeconds) {
        return storage().presignUpload(objectKey, mimeType, sizeBytes, expiresInSeconds);
    }

    @Override
    public Long sizeOf(String objectKey) {
        StoredObjectMetadata metadata = storage().head(objectKey);
        return metadata == null ? null : metadata.sizeBytes();
    }

    @Override
    public String viewUrl(String objectKey, int expiresInSeconds) {
        return configured.map(storage -> storage.presignPlayback(objectKey, expiresInSeconds)).orElse(null);
    }

    private ObjectStorage storage() {
        return configured.orElseThrow(() -> new NoCredentialsError("storage is not configured"));
    }
}
