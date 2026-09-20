package com.acttub.actingapi.feature.profile.domain;

/**
 * 알림 토글 셋 (account.notification). 프로필에 저장해 폰을 바꿔도 유지된다. 기본값은 모두 켜짐이다.
 *
 * <p>분석 완료와 챌린지는 서버가 보내는 푸시이고, 저녁 리마인드는 폰이 스스로 울리는 알람이다 — 서버는
 * 값만 기억한다.
 */
public record NotificationSettings(boolean analysisDone, boolean challenge, boolean eveningReminder) {

    /** 서버가 보내는 푸시 둘이 다 꺼졌는가. 그러면 이 회원의 푸시 토큰을 둘 이유가 없다. */
    public boolean pushesTurnedOff() {
        return !analysisDone && !challenge;
    }
}
