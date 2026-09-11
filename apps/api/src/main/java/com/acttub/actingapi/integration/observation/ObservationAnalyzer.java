package com.acttub.actingapi.integration.observation;

import java.nio.file.Path;
import java.util.UUID;

/**
 * 섹션 D 분석 워커가 영상 관찰 층을 호출하는 진입점.
 *
 * <p>{@code practiceSessionId} 는 관찰에 쓰이지 않는다 — 어느 연습의 호출인지 기록에
 * 남기려고 받는다(SOMA-517). 이 값이 없으면 관찰이 코치·노트와 같은 기록에 모이지 않아
 * 화면에서 떠돈다.
 */
public interface ObservationAnalyzer {
    ObservationPack analyze(
            Path videoPath, String mimeType, ActorMaterial actor, UUID practiceSessionId);
}
