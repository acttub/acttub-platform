package com.acttub.actingapi.feature.push.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import com.acttub.actingapi.feature.push.app.EveningReminderExperiment.Variant;
import com.acttub.actingapi.feature.push.app.EveningReminderRepository.NextTake;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class EveningReminderService {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final long RECENT_DAYS = 30;
    /**
     * B 문구를 만드는 데 쓸 시간의 상한. 한 줄마다 모델을 부르므로 대상이 많거나 모델이 느리면 20시 알림이 늦어진다.
     * 넘기면 남은 사람은 고정 문구를 받는다 — 알림이 늦는 것보다 문구가 평범한 편이 낫다.
     */
    static final Duration WRITING_BUDGET = Duration.ofMinutes(3);

    private final EveningReminderRepository reminders;
    private final PushTokenRepository tokens;
    private final PushSender sender;
    private final FailureReporter failures;
    private final Clock clock;
    private final String minimumVersion;
    private final ReminderLineWriter writer;
    private final boolean experiment;

    public EveningReminderService(EveningReminderRepository reminders, PushTokenRepository tokens,
            PushSender sender, FailureReporter failures, Clock clock,
            @Value("${EVENING_REMINDER_MIN_APP_VERSION:0.1.2}") String minimumVersion,
            ReminderLineWriter writer,
            @Value("${ACTTUB_EVENING_REMINDER_PERSONAL_AB_ENABLED:false}") boolean experiment) {
        this.reminders = reminders; this.tokens = tokens; this.sender = sender;
        this.failures = failures; this.clock = clock; this.minimumVersion = minimumVersion;
        this.writer = writer; this.experiment = experiment;
    }

    public void sendDaily() {
        try {
            LocalDate day = LocalDate.now(clock.withZone(SEOUL));
            var start = day.atStartOfDay(SEOUL).toInstant();
            Instant recentSince = start.minusSeconds(RECENT_DAYS * 86400);
            List<ReminderTarget> targets = reminders.claimTargets(day, start,
                    day.plusDays(1).atStartOfDay(SEOUL).toInstant(), recentSince, minimumVersion);
            if (targets.isEmpty()) return;
            List<PushMessage> messages = experiment ? experimentMessages(targets, recentSince)
                    : targets.stream().map(target -> EveningReminder.message(target.device())).toList();
            sender.send(messages).forEach(tokens::unregister);
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("EveningReminderService.sendDaily"));
        }
    }

    /**
     * 회원마다 A/B 를 정하고, B 이면서 지난 노트에 해볼 한 가지가 있는 사람에게만 한 줄을 만든다. 한 사람의 단말이
     * 여러 대면 말(한국어·영어)마다 한 번만 만든다. 한 줄을 못 만들면 그 사람은 B 쪽이지만 고정 문구를 받는다.
     */
    private List<PushMessage> experimentMessages(List<ReminderTarget> targets, Instant recentSince) {
        Map<UUID, List<ReminderTarget>> byUser = new LinkedHashMap<>();
        for (ReminderTarget target : targets) byUser.computeIfAbsent(target.userId(), ignored -> new ArrayList<>()).add(target);

        List<UUID> bUsers = byUser.keySet().stream().filter(id -> EveningReminderExperiment.variantOf(id) == Variant.B).toList();
        Map<UUID, NextTake> nextTakes = Map.of();
        try {
            nextTakes = reminders.latestNextTakes(bUsers, recentSince);
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("EveningReminderService.latestNextTakes"));
        }

        Instant deadline = clock.instant().plus(WRITING_BUDGET);
        List<PushMessage> messages = new ArrayList<>();
        for (var entry : byUser.entrySet()) {
            UUID userId = entry.getKey();
            Variant variant = EveningReminderExperiment.variantOf(userId);
            NextTake nextTake = variant == Variant.B ? nextTakes.get(userId) : null;
            Map<Boolean, Optional<String>> lines = new LinkedHashMap<>();
            for (ReminderTarget target : entry.getValue()) {
                PushTarget device = target.device();
                Optional<String> line = Optional.empty();
                if (nextTake != null) {
                    line = lines.computeIfAbsent(device.korean(), korean -> clock.instant().isBefore(deadline)
                            ? write(userId, nextTake, korean) : Optional.empty());
                }
                messages.add(line.map(text -> EveningReminder.personal(device, text))
                        .orElseGet(() -> EveningReminder.message(device, variant)));
            }
        }
        return messages;
    }

    private Optional<String> write(UUID userId, NextTake nextTake, boolean korean) {
        try {
            return writer.write(userId, nextTake.practiceId(), nextTake.text(), korean);
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("EveningReminderService.write"));
            return Optional.empty();
        }
    }
}
