package com.acttub.actingapi.platform.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class FlywayBaselineConfigurationTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(FlywayBaselineConfiguration.class);

    /**
     * 이 전략이 실수로 상시 켜지면 빈 DB에서도 V1이 건너뛰어져 스키마가 통째로 생기지
     * 않는다. 신규 환경과 재해 복구가 조용히 망가지는 자리라 조건을 고정한다.
     */
    @Test
    @DisplayName("baseline 전략은 명시적으로 요청했을 때만 등록된다")
    void strategyIsAbsentUnlessExplicitlyRequested() {
        runner.run(context -> assertThat(context)
                .doesNotHaveBean(FlywayMigrationStrategy.class));
        runner.withPropertyValues("FLYWAY_BASELINE_ONLY=false")
                .run(context -> assertThat(context)
                        .doesNotHaveBean(FlywayMigrationStrategy.class));
    }

    @Test
    @DisplayName("요청하면 마이그레이션 대신 baseline 만 찍는다")
    void requestedStrategyBaselinesInsteadOfMigrating() {
        runner.withPropertyValues("FLYWAY_BASELINE_ONLY=true").run(context -> {
            assertThat(context).hasNotFailed();
            FlywayMigrationStrategy strategy = context.getBean(FlywayMigrationStrategy.class);

            Flyway flyway = mock(Flyway.class);
            strategy.migrate(flyway);

            verify(flyway).baseline();
            verify(flyway, never()).migrate();
        });
    }
}
