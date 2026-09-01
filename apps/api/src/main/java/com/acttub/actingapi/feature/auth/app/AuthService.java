package com.acttub.actingapi.feature.auth.app;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.domain.EmailAddress;
import com.acttub.actingapi.feature.auth.domain.RefreshToken;
import com.acttub.actingapi.integration.oidc.InvalidIdentityToken;
import com.acttub.actingapi.integration.oidc.ProviderConfigurationError;
import com.acttub.actingapi.integration.oidc.ProviderIdentity;
import com.acttub.actingapi.integration.oidc.ProviderRegistry;
import com.acttub.actingapi.integration.oidc.UnsupportedProviderError;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.web.ApiException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * 로그인·갱신·로그아웃의 규칙.
 *
 * <p>레이트리밋은 여기 없다 — 요청의 출처(IP·주체)로 세는 일이라 요청을 받는 자리에 남는다.
 *
 * <p>{@code integration/oidc} 를 직접 부른다. 외부 연동을 보는 것은 금지 대상이 아니고
 * (금지되는 것은 feature 끼리의 직접 import 다) 간선도 한 방향이라, 위임만 하는 포트를 끼우면
 * 인터페이스만 늘고 얻는 것이 없다.
 */
@Service
public class AuthService {

    private final ProviderRegistry providers;
    private final AuthRepository accounts;
    private final PendingConsentDocuments consents;
    private final JwtService jwt;
    private final Clock clock;

    public AuthService(
            ProviderRegistry providers,
            AuthRepository accounts,
            PendingConsentDocuments consents,
            JwtService jwt,
            Clock clock) {
        this.providers = providers;
        this.accounts = accounts;
        this.consents = consents;
        this.jwt = jwt;
        this.clock = clock;
    }

    /**
     * 프로바이더 토큰을 확인하고 계정을 찾거나 만든다.
     *
     * <p>계정을 찾는 순서가 계약이다 — 신원으로 먼저 찾고, 없으면 <b>검증된</b> 이메일로 이미
     * 있는 계정에 붙인다. 이메일이 검증되지 않았는데 같은 주소의 계정이 있으면 409 다(그러지
     * 않으면 검증 안 된 주소를 대는 것만으로 남의 계정에 들어간다).
     */
    public AuthenticatedUser login(String rawProvider, String idToken) {
        String provider = rawProvider.strip().toLowerCase(Locale.ROOT);
        ProviderIdentity identity = verify(provider, idToken);

        AuthenticatedUser user = accounts.findByIdentity(provider, identity.providerUid());
        if (user == null) {
            user = attach(provider, identity);
        }
        user.requireUsable();
        return user;
    }

    /** 액세스·refresh 한 쌍을 발급하고 refresh 를 저장한다. */
    public TokenPair issueTokens(UUID userId, String device) {
        var access = jwt.issueAccessToken(userId);
        var refresh = jwt.issueRefreshToken(userId);
        accounts.issueRefresh(
                userId,
                JwtService.hashToken(refresh.value()),
                refresh.expiresAt(),
                device,
                clock.instant());
        return new TokenPair(access.value(), refresh.value(), JwtService.ACCESS_TTL_SECONDS);
    }

    public List<PendingConsent> pendingConsents(UUID userId) {
        return consents.pendingFor(userId);
    }

    /**
     * refresh 토큰을 확인하고 그것을 낸 사람을 찾는다.
     *
     * <p>어긋난 것은 이유를 가리지 않고 전부 401 {@code invalid_refresh_token} 이다 — 어느
     * 단계에서 걸렸는지 알려주면 토큰을 가진 쪽이 그것을 단서로 쓴다.
     *
     * <p>📌 <b>잡은 시각을 함께 돌려준다.</b> 갱신 한 번은 확인부터 회전까지 <b>같은 시각</b>을
     * 써야 한다 — 두 단계가 각자 시계를 보면 그 사이에 초 경계를 넘었을 때 검증에 쓴 시각과
     * 발급된 토큰의 {@code iat} 가 갈린다. 그 사이에 레이트리밋이 끼어 있어(요청의 주체로 세는
     * 일이라 web 의 몫이다) 한 메서드로 합칠 수 없으므로, 시각을 밖으로 내보낸다.
     */
    public RefreshAttempt beginRefresh(String refreshToken) {
        Instant now = clock.instant();
        JwtService.TokenClaims claims;
        try {
            claims = jwt.decode(refreshToken, "refresh", now);
        } catch (JwtService.TokenValidationException invalid) {
            throw invalidRefresh();
        }
        RefreshToken stored = accounts.getRefresh(JwtService.hashToken(refreshToken));
        if (stored == null || !stored.userId().equals(claims.userId())) {
            throw invalidRefresh();
        }
        AuthenticatedUser user = accounts.find(claims.userId());
        if (user == null) {
            throw invalidRefresh();
        }
        user.requireUsable();
        return new RefreshAttempt(user, now);
    }

    /** 위 {@link #beginRefresh} 로 주체를 확인한 뒤, 그것이 준 시각으로 부른다. */
    public TokenPair rotateTokens(
            UUID userId,
            String oldRefreshToken,
            String device,
            Instant now) {
        var access = jwt.issue(userId, "access", JwtService.ACCESS_TTL_SECONDS, now);
        var replacement = jwt.issue(userId, "refresh", JwtService.REFRESH_TTL_SECONDS, now);
        AuthRepository.Rotation rotation = accounts.rotate(
                JwtService.hashToken(oldRefreshToken),
                JwtService.hashToken(replacement.value()),
                replacement.expiresAt(),
                device,
                now);
        if (rotation.reused() || rotation.id() == null) {
            throw invalidRefresh();
        }
        return new TokenPair(access.value(), replacement.value(), JwtService.ACCESS_TTL_SECONDS);
    }

    /**
     * 로그아웃. 토큰이 이 사람의 것이 아니거나 이미 끊겼으면 401 이다.
     *
     * <p>주체와 토큰의 소유자를 <b>둘 다</b> 본다 — 남의 refresh 를 들고 와서 끊는 것을 막는다.
     */
    public void revokeRefresh(UUID userId, String refreshToken) {
        try {
            JwtService.TokenClaims claims = jwt.decodeRefreshToken(refreshToken);
            String hash = JwtService.hashToken(refreshToken);
            RefreshToken stored = accounts.getRefresh(hash);
            if (!claims.userId().equals(userId)
                    || stored == null
                    || !stored.userId().equals(userId)
                    || !accounts.revoke(hash, clock.instant())) {
                throw invalidRefresh();
            }
        } catch (JwtService.TokenValidationException invalid) {
            throw invalidRefresh();
        }
    }

    private ProviderIdentity verify(String provider, String idToken) {
        try {
            return providers.verify(provider, idToken);
        } catch (UnsupportedProviderError unsupported) {
            throw new ApiException(400, "unsupported_provider");
        } catch (ProviderConfigurationError misconfigured) {
            throw new ApiException(503, "provider_not_configured");
        } catch (InvalidIdentityToken invalid) {
            throw new ApiException(401, "invalid_provider_token");
        }
    }

    /**
     * 신원을 계정에 붙인다 — 이미 있는 계정에 잇거나, 없으면 새로 만든다.
     *
     * <p>같은 신원으로 두 요청이 동시에 들어오면 하나는 유니크 제약에 걸린다. 그때는 진 쪽이
     * <b>다시 조회해</b> 이긴 쪽이 만든 계정을 쓴다 — 경합을 오류로 내보내면 사용자에게는
     * 이유 없는 실패가 된다.
     */
    private AuthenticatedUser attach(String provider, ProviderIdentity identity) {
        String email = EmailAddress.normalize(identity.email());
        AuthenticatedUser existing = email == null ? null : accounts.findByEmail(email);
        try {
            if (existing != null) {
                if (!identity.emailVerified()) {
                    throw new ApiException(409, "account_exists_with_different_provider");
                }
                accounts.linkIdentity(existing.id(), provider, identity.providerUid());
                return existing;
            }
            return accounts.createUserWithIdentity(
                    provider,
                    identity.providerUid(),
                    identity.emailVerified() ? email : null);
        } catch (DataIntegrityViolationException | IdentityAlreadyLinkedError race) {
            AuthenticatedUser winner = accounts.findByIdentity(provider, identity.providerUid());
            if (winner == null) {
                throw race;
            }
            return winner;
        }
    }

    private static ApiException invalidRefresh() {
        return new ApiException(401, "invalid_refresh_token");
    }

    /** 발급된 한 쌍. 응답으로 옮기는 일은 web 어댑터가 한다. */
    public record TokenPair(String accessToken, String refreshToken, long expiresIn) {
    }

    /** 갱신을 낸 사람과, 그 갱신 한 번이 쓸 시각. */
    public record RefreshAttempt(AuthenticatedUser user, Instant now) {
    }
}
