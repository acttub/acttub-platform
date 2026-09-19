package com.acttub.actingapi.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import com.acttub.actingapi.platform.schema.UserStatus;
import com.acttub.actingapi.platform.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/**
 * 게스트의 게이트 — 회원의 규칙과 <b>다른 규칙</b>이다(ADR-028). 그 기능의 문서만 보고, 프로필은 보지 않고,
 * 어느 기능에도 속하지 않는 경로는 회원 전용이다.
 *
 * <p>리딩의 경로는 아직 서버에 없어 HTTP 로는 볼 수 없다. "리딩부터 시작하면 시트에 둘만 나오고, 이어서
 * 연습을 시작하면 AI 분석 동의 하나만"은 기능의 문서 집합과 그 집합으로 거르는 규칙으로 여기서 본다.
 */
class GuestGateTest {
    private static final PendingConsentGate.Document TERMS = document("terms", true);
    private static final PendingConsentGate.Document PRIVACY = document("privacy", true);
    private static final PendingConsentGate.Document AI_ANALYSIS = document("ai_analysis", true);
    private static final PendingConsentGate.Document RETENTION = document("retention", false);

    private final AtomicReference<AuthenticatedUser> current = new AtomicReference<>(
            new AuthenticatedUser(UUID.randomUUID(), null, UserStatus.ACTIVE, true));
    private final AtomicReference<List<PendingConsentGate.Document>> undecided =
            new AtomicReference<>(List.of(TERMS, PRIVACY, AI_ANALYSIS, RETENTION));

    private final AccessGate gate = new AccessGate(
            new CurrentUserService(null, null) {
                @Override
                public AuthenticatedUser require(HttpServletRequest request) {
                    return current.get();
                }
            },
            new FixedWindowRateLimiter(() -> 1L),
            new PendingConsentGate() {
                @Override
                public List<Document> undecidedFor(UUID userId) {
                    return undecided.get();
                }

                @Override
                public List<Document> undecidedAmong(UUID userId, Set<String> documentTypes) {
                    return undecided.get().stream()
                            .filter(document -> documentTypes.contains(document.type()))
                            .toList();
                }
            },
            ignored -> false);

    @Test
    @DisplayName("account.guest: 기능마다 필요한 문서 — 연습은 약관·수집·이용 동의·AI 분석 동의, 리딩은 약관·수집·이용 동의 둘이다")
    void eachFeatureNamesItsDocuments() {
        assertThat(GuestFeature.PRACTICE.requiredDocumentTypes())
                .containsExactlyInAnyOrder("terms", "privacy", "ai_analysis");
        assertThat(GuestFeature.READING.requiredDocumentTypes())
                .as("녹음을 AI 로 대조할 때의 AI 분석 동의는 (결정 필요)라 넣지 않는다")
                .containsExactlyInAnyOrder("terms", "privacy");
    }

    @Test
    @DisplayName("account.guest: 연습의 경로는 연습 기능이고, 적지 않은 경로는 어느 기능도 아니다(회원 전용)")
    void routesBelongToAFeatureOrToMembers() {
        for (String path : List.of(
                "/v2/uploads/intents", "/v2/practice-sessions", "/v2/practice-sessions/abc/analyze",
                "/v2/coach/start", "/v2/reports", "/v2/reports/abc", "/v2/me/memory", "/v2/me/memory/goal")) {
            assertThat(GuestFeature.of(path)).as(path).isEqualTo(GuestFeature.PRACTICE);
        }
        for (String path : List.of(
                "/v2/me/profile", "/v2/me/photo", "/v2/me/notification-settings", "/v2/push-tokens",
                "/v2/portfolio", "/v2/guest-transfers", "/v2/challenges", "/v2/something-new")) {
            assertThat(GuestFeature.of(path)).as(path).isNull();
        }
    }

    @Test
    @DisplayName("account.guest: 새 게스트의 연습 요청 — 403 과 빠진 문서 셋. 선택 문서는 묻지 않는다")
    void aNewGuestIsAskedForTheThreePracticeDocuments() {
        assertThatThrownBy(() -> gate.gatedUser(request("/v2/practice-sessions")))
                .isInstanceOfSatisfying(ApiException.class, blocked -> {
                    assertThat(blocked.status()).isEqualTo(403);
                    assertThat(blocked).hasMessage("consent_required");
                    assertThat(blocked.extras())
                            .containsEntry("pending_consents", List.of(TERMS, PRIVACY, AI_ANALYSIS));
                });
    }

    @Test
    @DisplayName("account.guest: 리딩부터 시작해 둘에 동의한 게스트가 연습을 시작하면 AI 분석 동의 하나만 나오고, 그것까지 동의하면 프로필 없이 허용된다")
    void onlyTheMissingDocumentsOfThatFeatureAreAsked() {
        undecided.set(List.of(AI_ANALYSIS, RETENTION));

        assertThatThrownBy(() -> gate.gatedUser(request("/v2/coach/start")))
                .isInstanceOfSatisfying(ApiException.class, blocked -> assertThat(blocked.extras())
                        .containsEntry("pending_consents", List.of(AI_ANALYSIS)));

        undecided.set(List.of(RETENTION));

        assertThat(gate.gatedUser(request("/v2/coach/start")))
                .as("선택 문서가 미결정이고 프로필이 없어도 게스트는 통과한다")
                .isEqualTo(current.get());
    }

    @Test
    @DisplayName("account.guest: 게스트가 회원 전용 기능을 부르면 403 member_only, 회원이 게스트 전용을 부르면 403 guest_only")
    void membersAndGuestsAreKeptOutOfEachOthersFeatures() {
        undecided.set(List.of());
        for (String path : List.of("/v2/push-tokens", "/v2/guest-transfers", "/v2/me/notification-settings")) {
            assertThatThrownBy(() -> gate.gatedUser(request(path)))
                    .as(path)
                    .isInstanceOfSatisfying(ApiException.class, blocked -> {
                        assertThat(blocked.status()).isEqualTo(403);
                        assertThat(blocked).hasMessage("member_only");
                    });
        }
        assertThatThrownBy(() -> gate.consentedUser(request("/v2/me/profile")))
                .isInstanceOfSatisfying(ApiException.class, blocked -> assertThat(blocked).hasMessage("member_only"));
        assertThat(gate.guestUser(request("/v2/guest/transfer-code"))).isEqualTo(current.get());

        current.set(new AuthenticatedUser(UUID.randomUUID(), null, UserStatus.ACTIVE, false));
        assertThatThrownBy(() -> gate.guestUser(request("/v2/guest/transfer-code")))
                .isInstanceOfSatisfying(ApiException.class, blocked -> {
                    assertThat(blocked.status()).isEqualTo(403);
                    assertThat(blocked).hasMessage("guest_only");
                });
    }

    @Test
    @DisplayName("account.guest: 이관 코드 받기는 게스트 전용 자리이고 그 밖의 표는 회원과 같다")
    void theInterceptorSendsTheTransferCodeRouteToTheGuestOnlyGate() {
        assertThat(ConsentGateInterceptor.gateFor("POST", "/v2/guest/transfer-code"))
                .isEqualTo(ConsentGateInterceptor.Gate.GUEST_ONLY);
        assertThat(ConsentGateInterceptor.gateFor("POST", "/v2/guest-transfers"))
                .isEqualTo(ConsentGateInterceptor.Gate.FULL);
        assertThat(ConsentGateInterceptor.gateFor("POST", "/v2/auth/guest"))
                .isEqualTo(ConsentGateInterceptor.Gate.NONE);
        assertThat(ConsentGateInterceptor.gateFor("GET", "/v2/consents/entry"))
                .isEqualTo(ConsentGateInterceptor.Gate.NONE);
    }

    @Test
    @DisplayName("account.guest: 시간당으로 세는 창은 한 시간이 지나야 다시 열리고, 틀린 시도는 세지 않고도 한도를 볼 수 있다")
    void theLimiterCountsByTheHourAndCanPeek() {
        AtomicLong now = new AtomicLong();
        FixedWindowRateLimiter limiter = new FixedWindowRateLimiter(now::get);
        for (int created = 0; created < 10; created++) {
            assertThat(limiter.allow("guest-ip:1.1.1.1", 10, Duration.ofHours(1))).isTrue();
        }
        now.set(Duration.ofMinutes(59).toNanos());
        assertThat(limiter.allow("guest-ip:1.1.1.1", 10, Duration.ofHours(1))).as("열한 번째").isFalse();
        now.set(Duration.ofHours(1).toNanos());
        assertThat(limiter.allow("guest-ip:1.1.1.1", 10, Duration.ofHours(1))).isTrue();

        assertThat(limiter.exhausted("wrong:member", 5)).isFalse();
        for (int wrong = 0; wrong < 5; wrong++) {
            limiter.allow("wrong:member", 5);
        }
        assertThat(limiter.exhausted("wrong:member", 5)).as("보는 것만으로는 세지 않는다").isTrue();
        assertThat(limiter.exhausted("wrong:other", 5)).isFalse();
        now.set(Duration.ofHours(1).plusMinutes(1).toNanos());
        assertThat(limiter.exhausted("wrong:member", 5)).isFalse();
    }

    private static HttpServletRequest request(String path) {
        return new MockHttpServletRequest("POST", path);
    }

    private static PendingConsentGate.Document document(String type, boolean required) {
        return new PendingConsentGate.Document(
                UUID.randomUUID(), type, "v1", type, "본문", required, Instant.parse("2026-10-01T00:00:00Z"));
    }
}
