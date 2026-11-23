package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.stream.Collectors;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.support.ScheduledTaskObservationContext;

/** 주기 작업 한 줄을 남기는 기준: 실패·cron·느린 회차, 그리고 처리한 것이 있는 비우기. 빈 폴은 남기지 않는다. */
class ScheduledTaskLogTest {
    private final Logger logger = (Logger) LoggerFactory.getLogger(ScheduledTaskLog.class);
    private final ListAppender<ILoggingEvent> events = new ListAppender<>();
    private final ScheduledTaskLog handler = new ScheduledTaskLog();

    @BeforeEach
    void attach() {
        events.start();
        logger.addAppender(events);
    }

    @AfterEach
    void detach() {
        logger.detachAppender(events);
    }

    @Test
    void quietPollIsSilentButCronAndFailureAreLogged() throws Exception {
        run("poll", null);
        assertThat(events.list).isEmpty();

        run("nightly", null);
        run("poll", new IllegalStateException("db down"));

        assertThat(events.list).hasSize(2);
        assertThat(fields(events.list.get(0)))
                .containsEntry("task", "Jobs.nightly").containsEntry("outcome", "success").containsKey("took_ms");
        assertThat(events.list.get(1).getLevel()).isEqualTo(Level.ERROR);
        assertThat(fields(events.list.get(1)))
                .containsEntry("task", "Jobs.poll").containsEntry("outcome", "error")
                .containsEntry("error", IllegalStateException.class.getName());
        // 예외 메시지는 싣지 않는다.
        assertThat(events.list.get(1).getFormattedMessage()).doesNotContain("db down");
    }

    @Test
    void drainIsLoggedOnlyWhenItProcessedSomething() {
        ScheduledTaskLog.drained("Jobs.drain", 0, System.nanoTime());
        ScheduledTaskLog.drained("Jobs.drain", 3, System.nanoTime());

        assertThat(events.list).hasSize(1);
        assertThat(fields(events.list.get(0))).containsEntry("task", "Jobs.drain").containsEntry("processed", 3);
    }

    private void run(String method, Throwable error) throws Exception {
        var context = new ScheduledTaskObservationContext(new Jobs(), Jobs.class.getDeclaredMethod(method));
        handler.onStart(context);
        if (error != null) context.setError(error);
        handler.onStop(context);
    }

    private static Map<String, Object> fields(ILoggingEvent event) {
        return event.getKeyValuePairs().stream().collect(Collectors.toMap(pair -> pair.key, pair -> pair.value));
    }

    static class Jobs {
        @Scheduled(fixedDelay = 1000)
        void poll() {
        }

        @Scheduled(cron = "0 0 4 * * *")
        void nightly() {
        }
    }
}
