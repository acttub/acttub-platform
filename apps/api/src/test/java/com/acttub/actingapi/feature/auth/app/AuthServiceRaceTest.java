package com.acttub.actingapi.feature.auth.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.domain.RefreshToken;
import com.acttub.actingapi.integration.oidc.AppleTokenClient;
import com.acttub.actingapi.integration.oidc.KakaoUserClient;
import com.acttub.actingapi.integration.oidc.NaverTokenClient;
import com.acttub.actingapi.integration.oidc.ProviderConfigurationError;
import com.acttub.actingapi.integration.oidc.ProviderIdentity;
import com.acttub.actingapi.integration.oidc.ProviderRegistry;
import com.acttub.actingapi.integration.oidc.ProviderVerifier;
import com.acttub.actingapi.platform.schema.UserStatus;
import com.acttub.actingapi.platform.security.AccountSecrets;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.security.TransferredGuests;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * 같은 신원으로 동시에 온 요청, 지워진 계정의 refresh, 설정이 빠진 제공자 — HTTP 시험으로는 만들기 어려운 갈래를
 * 저장소 포트를 바꿔 끼워 본다 (CONTRACT §6-6, account.login).
 */
class AuthServiceRaceTest {
    private static final Instant NOW = Instant.parse("2026-10-20T00:00:00Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    private static final AuthenticatedUser MEMBER =
            new AuthenticatedUser(UUID.fromString("00000000-0000-0000-0000-0000000000a1"), "a@b.c", UserStatus.ACTIVE);
    private static final AuthenticatedUser OTHER =
            new AuthenticatedUser(UUID.fromString("00000000-0000-0000-0000-0000000000b2"), "a@b.c", UserStatus.ACTIVE);

    private final AuthRepository accounts = mock(AuthRepository.class);
    private final PendingConsentDocuments consents = mock(PendingConsentDocuments.class);
    private final NaverTokenClient naver = mock(NaverTokenClient.class);
    private final KakaoUserClient kakao = mock(KakaoUserClient.class);
    private final SignupTokens signupTokens = new SignupTokens("signup-secret");
    private final JwtService jwt = new JwtService("jwt-secret-for-tests-only-0123456789", CLOCK, new ObjectMapper());
    private final List<String> verified = new ArrayList<>();

    private AuthService service(ProviderVerifier... verifiers) {
        return new AuthService(
                new ProviderRegistry(List.of(verifiers), "google,apple,kakao,naver"),
                mock(AppleTokenClient.class), kakao, naver, accounts, mock(TransferredGuests.class), consents, jwt,
                signupTokens, new AccountSecrets("jwt-secret", null, null), new RecordingFailureReporter(), CLOCK);
    }

    private ProviderVerifier verifier(String provider, ProviderIdentity identity) {
        return new ProviderVerifier() {
            @Override
            public String provider() {
                return provider;
            }

            @Override
            public ProviderIdentity verify(String idToken) {
                verified.add(provider + ":" + idToken);
                return identity;
            }
        };
    }

    private String signupToken(String email) {
        return signupTokens.issue(new SignupTokens.SignupIdentity("google", "g-1", email, null), NOW);
    }

    @Test
    void resubmittedSignupReturnsTheAccountTheFirstSubmissionCreated() {
        when(accounts.findByIdentity("google", "g-1")).thenReturn(MEMBER);

        AuthenticatedUser user = service().signup(signupToken("a@b.c"), List.of(), true);

        assertThat(user).isEqualTo(MEMBER);
    }

    @Test
    void signupThatLosesTheRaceToTheSameIdentityReturnsTheWinner() {
        when(accounts.findByIdentity("google", "g-1")).thenReturn(null, MEMBER);
        when(accounts.createAccount(eq("google"), eq("g-1"), eq("a@b.c"), any(), any(), anyBoolean(), eq(NOW)))
                .thenThrow(new DataIntegrityViolationException("uq_user_identities"));

        assertThat(service().signup(signupToken("a@b.c"), List.of(), true)).isEqualTo(MEMBER);
    }

    @Test
    void signupThatLosesTheRaceToTheSameEmailIsTheEmailTakenConflict() {
        when(accounts.findByIdentity("google", "g-1")).thenReturn(null, null);
        when(accounts.createAccount(any(), any(), any(), any(), any(), anyBoolean(), any()))
                .thenThrow(new DataIntegrityViolationException("uq_users_email"));
        when(accounts.findByEmail("a@b.c")).thenReturn(OTHER);
        when(accounts.providersOf(OTHER.id())).thenReturn(List.of("kakao"));

        assertThatThrownBy(() -> service().signup(signupToken("a@b.c"), List.of(), true))
                .isInstanceOfSatisfying(ApiException.class, conflict -> {
                    assertThat(conflict.status()).isEqualTo(409);
                    assertThat(conflict.getMessage()).isEqualTo("account_exists_with_different_provider");
                    assertThat(conflict.extras()).containsEntry("providers", List.of("kakao"));
                });
    }

    @Test
    void signupRaceWithNoWinnerAndNoVerifiedEmailIsRethrown() {
        DataIntegrityViolationException race = new DataIntegrityViolationException("unknown");
        when(accounts.createAccount(any(), any(), any(), any(), any(), anyBoolean(), any())).thenThrow(race);

        assertThatThrownBy(() -> service().signup(signupToken(null), List.of(), true)).isSameAs(race);
    }

    @Test
    void refreshForAnAccountThatNoLongerExistsIsInvalid() {
        String refresh = jwt.issueRefreshToken(MEMBER.id()).value();
        when(accounts.getRefresh(JwtService.hashToken(refresh)))
                .thenReturn(new RefreshToken(UUID.randomUUID(), MEMBER.id(), null, NOW.plusSeconds(60), null, "ios"));

        assertThatThrownBy(() -> service().beginRefresh(refresh))
                .isInstanceOfSatisfying(ApiException.class, invalid -> {
                    assertThat(invalid.status()).isEqualTo(401);
                    assertThat(invalid.getMessage()).isEqualTo("invalid_refresh_token");
                });
    }

    @Test
    void providerWhoseServerSettingsAreMissingIs503ProviderNotConfigured() {
        ProviderVerifier misconfigured = new ProviderVerifier() {
            @Override
            public String provider() {
                return "google";
            }

            @Override
            public ProviderIdentity verify(String idToken) {
                throw new ProviderConfigurationError("GOOGLE_OAUTH_CLIENT_ID not configured");
            }
        };
        when(naver.exchange(any(), any(), any(), any()))
                .thenThrow(new ProviderConfigurationError("NAVER_OAUTH_CLIENT_ID not configured"));
        when(kakao.emailVerified(anyString(), anyString()))
                .thenThrow(new ProviderConfigurationError("KAKAO_ADMIN_KEY not configured"));
        AuthService service = service(misconfigured, verifier("naver", new ProviderIdentity("n-1", null, false)),
                verifier("kakao", new ProviderIdentity("k-1", "k@b.c", false)));
        LoginCredentials credentials = new LoginCredentials("id-token", "code", "verifier", null, "state");

        for (String provider : List.of("google", "naver", "kakao")) {
            assertThatThrownBy(() -> service.login(provider, credentials))
                    .isInstanceOfSatisfying(ApiException.class, failure -> {
                        assertThat(failure.status()).isEqualTo(503);
                        assertThat(failure.getMessage()).isEqualTo("provider_not_configured");
                    });
        }
        assertThat(verified).containsExactly("kakao:id-token");
    }

    @Test
    void linkingThatLosesTheRaceSignsInToTheAccountTheWinnerLinked() {
        when(accounts.findByIdentity("google", "g-1")).thenReturn(null, OTHER);
        when(accounts.findByEmail("a@b.c")).thenReturn(MEMBER);
        when(accounts.find(OTHER.id())).thenReturn(OTHER);
        org.mockito.Mockito.doThrow(new IdentityAlreadyLinkedError("linked by another request"))
                .when(accounts).linkIdentity(MEMBER.id(), "google", "g-1", null);

        AuthService.LoginOutcome outcome = service(verifier("google", new ProviderIdentity("g-1", "a@b.c", true)))
                .login("google", new LoginCredentials("id-token", null, null, null, null));

        assertThat(outcome).isEqualTo(new AuthService.LoginOutcome.SignedIn(OTHER));
    }

    @Test
    void naverMemberWithoutANewRefreshTokenKeepsTheStoredOne() {
        when(naver.exchange(any(), any(), any(), any())).thenReturn(new NaverTokenClient.NaverGrant("n.id.token", null));
        when(accounts.findByIdentity("naver", "n-1")).thenReturn(MEMBER);
        List<String> stored = new ArrayList<>();
        org.mockito.Mockito.doAnswer(invocation -> stored.add(invocation.getArgument(2)))
                .when(accounts).storeProviderToken(any(), any(), any());

        AuthService.LoginOutcome outcome = service(verifier("naver", new ProviderIdentity("n-1", null, false)))
                .login("naver", new LoginCredentials(null, "code", "verifier", null, "state"));

        assertThat(outcome).isEqualTo(new AuthService.LoginOutcome.SignedIn(MEMBER));
        assertThat(verified).containsExactly("naver:n.id.token");
        assertThat(stored).isEmpty();
    }
}
