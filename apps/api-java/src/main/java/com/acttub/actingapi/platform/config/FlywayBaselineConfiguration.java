package com.acttub.actingapi.platform.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 이미 스키마가 있는 DB(dev·운영)에 baseline 기록만 남기는 1회용 모드.
 *
 * <p>그 DB들은 alembic이 만든 24 테이블이 이미 있고 {@code flyway_schema_history}는
 * 없다. 그대로 기동하면 Flyway가 "비어 있지 않은데 히스토리가 없다"며 부팅을 막는다.
 * {@code baseline-on-migrate}를 켜면 풀리지만, 그건 <b>빈 DB에서도</b> V1을 건너뛰게
 * 만들어 신규 환경·재해 복구에서 스키마가 통째로 생기지 않는다. 그래서 상시 설정이
 * 아니라 이 환경변수를 준 기동에서만 baseline을 찍는다.
 *
 * <p>절차는 전환당 한 번이다 — {@code FLYWAY_BASELINE_ONLY=true}로 한 번 띄워 기록을
 * 남기고, 환경변수를 지운 뒤 정상 기동한다. 이 모드에서는 마이그레이션을 실행하지
 * 않으므로 DDL이 돌지 않는다.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "FLYWAY_BASELINE_ONLY", havingValue = "true")
class FlywayBaselineConfiguration {

    private static final Logger LOG =
            LoggerFactory.getLogger(FlywayBaselineConfiguration.class);

    @Bean
    FlywayMigrationStrategy baselineOnlyStrategy() {
        return flyway -> {
            flyway.baseline();
            LOG.warn("FLYWAY_BASELINE_ONLY: baseline 만 기록했다 — 마이그레이션은 실행하지 않았다."
                    + " 다음 기동에서는 이 환경변수를 지운다.");
        };
    }
}
