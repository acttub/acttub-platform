package com.acttub.actingapi.feature.consent.app;

import java.time.Instant;
import java.util.Optional;

/**
 * 약관의 발행 시각을 다른 기능이 읽는 자리 (ADR-040). 동의 문서의 테이블은 {@code consent} 의 것이다.
 */
public interface TermsPublication {

    /**
     * 유료 조항이 처음 실린 약관(v2)의 발행 시각. 운영 DB 에는 v2 행이 있다. 최신 버전만 있는 빈 DB(테스트·새 환경)에는 v2 행이
     * 없으므로 v1 이 아닌 한국어 약관 가운데 가장 먼저 발행된 것을 쓴다. 그런 약관이 없으면 비어 있다.
     */
    Optional<Instant> paidTermsPublishedAt();
}
