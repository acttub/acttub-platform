package com.acttub.actingapi.feature.profile.app;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 탈퇴 트랜잭션 밖에서 하는 정리의 장부({@code account_cleanup_operations}).
 *
 * <p>행은 탈퇴 트랜잭션이 만든다({@link ProfileRepository#withdraw}). 여기는 그것을 집어 시도하고
 * 결과를 적는 쪽이다. 성공한 것은 지운다. 7일이 지난 뒤는 종류에 따라 다르다: <b>제공자 해제 값</b>
 * ({@code apple_revoke}·{@code kakao_unlink}·{@code naver_revoke})은 값과 함께 지우고, <b>객체 삭제</b>
 * ({@code object_delete}·{@code reading_recording_delete})는 성공할 때까지 키를 지우지 않는다 — 7일 연속
 * 실패하면 운영자에게 알리고 복구 대상으로 남긴다(03-reading 「리딩 자료의 이관·삭제·탈퇴」, account.withdraw).
 */
public interface AccountCleanupRepository {

    /** 서버 해제에 필요한 값을 들고 다시 시도하는 기간. 지나면 그 값을 지운다. 객체 삭제는 이 기간마다 알린다. */
    Duration RETRY_WINDOW = Duration.ofDays(7);

    /** 성공할 때까지 대상 키를 지우지 않는 종류. */
    List<String> OBJECT_DELETE_KINDS = List.of("object_delete", "reading_recording_delete");

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

    /** 기한이 지난 <b>제공자 해제</b>를 값과 함께 지우고, 무엇을 포기했는지 돌려준다. 객체 삭제는 지우지 않는다. */
    List<Abandoned> removeExpired(Instant now);

    /**
     * 기한이 지난 <b>객체 삭제</b>를 돌려주고 다음 기한을 한 기간 뒤로 미룬다 — 키는 그대로이고 시도도 계속된다.
     * 돌려준 것마다 부르는 쪽이 운영자에게 알린다. 다음 기한 전에는 다시 돌려주지 않는다.
     */
    List<Overdue> deferOverdueObjectDeletes(Instant now);

    record CleanupOperation(UUID id, UUID userId, String kind, String payloadEncrypted, int attemptCount) {
    }

    /** 7일 동안 성공하지 못해 포기한 정리. 값은 이미 지워졌다. */
    record Abandoned(UUID id, UUID userId, String kind, int attemptCount, String lastError) {
    }

    /** 7일 동안 성공하지 못한 객체 삭제. 키는 장부에 남아 있고 다시 시도된다. */
    record Overdue(UUID id, UUID userId, String kind, int attemptCount, String lastError) {
    }
}
