package com.acttub.actingapi.feature.billing.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

import com.acttub.actingapi.support.MutableClock;
import org.junit.jupiter.api.Test;

/** PG 심사 결제 흐름의 막다른 길 — 빈 자격, 잘못된 authKey, 토스의 이상한 답과 코드 (billing.pg-review). */
class PgReviewServiceTest {
    private static final Instant NOW = Instant.parse("2026-10-20T00:00:00Z");

    private final List<String> calls = new ArrayList<>();
    private PgReviewGateway.Approval approval;
    private PgReviewGateway.GatewayException issueFailure;

    private PgReviewService service() throws Exception {
        String hash = HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest("pw".getBytes(StandardCharsets.UTF_8)));
        PgReviewSettings settings = new PgReviewSettings("https://r.acttub.com", "reviewer", hash,
                "test_ck_abcdefgh12", "test_sk_abcdefgh12");
        PgReviewGateway gateway = new PgReviewGateway() {
            @Override
            public String issueBillingKey(String authKey, String customerKey) {
                calls.add("issue " + authKey);
                if (issueFailure != null) {
                    throw issueFailure;
                }
                return "BK";
            }

            @Override
            public Approval approve(String billingKey, String customerKey, String orderId, long amount,
                    String orderName, String idempotencyKey) {
                calls.add("approve " + billingKey);
                return approval;
            }
        };
        MutableClock clock = new MutableClock(NOW);
        return new PgReviewService(settings, new PgReviewSessions(clock), gateway, clock);
    }

    private static PgReviewSessions.Session checkedOut(PgReviewService service) {
        PgReviewSessions.Session session = service.login("reviewer", "pw").orElseThrow();
        service.checkout(session).orElseThrow();
        return session;
    }

    @Test
    void missingCredentialsDoNotLogIn() throws Exception {
        assertThat(service().login(null, null)).isEmpty();
        assertThat(service().login("reviewer", "wrong")).isEmpty();
        assertThat(service().login("reviewer", "pw")).isPresent();
    }

    @Test
    void blankOrOversizedAuthKeyFailsWithoutCallingToss() throws Exception {
        PgReviewService service = service();
        PgReviewSessions.Session blank = checkedOut(service);
        PgReviewSessions.Session oversized = checkedOut(service);

        service.completeRegistration(blank, blank.checkout().state(), blank.checkout().customerKey(), " ");
        service.completeRegistration(oversized, oversized.checkout().state(), oversized.checkout().customerKey(),
                "k".repeat(201));

        assertThat(blank.result().errorCode()).isEqualTo("auth_key_missing");
        assertThat(oversized.result().errorCode()).isEqualTo("auth_key_missing");
        assertThat(calls).isEmpty();
    }

    @Test
    void approvalWithoutAnAnswerIsUnknownAndOddTossCodesAreReplaced() throws Exception {
        PgReviewService service = service();
        PgReviewSessions.Session noAnswer = checkedOut(service);
        service.completeRegistration(noAnswer, noAnswer.checkout().state(), noAnswer.checkout().customerKey(), "AK");

        issueFailure = new PgReviewGateway.GatewayException(
                PgReviewGateway.GatewayException.Outcome.REJECTED, "bad code");
        PgReviewSessions.Session oddCode = checkedOut(service);
        service.completeRegistration(oddCode, oddCode.checkout().state(), oddCode.checkout().customerKey(), "AK");

        assertThat(noAnswer.result().status()).isEqualTo("unknown");
        assertThat(noAnswer.result().errorCode()).isEqualTo("verification_mismatch");
        assertThat(oddCode.result().status()).isEqualTo("failed");
        assertThat(oddCode.result().errorCode()).isEqualTo("gateway_error");
        assertThat(calls).containsExactly("issue AK", "approve BK", "issue AK");
    }

    @Test
    void failureCallbackWithoutAUsableCodeIsRecordedAsRegistrationFailed() throws Exception {
        PgReviewService service = service();
        PgReviewSessions.Session session = checkedOut(service);

        service.failRegistration(session, session.checkout().state(), null);

        assertThat(session.result().status()).isEqualTo("failed");
        assertThat(session.result().errorCode()).isEqualTo("registration_failed");
    }
}
