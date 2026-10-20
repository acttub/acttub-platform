package com.acttub.actingapi.feature.push.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

/** 저녁 알림 — 서울 날짜로 하루를 잡아 대상을 고르고, 말에 맞춘 문구를 보내고, 죽은 토큰을 지운다 (account.notification). */
class EveningReminderServiceTest {
    /** 서울 2026-10-20 20:30 = UTC 11:30. */
    private static final Clock EVENING = Clock.fixed(Instant.parse("2026-10-20T11:30:00Z"), ZoneOffset.UTC);

    private final List<String> claims = new ArrayList<>();
    private final List<PushMessage> sent = new ArrayList<>();
    private final List<String> unregistered = new ArrayList<>();
    private final RecordingFailureReporter failures = new RecordingFailureReporter();

    private EveningReminderService service(List<PushTarget> targets, List<String> deadTokens) {
        EveningReminderRepository reminders = (day, start, end, recentSince, minimumVersion) -> {
            claims.add(day + " " + start + " " + end + " " + recentSince + " " + minimumVersion);
            return targets;
        };
        PushSender sender = messages -> {
            sent.addAll(messages);
            return deadTokens;
        };
        PushTokenRepository tokens = new PushTokenRepository() {
            @Override
            public void register(UUID userId, String token, String platform, String appVersion) {
                throw new AssertionError("reminders do not register tokens");
            }

            @Override
            public void unregister(String token) {
                unregistered.add(token);
            }

            @Override
            public List<PushTarget> analysisDoneTargets(UUID sessionId) {
                return List.of();
            }
        };
        return new EveningReminderService(reminders, tokens, sender, failures, EVENING, "0.1.2");
    }

    @Test
    void claimsTheSeoulDayAndSendsLocalizedRemindersThenDropsDeadTokens() {
        service(List.of(new PushTarget("ExpoPushToken[ko]", "ko"), new PushTarget("ExpoPushToken[en]", "en")),
                List.of("ExpoPushToken[en]")).sendDaily();

        assertThat(claims).containsExactly(
                "2026-10-20 2026-10-19T15:00:00Z 2026-10-20T15:00:00Z 2026-09-19T15:00:00Z 0.1.2");
        assertThat(sent).extracting(PushMessage::to, PushMessage::title).containsExactly(
                org.assertj.core.groups.Tuple.tuple("ExpoPushToken[ko]", "오늘 연습 아직이에요"),
                org.assertj.core.groups.Tuple.tuple("ExpoPushToken[en]", "No practice yet today"));
        assertThat(sent.getFirst().data()).containsEntry("kind", "evening_reminder");
        assertThat(unregistered).containsExactly("ExpoPushToken[en]");
    }

    @Test
    void nobodyToRemindSendsNothing() {
        service(List.of(), List.of("never")).sendDaily();

        assertThat(claims).hasSize(1);
        assertThat(sent).isEmpty();
        assertThat(unregistered).isEmpty();
    }

    @Test
    void failureIsReportedAndDoesNotEscapeTheScheduler() {
        EveningReminderRepository broken = (day, start, end, recentSince, minimumVersion) -> {
            throw new IllegalStateException("db down");
        };
        new EveningReminderService(broken, null, null, failures, EVENING, "0.1.2").sendDaily();

        assertThat(failures.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).hasMessage("db down");
            assertThat(report.context()).isEqualTo("EveningReminderService.sendDaily");
        });
    }
}
