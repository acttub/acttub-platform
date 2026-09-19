package com.acttub.actingapi.feature.portfolio.adapter.storage;

import java.util.Optional;

import com.acttub.actingapi.feature.portfolio.app.PortfolioPhotoStorage;
import com.acttub.actingapi.integration.storage.NoCredentialsError;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import org.springframework.stereotype.Component;

/**
 * 포트폴리오 사진 포트를 오브젝트 스토리지로 구현한다.
 *
 * <p>{@code Optional} 로 받는 이유는 스토리지 빈이 없는 기동 형태가 실재하기 때문이다
 * ({@code profile/adapter/storage/ObjectStorageProfilePhotos} 와 같은 형태). 올리기는 그때 예외로 떨어지고,
 * 보는 주소는 {@code null} 이 된다 — 포트폴리오 조회가 스토리지 때문에 막히면 안 된다.
 */
@Component
class ObjectStoragePortfolioPhotos implements PortfolioPhotoStorage {
    private final Optional<ObjectStorage> configured;

    ObjectStoragePortfolioPhotos(Optional<ObjectStorage> configured) {
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
