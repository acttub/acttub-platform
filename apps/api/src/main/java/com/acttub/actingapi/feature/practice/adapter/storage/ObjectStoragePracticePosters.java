package com.acttub.actingapi.feature.practice.adapter.storage;

import com.acttub.actingapi.feature.practice.app.PracticePosters;
import com.acttub.actingapi.feature.practice.domain.PracticeRules;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

/**
 * 회차의 포스터 주소를 오브젝트 스토리지로 서명한다. 보관함({@code ObjectStorageVideos})과 같은 서명 GET·같은 수명이고,
 * 서명은 서버 안의 계산이라 바깥 호출이 없다. 스토리지가 없는 기동(로컬·일부 테스트)에서는 {@code null} 이다.
 */
@Component
class ObjectStoragePracticePosters implements PracticePosters {
    private final ObjectProvider<ObjectStorage> storage;

    ObjectStoragePracticePosters(ObjectProvider<ObjectStorage> storage) {
        this.storage = storage;
    }

    @Override
    public String url(String posterKey) {
        ObjectStorage available = storage.getIfAvailable();
        return available == null ? null : available.presignPlayback(posterKey, PracticeRules.POSTER_URL_TTL_SECONDS);
    }
}
