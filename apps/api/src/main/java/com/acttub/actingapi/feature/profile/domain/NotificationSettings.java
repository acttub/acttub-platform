package com.acttub.actingapi.feature.profile.domain;

/**
 * 알림 토글 셋 (account.notification). 프로필에 저장해 폰을 바꿔도 유지된다. 기본값은 모두 켜짐이다.
 *
 * <p>세 종류 모두 서버 푸시다.
 */
public record NotificationSettings(boolean analysisDone, boolean challenge, boolean eveningReminder) {

    /** 서버 푸시 셋이 다 꺼졌는가. 그러면 이 회원의 푸시 토큰을 둘 이유가 없다. */
    public boolean pushesTurnedOff() {
        return !analysisDone && !challenge && !eveningReminder;
    }
}
