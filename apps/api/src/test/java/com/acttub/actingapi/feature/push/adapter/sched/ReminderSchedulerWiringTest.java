package com.acttub.actingapi.feature.push.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.acttub.actingapi.feature.push.app.EveningReminderService;
import com.acttub.actingapi.feature.push.app.PracticeReminderService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/** PRACTICE_REMINDER_ENABLED 스위치: 켜면 새 알림만, 끄거나 없으면 예전 저녁 8시 알림만 돈다. */
class ReminderSchedulerWiringTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withBean(EveningReminderService.class, () -> mock(EveningReminderService.class))
            .withBean(PracticeReminderService.class, () -> mock(PracticeReminderService.class))
            .withUserConfiguration(EveningReminderScheduler.class, PracticeReminderScheduler.class);

    @Test
    void flagUnsetKeepsTodaysBehavior() {
        runner.run(context -> {
            assertThat(context).hasSingleBean(EveningReminderScheduler.class);
            assertThat(context).doesNotHaveBean(PracticeReminderScheduler.class);
        });
    }

    @Test
    void flagFalseKeepsTodaysBehavior() {
        runner.withPropertyValues("PRACTICE_REMINDER_ENABLED=false").run(context -> {
            assertThat(context).hasSingleBean(EveningReminderScheduler.class);
            assertThat(context).doesNotHaveBean(PracticeReminderScheduler.class);
        });
    }

    @Test
    void flagTrueSwapsInThePracticeReminderAndSilencesTheFixedOne() {
        runner.withPropertyValues("PRACTICE_REMINDER_ENABLED=true").run(context -> {
            assertThat(context).hasSingleBean(PracticeReminderScheduler.class);
            assertThat(context).doesNotHaveBean(EveningReminderScheduler.class);
        });
    }

    @Test
    void eveningReminderStillHonorsItsOwnSwitch() {
        runner.withPropertyValues("EVENING_REMINDER_ENABLED=false").run(context -> {
            assertThat(context).doesNotHaveBean(EveningReminderScheduler.class);
            assertThat(context).doesNotHaveBean(PracticeReminderScheduler.class);
        });
        runner.withPropertyValues("EVENING_REMINDER_ENABLED=false", "PRACTICE_REMINDER_ENABLED=true").run(context -> {
            assertThat(context).hasSingleBean(PracticeReminderScheduler.class);
            assertThat(context).doesNotHaveBean(EveningReminderScheduler.class);
        });
    }
}
