package com.acttub.actingapi.feature.push.adapter.sched;

import com.acttub.actingapi.feature.push.app.PracticeReminderService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 개인화 연습 알림(SOMA-720). {@code PRACTICE_REMINDER_ENABLED=true} 일 때만 서고, 그때는 옛 저녁 8시 알림이 서지 않는다. */
@Component
@ConditionalOnProperty(name = "PRACTICE_REMINDER_ENABLED", havingValue = "true")
class PracticeReminderScheduler {
    private final PracticeReminderService reminders;
    PracticeReminderScheduler(PracticeReminderService reminders) { this.reminders = reminders; }

    @Scheduled(cron = "${PRACTICE_REMINDER_CRON:0 */10 * * * *}", zone = "Asia/Seoul")
    void run() { reminders.sendDue(); }
}
