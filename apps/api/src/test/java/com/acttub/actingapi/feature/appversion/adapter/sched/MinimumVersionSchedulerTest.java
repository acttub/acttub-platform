package com.acttub.actingapi.feature.appversion.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.appversion.app.MinimumVersionService;
import com.acttub.actingapi.feature.appversion.app.MinimumVersionStore;
import com.acttub.actingapi.feature.appversion.domain.AppVersion;
import com.acttub.actingapi.feature.appversion.domain.MinimumVersionState;
import com.acttub.actingapi.feature.appversion.domain.StorePlatform;
import com.acttub.actingapi.support.RecordingFailureReporter;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class MinimumVersionSchedulerTest {

    private final RecordingFailureReporter failures = new RecordingFailureReporter();

    private static MinimumVersionService service(MinimumVersionStore store) {
        return new MinimumVersionService(platform -> Optional.of(new AppVersion(1, 2, 0)), store,
                (platform, from, to, live) -> { }, Duration.ZERO, Clock.systemUTC());
    }

    @Test
    void 회차마다_서비스를_부르고_실패는_보고만_한다() {
        MinimumVersionStore broken = new MinimumVersionStore() {
            @Override
            public Map<StorePlatform, MinimumVersionState> load() {
                throw new IllegalStateException("db down");
            }

            @Override
            public void observe(StorePlatform platform, AppVersion storeVersion, Instant now) {
            }

            @Override
            public boolean raise(StorePlatform platform, AppVersion from, AppVersion to, Instant now) {
                return false;
            }
        };
        MinimumVersionScheduler scheduler = new MinimumVersionScheduler(service(broken), failures);

        scheduler.refresh();
        scheduler.check();

        assertThat(failures.contexts()).containsExactly(
                "MinimumVersionScheduler.refresh", "MinimumVersionScheduler.check");
    }
}
