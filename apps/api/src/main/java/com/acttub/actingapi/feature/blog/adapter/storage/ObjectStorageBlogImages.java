package com.acttub.actingapi.feature.blog.adapter.storage;

import java.util.Optional;

import com.acttub.actingapi.feature.blog.app.BlogImages;
import com.acttub.actingapi.integration.storage.NoCredentialsError;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.stereotype.Component;

/**
 * 블로그 이미지 포트를 포스터와 같은 오브젝트 스토리지(같은 버킷·설정)로 구현한다. 키는 {@code blog/} 아래다.
 * 올리기는 운영 도구의 본체라 스토리지가 없으면 그대로 던지고(503 {@code storage_not_configured}), 보는 주소는 실패를
 * {@code null} 로 알린다.
 */
@Component
class ObjectStorageBlogImages implements BlogImages {
    private final Optional<ObjectStorage> configured;
    private final FailureReporter failureReporter;

    ObjectStorageBlogImages(Optional<ObjectStorage> configured, FailureReporter failureReporter) {
        this.configured = configured;
        this.failureReporter = failureReporter;
    }

    @Override
    public void upload(String objectKey, String contentType, byte[] content) {
        configured.orElseThrow(() -> new NoCredentialsError("storage is not configured"))
                .upload(objectKey, contentType, content);
    }

    @Override
    public String viewUrl(String objectKey, int expiresInSeconds) {
        if (configured.isEmpty()) {
            return null;
        }
        try {
            return configured.get().presignPlayback(objectKey, expiresInSeconds);
        } catch (RuntimeException exception) {
            failureReporter.report(exception, FailureKind.EXTERNAL, new FailureContext("ObjectStorageBlogImages.viewUrl"));
            return null;
        }
    }
}
