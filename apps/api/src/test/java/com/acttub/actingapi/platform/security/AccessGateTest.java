package com.acttub.actingapi.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import com.acttub.actingapi.platform.schema.UserStatus;
import com.acttub.actingapi.platform.security.ConsentGateInterceptor.Gate;
import com.acttub.actingapi.platform.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;

class AccessGateTest {
    private static final PendingConsentGate.Document RETENTION = new PendingConsentGate.Document(
            UUID.randomUUID(), "retention", "v1", "탈퇴 후 영상·녹음 보관·활용", "본문", false,
            Instant.parse("2026-10-01T00:00:00Z"));

    private final AuthenticatedUser user =
            new AuthenticatedUser(UUID.randomUUID(), null, UserStatus.ACTIVE);
    private final AtomicReference<List<PendingConsentGate.Document>> undecided =
            new AtomicReference<>(List.of());
    private final AtomicBoolean profileComplete = new AtomicBoolean(true);

    // 사용자를 어디서 읽어오는지 이 검사는 모른다 — 게이트가 auth 없이 선다는 것이
    // 세 갈래 분해의 실증이다 (SOMA-397 7단계).
    // 동의와 프로필은 별개의 포트다 — 소유한 쪽이 다르고, 한 포트는 한 쪽만 구현할 수 있다.
    private final AccessGate gate = new AccessGate(
            new CurrentUserService(null, null) {
                @Override
                public AuthenticatedUser require(HttpServletRequest request) {
                    return user;
                }
            },
            new FixedWindowRateLimiter(() -> 1L),
            new PendingConsentGate() {
                @Override
                public List<Document> undecidedFor(UUID userId) {
                    return undecided.get();
                }

                @Override
                public List<Document> undecidedAmong(UUID userId, java.util.Set<String> documentTypes) {
                    return undecided.get().stream()
                            .filter(document -> documentTypes.contains(document.type()))
                            .toList();
                }
            },
            ignored -> profileComplete.get());

    @Test
    void accountLogin_memberGateAsksConsentFirstThenProfile() {
        HttpServletRequest request = null;
        assertThat(gate.currentUser(request)).isEqualTo(user);
        assertThat(gate.rateLimitedUser(request)).isEqualTo(user);
        assertThat(gate.gatedUser(request)).isEqualTo(user);

        // 선택 문서 하나만 미결정이어도 막힌다. 본문에 그 문서 목록이 함께 실린다.
        undecided.set(List.of(RETENTION));
        profileComplete.set(false);
        assertThatThrownBy(() -> gate.gatedUser(request))
                .isInstanceOfSatisfying(ApiException.class, blocked -> {
                    assertThat(blocked.status()).isEqualTo(403);
                    assertThat(blocked).hasMessage("consent_required");
                    assertThat(blocked.extras()).containsEntry("pending_consents", List.of(RETENTION));
                });

        // 동의가 끝나면 그다음이 프로필이다. 프로필 입력은 동의까지만 본다.
        undecided.set(List.of());
        assertThat(gate.consentedUser(request)).isEqualTo(user);
        assertThatThrownBy(() -> gate.gatedUser(request))
                .isInstanceOfSatisfying(ApiException.class, blocked -> {
                    assertThat(blocked.status()).isEqualTo(403);
                    assertThat(blocked).hasMessage("profile_required");
                    assertThat(blocked.extras()).isEmpty();
                });
    }

    @Test
    void everyV2RouteIsProtectedUnlessItIsListedAsOutsideTheGate() {
        // 게이트 밖: 로그인·갱신·로그아웃, 동의 조회와 제출, 내 계정 조회, 탈퇴, 공개·운영 경로.
        for (String[] open : new String[][] {
                {"POST", "/v2/auth/login"}, {"POST", "/v2/auth/signup"}, {"POST", "/v2/auth/refresh"},
                {"POST", "/v2/auth/logout"}, {"GET", "/v2/consents/documents"}, {"GET", "/v2/consents/pending"},
                {"GET", "/v2/consents/entry"}, {"POST", "/v2/consents"}, {"GET", "/v2/me"},
                {"DELETE", "/v2/me"}, {"DELETE", "/v2/push-tokens"}, {"GET", "/v2/admissions"},
                {"GET", "/v2/admissions/snu"}, {"GET", "/v2/admin/sessions"}, {"GET", "/health"}}) {
            assertThat(ConsentGateInterceptor.gateFor(open[0], open[1]))
                    .as("%s %s", open[0], open[1]).isEqualTo(Gate.NONE);
        }

        // 프로필 입력은 동의까지만 — 개인정보를 받기 전에 수집 동의가 끝나 있어야 한다.
        assertThat(ConsentGateInterceptor.gateFor("PUT", "/v2/me/profile")).isEqualTo(Gate.CONSENT_ONLY);

        // 그 밖은 전부 보호 기능이다. 표에 적지 않은 새 경로도 닫힌 채로 시작한다.
        for (String[] guarded : new String[][] {
                {"POST", "/v2/uploads/intents"}, {"POST", "/v2/uploads/intents/id/complete"},
                {"GET", "/v2/practice-sessions"}, {"DELETE", "/v2/practice-sessions/id"},
                {"POST", "/v2/coach/start"}, {"GET", "/v2/reports"}, {"GET", "/v2/me/memory"},
                {"PUT", "/v2/me/memory/goal"}, {"POST", "/v2/push-tokens"}, {"POST", "/v2/me/photo"},
                {"POST", "/v2/me/photo/complete"}, {"DELETE", "/v2/me/photo"},
                {"GET", "/v2/something-new"}}) {
            assertThat(ConsentGateInterceptor.gateFor(guarded[0], guarded[1]))
                    .as("%s %s", guarded[0], guarded[1]).isEqualTo(Gate.FULL);
        }
    }
}
