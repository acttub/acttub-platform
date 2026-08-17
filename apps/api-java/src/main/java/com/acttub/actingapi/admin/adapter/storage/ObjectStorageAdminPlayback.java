package com.acttub.actingapi.admin.adapter.storage;

import java.util.Optional;

import com.acttub.actingapi.admin.app.AdminPlayback;
import com.acttub.actingapi.integration.storage.ObjectStorage;
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

    ObjectStorageAdminPlayback(Optional<ObjectStorage> configured) {
        this.configured = configured;
    }

    @Override
    public String url(String objectKey, int expiresInSeconds) {
        if (configured.isEmpty()) {
            return null;
        }
        try {
            return configured.get().presignPlayback(objectKey, expiresInSeconds);
        } catch (Exception ignored) {
            return null;
        }
    }
}
