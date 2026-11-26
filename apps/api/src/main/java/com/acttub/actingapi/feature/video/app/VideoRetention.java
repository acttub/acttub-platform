package com.acttub.actingapi.feature.video.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 한 사람의 보관함 영상을 파기한다 (account.withdraw, specs/practice 「연습 자료의 이관·삭제·탈퇴」).
 *
 * <p>행을 지우지 않고 {@code purged_at} 을 찍는다 — 회차·참여작의 기록이 깨지지 않고, 재생이 막히며, 총량에서 빠진다.
 * 탈퇴 때(보관 동의가 없으면)와 탈퇴 3년 뒤의 파기(보관 동의로 남겨 둔 것)가 쓴다.
 */
public interface VideoRetention {

    /**
     * 이 사람의 영상·포스터와 올리기 예약의 객체 삭제를 정리 장부에 올리고, 아직 파기하지 않은 영상에 파기 시각을 찍는다.
     * 객체 키는 파기 시각을 찍기 전에 읽는다. 부르는 쪽의 트랜잭션에 참여한다.
     *
     * @return 장부에 올린 객체 삭제의 id(지울 객체가 없으면 빈 목록)
     */
    List<UUID> purgeFilesOf(UUID userId, Instant now);
}
