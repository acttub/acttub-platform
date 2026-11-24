package com.acttub.actingapi.feature.push.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.acttub.actingapi.feature.push.app.PracticeReminderService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/** PRACTICE_REMINDER_ENABLED 스위치: 켜면 연습 알림이 돌고, 끄거나 없으면 아무 알림도 돌지 않는다. */
class ReminderSchedulerWiringTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withBean(PracticeReminderService.class, () -> mock(PracticeReminderService.class))
            .withUserConfiguration(PracticeReminderScheduler.class);

    @Test
    void flagUnsetSendsNothing() {
        runner.run(context -> assertThat(context).doesNotHaveBean(PracticeReminderScheduler.class));
    }

    @Test
    void flagFalseSendsNothing() {
        runner.withPropertyValues("PRACTICE_REMINDER_ENABLED=false")
                .run(context -> assertThat(context).doesNotHaveBean(PracticeReminderScheduler.class));
    }

    @Test
    void flagTrueRunsThePracticeReminder() {
        runner.withPropertyValues("PRACTICE_REMINDER_ENABLED=true")
                .run(context -> assertThat(context).hasSingleBean(PracticeReminderScheduler.class));
    }
}
