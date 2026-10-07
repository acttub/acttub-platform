package com.acttub.actingapi.feature.poster.adapter.storage;

import java.util.Optional;

import com.acttub.actingapi.feature.poster.app.PosterImages;
import com.acttub.actingapi.integration.storage.NoCredentialsError;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.stereotype.Component;

/**
 * 포스터 이미지 포트를 기존 오브젝트 스토리지(같은 버킷·설정)로 구현한다.
 *
 * <p>보는 주소는 실패를 삼킨다 — 스토리지가 없거나 서명이 실패해도 앱의 포스터 목록은 나가야 한다. 서명 실패는 바깥 의존
 * 실패라 보고한다. 올릴 자리는 운영 도구의 본체라 스토리지가 없으면 그대로 던진다(503 {@code storage_not_configured}).
 */
@Component
class ObjectStoragePosterImages implements PosterImages {
    private final Optional<ObjectStorage> configured;
    private final FailureReporter failureReporter;

    ObjectStoragePosterImages(Optional<ObjectStorage> configured, FailureReporter failureReporter) {
        this.configured = configured;
        this.failureReporter = failureReporter;
    }

    @Override
    public String presignUpload(String objectKey, String contentType, long sizeBytes, int expiresInSeconds) {
        return configured.orElseThrow(() -> new NoCredentialsError("storage is not configured"))
                .presignUpload(objectKey, contentType, sizeBytes, expiresInSeconds);
    }

    @Override
    public String viewUrl(String objectKey, int expiresInSeconds) {
        if (configured.isEmpty()) {
            return null;
        }
        try {
            return configured.get().presignPlayback(objectKey, expiresInSeconds);
        } catch (RuntimeException exception) {
            failureReporter.report(exception, FailureKind.EXTERNAL, new FailureContext("ObjectStoragePosterImages.viewUrl"));
            return null;
        }
    }
}
