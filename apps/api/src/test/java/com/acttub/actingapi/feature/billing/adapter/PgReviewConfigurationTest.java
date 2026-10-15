package com.acttub.actingapi.feature.billing.adapter;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;

import com.acttub.actingapi.feature.billing.adapter.toss.TossBillingGateway;
import com.acttub.actingapi.feature.billing.app.PgReviewGateway;
import com.acttub.actingapi.feature.billing.app.PgReviewService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class PgReviewConfigurationTest {
    private static final String HASH = "a".repeat(64);
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(PgReviewConfiguration.class)
            .withBean(Clock.class, Clock::systemUTC);

    private String[] valid(String... extra) {
        java.util.List<String> props = new java.util.ArrayList<>(java.util.List.of(
                "ACTTUB_PG_REVIEW_ENABLED=true",
                "ACTTUB_PG_REVIEW_ORIGIN=https://acttub.example",
                "ACTTUB_PG_REVIEW_USERNAME=reviewer",
                "ACTTUB_PG_REVIEW_PASSWORD_SHA256=" + HASH,
                "ACTTUB_PG_REVIEW_TOSS_CLIENT_KEY=test_ck_abcdefgh1234",
                "ACTTUB_PG_REVIEW_TOSS_SECRET_KEY=test_sk_abcdefgh1234"));
        props.addAll(java.util.List.of(extra));
        return props.toArray(String[]::new);
    }

    @Test
    void absentByDefault() {
        runner.run(context -> assertThat(context).doesNotHaveBean(PgReviewService.class));
        runner.withPropertyValues("ACTTUB_PG_REVIEW_ENABLED=false").run(context ->
                assertThat(context).doesNotHaveBean(PgReviewService.class).doesNotHaveBean(PgReviewGateway.class));
    }

    @Test
    void enabledWithTestKeysIsAvailableAndUsesTheTossGateway() {
        runner.withPropertyValues(valid()).run(context -> {
            assertThat(context).hasSingleBean(PgReviewService.class);
            assertThat(context.getBean(PgReviewService.class).available()).isTrue();
            assertThat(context.getBean(PgReviewGateway.class)).isInstanceOf(TossBillingGateway.class);
        });
    }

    @Test
    void enabledWithLiveKeyBootsButStaysClosed() {
        runner.withPropertyValues(valid("ACTTUB_PG_REVIEW_TOSS_SECRET_KEY=live_sk_abcdefgh1234")).run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBean(PgReviewService.class).available()).isFalse();
        });
        runner.withPropertyValues(valid("ACTTUB_PG_REVIEW_TOSS_CLIENT_KEY=live_ck_abcdefgh1234")).run(context ->
                assertThat(context.getBean(PgReviewService.class).available()).isFalse());
        runner.withPropertyValues("ACTTUB_PG_REVIEW_ENABLED=true").run(context ->
                assertThat(context.getBean(PgReviewService.class).available()).isFalse());
    }
}
