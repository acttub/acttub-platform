package com.acttub.actingapi.feature.push.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;
import com.acttub.actingapi.feature.push.app.EveningReminderExperiment.Variant;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;

class EveningReminderServiceTest {
    private static final Instant NOW = Instant.parse("2026-10-14T11:00:00Z"); // 20:00 KST
    private final MutableClock clock = new MutableClock(NOW);
    private final RecordingFailureReporter failures = new RecordingFailureReporter();
    private final FakeReminders reminders = new FakeReminders();
    private final FakeSender sender = new FakeSender();
    private final AtomicInteger modelCalls = new AtomicInteger();
    private TextGenerator model = (instructions, input) -> {
        modelCalls.incrementAndGet();
        return new GeneratedText(instructions.startsWith("너는") ? "상대가 흔들리는지 보면서 한 번 더 찍어 봐요."
                : "Hold your gaze on your partner. One more take?", null);
    };

    private EveningReminderService service(boolean experiment) {
        TextGenerator delegating = (instructions, input) -> model.generate(instructions, input);
        return new EveningReminderService(reminders, new NoTokens(), sender, failures, clock, "0.1.2",
                new ReminderLineWriter(delegating, new RecordingLlmTelemetry()), experiment);
    }

    /** 실험이 꺼져 있으면 지금과 똑같다 — 모델도 노트도 보지 않는다. */
    @Test void experimentOffSendsFixedCopyOnly() {
        UUID b = userWith(Variant.B);
        reminders.targets = List.of(new ReminderTarget(b, "t-b", "ko"));
        reminders.nextTakes = Map.of(b, new EveningReminderRepository.NextTake(UUID.randomUUID(), "상대를 보며 따져 봐요"));

        service(false).sendDaily();

        assertThat(sender.sent).singleElement().satisfies(m -> {
            assertThat(m.title()).isEqualTo("오늘 연습 아직이에요");
            assertThat(m.data()).containsExactlyEntriesOf(Map.of("kind", "evening_reminder"));
        });
        assertThat(modelCalls).hasValue(0);
        assertThat(reminders.askedFor).isNull();
    }

    @Test void bWithNextTakeGetsPersonalLineAndAGetsFixedCopy() {
        UUID a = userWith(Variant.A);
        UUID b = userWith(Variant.B);
        UUID bWithoutNote = userWith(Variant.B);
        reminders.targets = List.of(new ReminderTarget(a, "t-a", "ko"), new ReminderTarget(b, "t-b", "ko"),
                new ReminderTarget(bWithoutNote, "t-b2", "ko"));
        reminders.nextTakes = Map.of(b, new EveningReminderRepository.NextTake(UUID.randomUUID(),
                "처음부터 끝까지 상대가 내 말에 흔들리는지 확인하며 따져 봐도 좋아요."));

        service(true).sendDaily();

        assertThat(reminders.askedFor).containsExactlyInAnyOrder(b, bWithoutNote);
        assertThat(sender.byToken("t-a").data()).containsEntry("variant", "a").containsEntry("personalized", "false");
        assertThat(sender.byToken("t-a").title()).isEqualTo("오늘 연습 아직이에요");
        assertThat(sender.byToken("t-b").title()).isEqualTo("지난번에 정한 거, 오늘 해 볼까요?");
        assertThat(sender.byToken("t-b").body()).isEqualTo("상대가 흔들리는지 보면서 한 번 더 찍어 봐요.");
        assertThat(sender.byToken("t-b2").data()).containsEntry("variant", "b").containsEntry("personalized", "false");
        assertThat(modelCalls).hasValue(1);
    }

    /** 단말이 여러 대여도 말마다 한 번만 만든다. */
    @Test void writesOncePerLanguagePerUser() {
        UUID b = userWith(Variant.B);
        reminders.targets = List.of(new ReminderTarget(b, "ko-1", "ko"), new ReminderTarget(b, "ko-2", "ko"),
                new ReminderTarget(b, "en-1", "en"));
        reminders.nextTakes = Map.of(b, new EveningReminderRepository.NextTake(UUID.randomUUID(), "상대를 보며 따져 봐요"));

        service(true).sendDaily();

        assertThat(modelCalls).hasValue(2);
        assertThat(sender.byToken("en-1").body()).isEqualTo("Hold your gaze on your partner. One more take?");
    }

    /** 모델 출력이 검사를 못 넘으면 고정 문구로 간다. */
    @Test void rejectedLineFallsBackToFixedCopy() {
        model = (instructions, input) -> new GeneratedText("SKIP", null);
        UUID b = userWith(Variant.B);
        reminders.targets = List.of(new ReminderTarget(b, "t-b", "ko"));
        reminders.nextTakes = Map.of(b, new EveningReminderRepository.NextTake(UUID.randomUUID(), "잘 보여요"));

        service(true).sendDaily();

        assertThat(sender.byToken("t-b").title()).isEqualTo("오늘 연습 아직이에요");
        assertThat(sender.byToken("t-b").data()).containsEntry("personalized", "false");
    }

    /** 문구 만드는 시간이 상한을 넘기면 남은 사람은 모델을 부르지 않고 고정 문구를 받는다. */
    @Test void stopsWritingAfterBudget() {
        model = (instructions, input) -> {
            modelCalls.incrementAndGet();
            clock.advance(EveningReminderService.WRITING_BUDGET.plus(Duration.ofSeconds(1)));
            return new GeneratedText("상대를 보며 한 번 더 해 봐요.", null);
        };
        UUID first = userWith(Variant.B);
        UUID second = userWith(Variant.B);
        reminders.targets = List.of(new ReminderTarget(first, "t-1", "ko"), new ReminderTarget(second, "t-2", "ko"));
        reminders.nextTakes = Map.of(
                first, new EveningReminderRepository.NextTake(UUID.randomUUID(), "상대를 보며 따져 봐요"),
                second, new EveningReminderRepository.NextTake(UUID.randomUUID(), "상대를 보며 따져 봐요"));

        service(true).sendDaily();

        assertThat(modelCalls).hasValue(1);
        assertThat(sender.byToken("t-1").data()).containsEntry("personalized", "true");
        assertThat(sender.byToken("t-2").data()).containsEntry("personalized", "false");
    }

    /** 노트를 못 읽어도 알림은 나간다 — 모두 고정 문구로. */
    @Test void noteLookupFailureStillSends() {
        UUID b = userWith(Variant.B);
        reminders.targets = List.of(new ReminderTarget(b, "t-b", "ko"));
        reminders.failNextTakes = true;

        service(true).sendDaily();

        assertThat(sender.byToken("t-b").title()).isEqualTo("오늘 연습 아직이에요");
        assertThat(failures.contexts()).contains("EveningReminderService.latestNextTakes");
    }

    private static UUID userWith(Variant variant) {
        return Stream.generate(UUID::randomUUID).filter(id -> EveningReminderExperiment.variantOf(id) == variant)
                .findFirst().orElseThrow();
    }

    private static final class FakeReminders implements EveningReminderRepository {
        List<ReminderTarget> targets = List.of();
        Map<UUID, NextTake> nextTakes = Map.of();
        Collection<UUID> askedFor;
        boolean failNextTakes;

        @Override
        public List<ReminderTarget> claimTargets(LocalDate day, Instant dayStart, Instant dayEnd, Instant recentSince,
                String minimumAppVersion) {
            return targets;
        }

        @Override
        public Map<UUID, NextTake> latestNextTakes(Collection<UUID> userIds, Instant since) {
            askedFor = List.copyOf(userIds);
            if (failNextTakes) throw new IllegalStateException("db down");
            return nextTakes;
        }
    }

    private static final class FakeSender implements PushSender {
        final List<PushMessage> sent = new ArrayList<>();

        @Override
        public List<String> send(List<PushMessage> messages) {
            sent.addAll(messages);
            return List.of();
        }

        PushMessage byToken(String token) {
            return sent.stream().filter(m -> m.to().equals(token)).findFirst().orElseThrow();
        }
    }

    private static final class NoTokens implements PushTokenRepository {
        @Override public void register(UUID userId, String token, String platform, String appVersion) {}
        @Override public void unregister(String token) {}
        @Override public List<PushTarget> analysisDoneTargets(UUID sessionId) { return List.of(); }
    }
}
