package com.acttub.actingapi.feature.billing.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;

import com.acttub.actingapi.support.MutableClock;
import org.junit.jupiter.api.Test;

/** PG 심사 세션·시도의 상태 — 지난 세션 정리, 발급 전 콜백, 맞지 않는 state 의 실패 (billing.pg-review). */
class PgReviewSessionsTest {
    private static final Instant NOW = Instant.parse("2026-10-20T00:00:00Z");

    @Test
    void sessionsExpireAndUnusableIdsFindNothing() {
        MutableClock clock = new MutableClock(NOW);
        PgReviewSessions sessions = new PgReviewSessions(clock);
        PgReviewSessions.Session session = sessions.open().orElseThrow();

        assertThat(sessions.size()).isEqualTo(1);
        assertThat(sessions.find(session.id())).contains(session);
        assertThat(sessions.find(null)).isEmpty();
        assertThat(sessions.find("")).isEmpty();
        assertThat(sessions.find("x".repeat(129))).isEmpty();

        clock.advance(Duration.ofDays(2));

        assertThat(sessions.size()).isZero();
        assertThat(sessions.find(session.id())).isEmpty();
        sessions.close(null);
    }

    @Test
    void callbackBeforeAnyCheckoutHasNothingToProcessAndFailureNeedsTheIssuedState() {
        PgReviewSessions.Session session = new PgReviewSessions(new MutableClock(NOW)).open().orElseThrow();

        assertThat(session.begin("state", "customer", NOW)).isEqualTo(PgReviewSessions.Begin.NO_CHECKOUT);
        assertThat(session.fail("state", "USER_CANCEL", "취소")).isFalse();

        PgReviewSessions.Checkout checkout = session.startCheckout(NOW).orElseThrow();

        assertThat(session.fail("other-state", "USER_CANCEL", "취소")).isFalse();
        assertThat(session.fail(null, "USER_CANCEL", "취소")).isFalse();
        assertThat(session.fail(checkout.state(), "USER_CANCEL", "취소")).isTrue();
        assertThat(session.result().status()).isEqualTo("failed");
        assertThat(session.fail(checkout.state(), "USER_CANCEL", "취소")).as("이미 닫힌 시도").isFalse();
    }

    @Test
    void anUnknownResultBlocksAnotherCheckout() {
        PgReviewSessions.Session session = new PgReviewSessions(new MutableClock(NOW)).open().orElseThrow();
        session.startCheckout(NOW).orElseThrow();

        session.finish(PgReviewResult.unknown("pgr-o", "timeout"));

        assertThat(session.startCheckout(NOW)).isEmpty();
    }
}
