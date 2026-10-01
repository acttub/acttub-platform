package com.acttub.actingapi.feature.push.app;

import java.util.Map;

public final class EveningReminder {
    private EveningReminder() {}

    public static PushMessage message(PushTarget target) {
        boolean korean = target.korean();
        return new PushMessage(
                target.token(),
                korean ? "오늘 연습 아직이에요" : "No practice yet today",
                korean ? "5분이면 돼요. 장면 하나 찍거나 대본 한 번 읽어 볼까요?"
                        : "Five minutes is enough. Shoot one scene or run a script?",
                Map.of("kind", "evening_reminder"));
    }
}
