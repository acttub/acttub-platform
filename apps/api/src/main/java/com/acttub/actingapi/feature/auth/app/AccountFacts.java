package com.acttub.actingapi.feature.auth.app;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * 계정 행({@code users})에서 다른 기능이 읽는 값 (ADR-040). 계정 행은 {@code auth} 의 것이라 다른 기능은 이 Port 로 읽는다.
 */
public interface AccountFacts {

    /** 가입한 시각. 없는 계정이면 비어 있다. */
    Optional<Instant> signedUpAt(UUID userId);

    /** 활성 계정인가. 없는 계정과 탈퇴한 계정이면 거짓이다. 잠그지 않는다 — 쓰기 앞에서 줄을 세우려면 {@link AccountRowLock} 을 쓴다. */
    boolean active(UUID userId);

    /** 이메일. 없는 계정이거나 이메일이 없으면(게스트, 탈퇴한 계정) 비어 있다. */
    Optional<String> email(UUID userId);
}
