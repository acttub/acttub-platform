package com.acttub.actingapi.feature.auth.app;

import java.time.Instant;
import java.util.UUID;

/**
 * 「지운 연습 보관 계정」 (practice.library 「연습 삭제」, SOMA-985). 배우가 지운 연습의 회차·영상·평가·의견·작업 행을 사람과
 * 끊어 남길 때 그 행들의 주인이 되는 계정이다.
 *
 * <p>신원·프로필이 없고 상태는 비활성이라 로그인할 수 없다. 탈퇴 시각이 없어 탈퇴 3년 뒤의 파기가 고르지 않는다.
 */
public interface DeletedPracticeAccount {

    /**
     * 없으면 만든다. 부르는 쪽의 트랜잭션에 참여한다.
     *
     * @return 그 계정의 id
     */
    UUID ensure(Instant now);
}
