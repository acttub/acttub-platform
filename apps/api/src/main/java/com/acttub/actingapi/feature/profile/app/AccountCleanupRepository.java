package com.acttub.actingapi.feature.profile.app;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 탈퇴 트랜잭션 밖에서 하는 정리의 장부({@code account_cleanup_operations}).
 *
 * <p>행은 탈퇴 트랜잭션이 만든다({@link ProfileRepository#withdraw}). 여기는 그것을 집어 시도하고
 * 결과를 적는 쪽이다. <b>끝난 것은 남지 않는다</b> — 성공하면 지우고, 7일이 지나면 값과 함께 지운다.
 */
public interface AccountCleanupRepository {

    /** 서버 해제에 필요한 값을 들고 다시 시도하는 기간. 지나면 그 값을 지운다. */
    Duration RETRY_WINDOW = Duration.ofDays(7);

    /**
     * 방금 올린 것들을 집는다. 집는 동안({@code lease}) 다른 워커는 같은 행을 집지 않는다.
     * 시도 횟수가 하나 는다.
     */
    List<CleanupOperation> claim(List<UUID> ids, Instant now, Duration lease);

    /** 다시 시도할 때가 된 것을 오래된 순으로 집는다. 기한이 지난 것은 집지 않는다. */
    List<CleanupOperation> claimDue(Instant now, int limit, Duration lease);

    void succeeded(UUID id);

    /** @param error 실패의 종류. 값(토큰·회원번호·객체 키)을 싣지 않는다 */
    void failed(UUID id, String error, Instant nextAttemptAt, Instant now);

    /** 기한이 지난 것을 값과 함께 지우고, 무엇을 포기했는지 돌려준다. */
    List<Abandoned> removeExpired(Instant now);

    record CleanupOperation(UUID id, UUID userId, String kind, String payloadEncrypted, int attemptCount) {
    }

    /** 7일 동안 성공하지 못해 포기한 정리. 값은 이미 지워졌다. */
    record Abandoned(UUID id, UUID userId, String kind, int attemptCount, String lastError) {
    }
}
