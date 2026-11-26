package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 탈퇴 3년 뒤, 보관 동의로 남겨 두었던 리딩 녹음을 파기한다 (account.withdraw, specs/reading 「리딩 자료의 이관·삭제·탈퇴」).
 *
 * <p>녹음 행(음성과 전사)을 행째 지우고 객체 삭제를 같은 트랜잭션에서 정리 장부에 올린다.
 */
public interface RetainedRecordings {

    /**
     * 부르는 쪽(3년 파기)의 트랜잭션에 참여한다.
     *
     * @return 장부에 올린 객체 삭제의 id(지울 녹음이 없으면 빈 목록)
     */
    List<UUID> purgeOf(UUID userId, Instant now);
}
