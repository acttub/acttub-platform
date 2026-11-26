package com.acttub.actingapi.feature.challenge.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 한 사람의 참여작에서 만든 영상 객체를 파기한다 (account.withdraw, specs/challenge 「챌린지 자료의 삭제·탈퇴」).
 *
 * <p>얼굴 모자이크본과 공유 프레임 영상·미리보기(SOMA-1156)는 참여작의 영상에서 나온 객체라 영상과 같이 다룬다: 탈퇴 때
 * (보관 동의가 없으면)와 탈퇴 3년 뒤의 파기(보관 동의로 남겨 둔 것)가 지운다. 참여작 행과 그 키는 그대로 둔다 — 파일 저장소의
 * 삭제는 멱등이라 다시 올려도 된다.
 */
public interface EntryMediaPurge {

    /**
     * 객체 삭제를 정리 장부에 올린다. 부르는 쪽의 트랜잭션에 참여한다.
     *
     * @return 장부에 올린 객체 삭제의 id(지울 객체가 없으면 빈 목록)
     */
    List<UUID> purgeOf(UUID userId, Instant now);
}
