package com.acttub.actingapi.feature.reading.app;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.ReadingVoiceMaterial;

/** 리딩 녹음 코칭(SOMA-791)이 읽는 것 — 리딩 회차의 대본 줄·내 배역·줄마다 마지막 녹음, 그리고 그 회차로 시작한 코칭 회차. */
public interface ReadingVoiceMaterials {

    /** @return 내 리딩 회차가 아니거나 없으면 {@code null} */
    Material material(UUID userId, UUID readingSessionId);

    /** 그 리딩 회차로 시작한 내 코칭 회차 id. 없으면 {@code null}. */
    UUID practiceOf(UUID userId, UUID readingSessionId);

    /** 코칭 회차가 시작한 리딩 회차 id. 내 회차가 아니거나 리딩으로 시작하지 않았으면 {@code null}. */
    UUID readingSessionOf(UUID userId, UUID practiceId);

    record Material(Set<UUID> myCharacterIds, List<ReadingVoiceMaterial.Line> lines,
                    List<ReadingVoiceMaterial.Recording> recordings) {
    }
}
