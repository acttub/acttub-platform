package com.acttub.actingapi.feature.auth.app;

import java.time.Instant;
import java.util.UUID;

/**
 * 이탈 설문을 물어본 표식 (practice.feedback). 설문은 계정에 한 번만 묻는다. 계정 행의 칸
 * ({@code users.exit_survey_asked_at})이라 계정 행의 주인이 이 Port 로 내준다(ADR-040).
 */
public interface ExitSurveyAsk {

    /**
     * 한 문장으로 선점한다 — 활성 계정이고 아직 묻지 않았을 때만 적는다. 두 기기가 동시에 물어도 하나만 이긴다.
     *
     * @return 이겼으면 참
     */
    boolean claim(UUID userId, Instant now);

    /**
     * 게스트 이전: 게스트에게 물어봤으면 회원도 물어본 것이다. 둘 다 물어봤으면 먼저 물어본 시각을 남긴다.
     * <b>트랜잭션을 열지 않는다</b> — 부르는 쪽(이전)의 것에 참여한다.
     */
    void carryOver(UUID from, UUID to);
}
