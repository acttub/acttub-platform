package com.acttub.actingapi.feature.admin.adapter.storage;

import java.util.Optional;

import com.acttub.actingapi.feature.admin.app.AdminPlayback;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.stereotype.Component;

/**
 * 관리자 화면의 재생 주소를 오브젝트 스토리지로 구현한다.
 *
 * <p><b>실패를 삼킨다.</b> 스토리지가 없거나 서명이 실패해도 세션 목록은 그대로 나가야 한다 —
 * 재생 주소는 이 화면의 곁가지다. 삼키는 자리를 어댑터에 두므로 서비스는 스토리지 사정을
 * 모른 채로 남는다.
 */
@Component
class ObjectStorageAdminPlayback implements AdminPlayback {
    private final Optional<ObjectStorage> configured;
    private final FailureReporter failureReporter;

    ObjectStorageAdminPlayback(
            Optional<ObjectStorage> configured,
            FailureReporter failureReporter) {
        this.configured = configured;
        this.failureReporter = failureReporter;
    }

    @Override
    public String url(String objectKey, int expiresInSeconds) {
        if (configured.isEmpty()) {
            return null;
        }
        try {
            return configured.get().presignPlayback(objectKey, expiresInSeconds);
        } catch (Exception exception) {
            failureReporter.report(
                    exception,
                    FailureKind.EXTERNAL,
                    new FailureContext("ObjectStorageAdminPlayback.url"));
            return null;
        }
    }
}
