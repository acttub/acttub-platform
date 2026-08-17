package com.acttub.actingapi.feature.report.app;

import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 리포트 생성이 코치 세션 쪽에 요구하는 조회 (ADR-016).
 *
 * <p>리포트를 만드는 쪽이 무엇이 필요한지 선언하고 코치 쪽이 그것을 만족시킨다. 반대로
 * {@code report}가 {@code coach}의 저장소를 직접 잡으면 {@code coach → report} 11건과 맞물려
 * 순환이 된다 — 이 인터페이스가 그 방향을 하나로 정렬한다.
 */
public interface ReportSourceProvider {

    /** 소유권 검증이 끝난 리포트 원본 문맥. 세션이 없거나 남의 것이면 {@code null}. */
    OwnedReportSource getOwnedReportSource(UUID userId, UUID coachSessionId);

    /** 해당 handoff 로 이미 만들어진 리포트. 없으면 {@code null}. */
    JsonNode getPracticeReportForHandoff(UUID handoffId);
}
