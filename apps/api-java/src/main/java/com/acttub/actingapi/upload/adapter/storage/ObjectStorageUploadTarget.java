package com.acttub.actingapi.upload.adapter.storage;

import java.util.Optional;

import com.acttub.actingapi.integration.storage.NoCredentialsError;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.upload.app.StoredUpload;
import com.acttub.actingapi.upload.app.UploadTarget;
import org.springframework.stereotype.Component;

/**
 * 업로드 자리 포트를 오브젝트 스토리지로 구현한다.
 *
 * <p>{@code Optional} 로 받는 이유는 스토리지 빈이 없는 기동 형태가 실재하기 때문이다 —
 * 하네스의 nostorage 인스턴스가 그것이고, 그때 스토리지를 만지는 요청은 예외로 떨어져야 한다.
 * 없음을 여기서 예외로 바꾸므로 서비스는 스토리지가 설정됐는지를 묻지 않는다
 * ({@code practice/adapter/storage/ObjectStoragePlayback} 과 같은 형태).
 */
@Component
class ObjectStorageUploadTarget implements UploadTarget {
    private final Optional<ObjectStorage> configured;

    ObjectStorageUploadTarget(Optional<ObjectStorage> configured) {
        this.configured = configured;
    }

    @Override
    public void requireConfigured() {
        storage();
    }

    @Override
    public String presignUpload(
            String objectKey,
            String mimeType,
            long sizeBytes,
            int expiresInSeconds) {
        return storage().presignUpload(objectKey, mimeType, sizeBytes, expiresInSeconds);
    }

    @Override
    public StoredUpload head(String objectKey) {
        StoredObjectMetadata metadata = storage().head(objectKey);
        return metadata == null ? null : new StoredUpload(metadata.sizeBytes(), metadata.etag());
    }

    private ObjectStorage storage() {
        return configured.orElseThrow(() -> new NoCredentialsError("storage is not configured"));
    }
}
