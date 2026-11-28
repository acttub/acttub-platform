package com.acttub.actingapi.feature.reading.app;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.ReadingVoiceMaterial;

/**
 * 리딩 녹음 코칭(SOMA-791)이 리딩의 표에서 읽는 것 — 리딩 회차의 대본 줄·내 배역·줄마다 마지막 녹음. 그 회차로 시작한 코칭 회차는
 * practice 의 {@code PracticesFromReading} 이 답한다.
 */
public interface ReadingVoiceMaterials {

    /** @return 내 리딩 회차가 아니거나 없으면 {@code null} */
    Material material(UUID userId, UUID readingSessionId);

    record Material(Set<UUID> myCharacterIds, List<ReadingVoiceMaterial.Line> lines,
                    List<ReadingVoiceMaterial.Recording> recordings) {
    }
}
