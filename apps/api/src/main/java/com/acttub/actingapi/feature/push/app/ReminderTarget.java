package com.acttub.actingapi.feature.push.app;

import java.util.UUID;

/**
 * 저녁 리마인드를 받을 단말 하나와 그 주인. 단말만 알면 되는 분석 완료 알림({@link PushTarget})과 달리
 * 리마인드는 사람마다 문구가 갈릴 수 있어(SOMA-704) 누구의 단말인지 함께 든다.
 */
public record ReminderTarget(UUID userId, String token, String locale) {

    public PushTarget device() {
        return new PushTarget(token, locale);
    }
}
