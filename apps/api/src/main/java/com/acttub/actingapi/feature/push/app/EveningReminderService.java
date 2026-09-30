package com.acttub.actingapi.feature.push.app;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class EveningReminderService {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private final EveningReminderRepository reminders;
    private final PushTokenRepository tokens;
    private final PushSender sender;
    private final FailureReporter failures;
    private final Clock clock;
    private final String minimumVersion;

    public EveningReminderService(EveningReminderRepository reminders, PushTokenRepository tokens,
            PushSender sender, FailureReporter failures, Clock clock,
            @Value("${EVENING_REMINDER_MIN_APP_VERSION:0.1.2}") String minimumVersion) {
        this.reminders = reminders; this.tokens = tokens; this.sender = sender;
        this.failures = failures; this.clock = clock; this.minimumVersion = minimumVersion;
    }

    public void sendDaily() {
        try {
            LocalDate day = LocalDate.now(clock.withZone(SEOUL));
            var start = day.atStartOfDay(SEOUL).toInstant();
            List<PushTarget> targets = reminders.claimTargets(day, start,
                    day.plusDays(1).atStartOfDay(SEOUL).toInstant(), start.minusSeconds(30L * 86400), minimumVersion);
            if (!targets.isEmpty()) sender.send(targets.stream().map(EveningReminder::message).toList())
                    .forEach(tokens::unregister);
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("EveningReminderService.sendDaily"));
        }
    }
}
