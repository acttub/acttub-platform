package com.acttub.actingapi.feature.push.adapter.sched;

import com.acttub.actingapi.feature.push.app.EveningReminderService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
// 개인화 연습 알림(PRACTICE_REMINDER_ENABLED, SOMA-720)이 켜지면 이 고정 알림은 서지 않는다. 꺼져 있으면 예전 그대로 돈다.
@ConditionalOnExpression("${EVENING_REMINDER_ENABLED:true} and !${PRACTICE_REMINDER_ENABLED:false}")
class EveningReminderScheduler {
    private final EveningReminderService reminders;
    EveningReminderScheduler(EveningReminderService reminders) { this.reminders = reminders; }

    @Scheduled(cron = "${EVENING_REMINDER_CRON:0 0 20 * * *}", zone = "Asia/Seoul")
    void run() { reminders.sendDaily(); }
}
