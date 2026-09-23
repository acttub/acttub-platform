package com.acttub.actingapi.feature.reading.adapter.storage;

import java.nio.file.Path;
import java.util.Optional;

import com.acttub.actingapi.feature.reading.app.RecordingStorage;
import com.acttub.actingapi.integration.storage.NoCredentialsError;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import org.springframework.stereotype.Component;

/**
 * 녹음 객체 포트를 오브젝트 스토리지로 구현한다.
 *
 * <p>{@code Optional} 로 받는 이유는 스토리지 빈이 없는 기동 형태가 실재하기 때문이다
 * ({@code portfolio/adapter/storage/ObjectStoragePortfolioPhotos} 와 같은 형태). 올리기는 그때 예외로 떨어지고(503
 * {@code storage_not_configured}), 재생 주소는 {@code null} 이 된다 — 회차 조회가 스토리지 때문에 막히면 안 된다.
 */
@Component
class ObjectStorageRecordings implements RecordingStorage {
    private final Optional<ObjectStorage> configured;

    ObjectStorageRecordings(Optional<ObjectStorage> configured) {
        this.configured = configured;
    }

    @Override
    public void requireConfigured() {
        storage();
    }

    @Override
    public void upload(String objectKey, String contentType, Path source) {
        storage().upload(objectKey, contentType, source);
    }

    @Override
    public String playbackUrl(String objectKey, int expiresInSeconds) {
        return configured.map(storage -> storage.presignPlayback(objectKey, expiresInSeconds)).orElse(null);
    }

    private ObjectStorage storage() {
        return configured.orElseThrow(() -> new NoCredentialsError("storage is not configured"));
    }
}
