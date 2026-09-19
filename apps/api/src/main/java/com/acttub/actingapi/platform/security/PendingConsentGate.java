package com.acttub.actingapi.platform.security;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

/**
 * 이 회원이 현재 판 가운데 아직 결정하지 않은 동의 문서. 하나라도 있으면 보호 기능이 막힌다.
 *
 * <p><b>선택 문서도 센다</b> — 거절도 결정이고, 결정하지 않은 것만 막는다. 1.0.0 이전에 필수 문서를
 * 거절·철회한 기록은 미결정과 같게 센다(필수 문서를 거절할 길이 이제 없어 새로 생기지 않는다).
 *
 * <p>선언은 배관에 있고 구현은 문서를 소유한 {@code consent} 가 한다 (ADR-017). 목록을 돌려주는
 * 것은 게이트의 403 본문이 그것을 싣기 때문이다 — 앱은 그 목록으로 동의 화면을 그린다.
 */
public interface PendingConsentGate {

    /** 종류 순(약관 · 수집·이용 동의 · AI 분석 · 탈퇴 후 보관). 없으면 빈 목록. */
    List<Document> undecidedFor(UUID userId);

    /** 403 {@code consent_required} 의 {@code pending_consents} 에 그대로 실린다. 로그인 응답과 같은 모양이다. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Document(
            UUID id,
            String type,
            String version,
            String title,
            String body,
            boolean required,
            Instant publishedAt) {
    }
}
