package com.acttub.actingapi.feature.push.app;

import java.util.Map;

/**
 * 저녁 리마인드 한 건의 문구. 고정 문구가 기본(A)이고, 지난 노트로 만든 한 줄이 있으면 B 문구를 쓴다(SOMA-704).
 *
 * <p>둘 다 서비스 알림이다 — 연습 권유만 담고 이벤트·홍보를 섞지 않는다(account.notification). data 의
 * {@code kind} 는 앱이 읽는 값이라 바꾸지 않고, 실험 칸({@code variant}·{@code personalized})은 셈을 위해서만 더한다.
 */
public final class EveningReminder {
    static final String KIND = "evening_reminder";

    private EveningReminder() {}

    public static PushMessage message(PushTarget target) {
        return new PushMessage(target.token(), defaultTitle(target.korean()), defaultBody(target.korean()),
                Map.of("kind", KIND));
    }

    /** 실험이 켜졌을 때의 A 문구, 또는 B 로 나뉘었지만 쓸 한 줄이 없을 때. 문구는 고정 문구와 같다. */
    public static PushMessage message(PushTarget target, EveningReminderExperiment.Variant variant) {
        return new PushMessage(target.token(), defaultTitle(target.korean()), defaultBody(target.korean()),
                Map.of("kind", KIND, "variant", variant.code(), "personalized", "false"));
    }

    /** B 문구. {@code line} 은 {@link ReminderLineWriter} 가 검사를 마친 한 줄이다. */
    public static PushMessage personal(PushTarget target, String line) {
        return new PushMessage(target.token(),
                target.korean() ? "지난번에 정한 거, 오늘 해 볼까요?" : "Try what you planned last time?",
                line,
                Map.of("kind", KIND, "variant", EveningReminderExperiment.Variant.B.code(), "personalized", "true"));
    }

    private static String defaultTitle(boolean korean) {
        return korean ? "오늘 연습 아직이에요" : "No practice yet today";
    }

    private static String defaultBody(boolean korean) {
        return korean ? "5분이면 돼요. 장면 하나 찍거나 대본 한 번 읽어 볼까요?"
                : "Five minutes is enough. Shoot one scene or run a script?";
    }
}
