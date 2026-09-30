package com.acttub.actingapi.feature.push.adapter.sched;

import com.acttub.actingapi.feature.push.app.EveningReminderService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "EVENING_REMINDER_ENABLED", havingValue = "true", matchIfMissing = true)
class EveningReminderScheduler {
    private final EveningReminderService reminders;
    EveningReminderScheduler(EveningReminderService reminders) { this.reminders = reminders; }

    @Scheduled(cron = "${EVENING_REMINDER_CRON:0 0 20 * * *}", zone = "Asia/Seoul")
    void run() { reminders.sendDaily(); }
}
