package com.acttub.actingapi.feature.auth.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 탈퇴 3년 뒤의 파기에서 계정 쪽이 하는 일 (account.withdraw, ADR-029). 파기의 트랜잭션 안에서만 부른다.
 *
 * <p>고르는 기준은 <b>신원이 아니다.</b> 제공자의 연결 끊기 알림은 신원을 행째 지우므로, 마지막 신원이 끊긴 뒤 탈퇴한
 * 회원에게는 해시 행이 없다 — 해시 행의 유무로 고르면 그 사람의 보관 영상은 영영 남는다. 탈퇴 시각과 파기를 마친 시각
 * ({@code users.retention_purged_at}, V12)으로 고르고, 같은 트랜잭션에서 그 시각을 적는다.
 */
public interface RetentionPurge {

    /**
     * 보관 기간이 끝났고 아직 파기하지 않은 탈퇴 계정을 잠가 고른다. 탈퇴 시각이 오래된 순서다.
     *
     * @param deactivatedBefore 탈퇴 시각이 이보다 앞선 계정
     */
    List<UUID> lockExpired(Instant deactivatedBefore);

    /**
     * 그 계정의 신원 해시 행을 지우고 파기를 마친 시각을 적는다. 해시 행을 지우는 것과 영상 삭제를 장부에 올리는 것이 한
     * 트랜잭션이어야 "해시는 지워졌는데 영상은 남은" 계정이 생기지 않으므로, 영상·녹음을 정리한 <b>뒤에</b> 부른다.
     */
    void complete(UUID userId, Instant now);
}
