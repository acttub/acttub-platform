package com.acttub.actingapi.feature.practice.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 지운 연습에서 보관 동의로 남긴 영상의 파기 (practice.library 「연습 삭제」, SOMA-985). 매일 도는 계정 정리가 부른다.
 */
public interface DeletedPracticePurge {

    /**
     * 지운 날부터 3년이 지났거나({@code deletedBefore}) 원래 주인이 보관 동의의 현재 버전에 동의하지 않은 영상의 파일을
     * 파기한다. 40일 지난 무료 횟수 표시도 지운다. 한 트랜잭션이다.
     *
     * @return 장부에 올린 객체 삭제들. 부르는 쪽이 트랜잭션 밖에서 시도한다
     */
    List<UUID> purgeExpired(Instant deletedBefore, Instant now);
}
