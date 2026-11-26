package com.acttub.actingapi.feature.auth.app;

import java.time.Instant;
import java.util.UUID;

/**
 * 계정 행({@code users})을 닫는 일. 계정을 닫는 트랜잭션 안에서만 부른다({@link AccountErasureSequence#close}).
 */
public interface AccountDeactivation {

    /** 계정 행의 상태. */
    enum State { ACTIVE, DEACTIVATED }

    /**
     * 계정 행을 잠그고 상태를 읽는다. 회원 자료를 쓰는 트랜잭션들이 같은 행을 잡으므로 이 잠금 뒤에 줄을 선다.
     *
     * @return 없는 계정이면 {@code null}
     */
    State lock(UUID userId);

    /** 상태를 {@code deactivated} 로 바꾸고 닫은 시각을 적는다. */
    void deactivate(UUID userId, Instant now);

    /**
     * 계정 행을 지운다. 자료가 없는 만 14세 미만 계정에만 쓴다. 이 행을 가리키는 행이 남아 있으면 외래 키로 실패한다.
     */
    void eraseRow(UUID userId);

    /** 닫은 시각. 다시 온 탈퇴에서는 처음 닫은 시각이다. */
    Instant deactivatedAt(UUID userId);
}
