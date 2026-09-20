package com.acttub.actingapi.feature.auth.app;

import java.time.Clock;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.domain.EmailAddress;
import com.acttub.actingapi.feature.auth.domain.NaverEmail;
import com.acttub.actingapi.feature.auth.domain.RefreshToken;
import com.acttub.actingapi.integration.oidc.AppleTokenClient;
import com.acttub.actingapi.integration.oidc.InvalidIdentityToken;
import com.acttub.actingapi.integration.oidc.KakaoUserClient;
import com.acttub.actingapi.integration.oidc.NaverTokenClient;
import com.acttub.actingapi.integration.oidc.ProviderConfigurationError;
import com.acttub.actingapi.integration.oidc.ProviderIdentity;
import com.acttub.actingapi.integration.oidc.ProviderRegistry;
import com.acttub.actingapi.integration.oidc.ProviderUnavailable;
import com.acttub.actingapi.integration.oidc.UnsupportedProviderError;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.schema.UserStatus;
import com.acttub.actingapi.platform.security.AccountSecrets;
import com.acttub.actingapi.platform.security.TransferredGuests;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.web.ApiException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * 로그인·가입 제출·갱신·로그아웃의 규칙.
 *
 * <p>레이트리밋은 여기 없다 — 요청의 출처(IP·주체)로 세는 일이라 요청을 받는 자리에 남는다.
 *
 * <p>{@code integration/oidc} 를 직접 부른다. 외부 연동을 보는 것은 금지 대상이 아니고
 * (금지되는 것은 feature 끼리의 직접 import 다) 간선도 한 방향이라, 위임만 하는 포트를 끼우면
 * 인터페이스만 늘고 얻는 것이 없다.
 */
@Service
public class AuthService {
    private static final SecureRandom GUEST_UIDS = new SecureRandom();

    private final ProviderRegistry providers;
    private final AppleTokenClient appleTokens;
    private final KakaoUserClient kakaoUsers;
    private final NaverTokenClient naverTokens;
    private final AuthRepository accounts;
    private final TransferredGuests transferred;
    private final PendingConsentDocuments consents;
    private final JwtService jwt;
    private final SignupTokens signupTokens;
    private final AccountSecrets secrets;
    private final FailureReporter failureReporter;
    private final Clock clock;

    public AuthService(
            ProviderRegistry providers,
            AppleTokenClient appleTokens,
            KakaoUserClient kakaoUsers,
            NaverTokenClient naverTokens,
            AuthRepository accounts,
            TransferredGuests transferred,
            PendingConsentDocuments consents,
            JwtService jwt,
            SignupTokens signupTokens,
            AccountSecrets secrets,
            FailureReporter failureReporter,
            Clock clock) {
        this.providers = providers;
        this.appleTokens = appleTokens;
        this.kakaoUsers = kakaoUsers;
        this.naverTokens = naverTokens;
        this.accounts = accounts;
        this.transferred = transferred;
        this.consents = consents;
        this.jwt = jwt;
        this.signupTokens = signupTokens;
        this.secrets = secrets;
        this.failureReporter = failureReporter;
        this.clock = clock;
    }

    /** 운영에서 켜 둔 간편 로그인 제공자. 앱이 이 목록으로 로그인 버튼을 그린다. */
    public List<String> enabledProviders() {
        return providers.enabledProviders();
    }

    /**
     * 제공자가 준 자격 값을 확인하고 계정을 찾는다. <b>계정을 만들지는 않는다.</b>
     *
     * <p>계정을 찾는 순서가 계약이다 — ① 제공자와 제공자 ID 로 찾고, ② 없으면 제공자가
     * <b>검증했다고 알린</b> 이메일로 이미 있는 계정에 새 신원을 붙이고, ③ 그것도 없으면 처음 온
     * 신원이다. 이메일이 검증되지 않았는데 같은 주소의 계정이 있으면 409 다(그러지 않으면 검증 안 된
     * 주소를 대는 것만으로 남의 계정에 들어간다).
     *
     * <p>③에서는 아무 행도 만들지 않고 {@link SignupTokens 가입 토큰}과 현재 판 동의 문서만
     * 돌려준다. 계정은 {@link #signup 가입 제출}이 통과한 순간에 생긴다 — 동의 화면에서 나가면
     * 서버에 아무것도 남지 않는다.
     *
     * <p><b>서버가 제공자에 묻는 자리는 처음 온 신원에만 있다</b> — 카카오의 이메일 검증 여부(사용자
     * 정보 API)와 애플 authorization code 교환이다. 그것이 답하지 않으면 502 이고 아무 행도 없다.
     * ①에서 찾아지는 기존 회원은 묻지 않고 로그인된다. 네이버만 예외다: ID 토큰을 서버가 코드
     * 교환으로 얻으므로 네이버의 무응답은 기존 회원에게도 502 다.
     */
    public LoginOutcome login(String rawProvider, LoginCredentials credentials) {
        String provider = rawProvider.strip().toLowerCase(Locale.ROOT);
        // 꺼 둔 제공자에는 코드 교환 같은 바깥 호출을 하지 않는다. 그래서 자격 값을 보기 전에 가른다.
        requireEnabled(provider);
        // 애플 토큰은 탈퇴 때 폐기 API 에 쓴다(App Store 필수). 코드는 5분 동안 한 번만 쓸 수 있어
        // 동의 화면을 기다리지 않고 로그인 요청에서 받는다.
        if ("apple".equals(provider) && isBlank(credentials.authorizationCode())) {
            throw new ApiException(422, "authorization_code_required");
        }
        // 네이버만 ID 토큰을 서버가 코드 교환으로 얻는다(결정 I-5). 그래서 네이버가 답하지 않으면 기존
        // 회원도 로그인하지 못한다 — 다른 제공자의 "장애는 처음 온 사람에게만 닿는다"의 예외다.
        NaverTokenClient.NaverGrant naverGrant = "naver".equals(provider) ? exchangeNaverCode(credentials) : null;
        ProviderIdentity identity = verify(provider, naverGrant == null ? credentials.idToken() : naverGrant.idToken());
        String email = EmailAddress.normalize(identity.email());

        AuthenticatedUser user = accounts.findByIdentity(provider, identity.providerUid());
        String verifiedEmail;
        if (user != null) {
            // ① 제공자 ID 로 찾아지는 기존 회원은 이메일 검증 확인이 필요 없다. 제공자에 묻지 않는다.
            verifiedEmail = identity.emailVerified() || naverOwnAddress(provider, email) ? email : null;
            keepProviderToken(provider, identity, credentials, naverGrant);
        } else {
            boolean emailVerified = emailVerified(provider, identity, email);
            verifiedEmail = emailVerified ? email : null;
            AuthenticatedUser sameEmail = email == null ? null : accounts.findByEmail(email);
            if (sameEmail != null && !emailVerified) {
                throw emailTaken(sameEmail);
            }
            // 이메일 겹침을 가른 뒤에 바꾼다 — 409 로 끝날 요청에 한 번뿐인 코드를 쓰지 않는다.
            String providerToken = providerToken(provider, identity, credentials, naverGrant);
            if (sameEmail != null) {
                user = attachToExisting(sameEmail, provider, identity, providerToken);
            } else {
                Instant now = clock.instant();
                return new LoginOutcome.SignupRequired(
                        signupTokens.issue(
                                new SignupTokens.SignupIdentity(
                                        provider, identity.providerUid(), verifiedEmail, providerToken),
                                now),
                        SignupTokens.TTL_SECONDS,
                        consents.currentDocuments());
            }
        }
        user.requireUsable();
        // 이메일은 신원이 아니라 부가 정보다. 제공자에서 주소를 바꿔도 같은 계정이고 주소만 따라간다.
        if (verifiedEmail != null && !verifiedEmail.equalsIgnoreCase(user.email())) {
            accounts.updateEmailIfFree(user.id(), verifiedEmail);
            user = accounts.find(user.id());
        }
        return new LoginOutcome.SignedIn(user);
    }

    /**
     * 가입 제출 — 동의 화면의 "동의하고 계속하기". 계정·신원·동의 행을 한 번에 만든다.
     *
     * <p>결정의 확인이 계정 생성보다 <b>먼저</b>다. 빠진 결정이 있으면 어떤 행도 생기지 않는다.
     *
     * <p>같은 신원의 계정이 이미 있으면 그 계정을 돌려준다 — 같은 가입 토큰의 재시도(응답을 못 받은
     * 앱)이거나 동시에 온 두 제출 가운데 진 쪽이다. 어느 쪽이든 사용자에게는 실패가 아니다.
     */
    public AuthenticatedUser signup(String signupToken, List<SignupDecision> decisions) {
        Instant now = clock.instant();
        SignupTokens.SignupIdentity identity;
        try {
            identity = signupTokens.decode(signupToken, now);
        } catch (SignupTokens.InvalidSignupToken invalid) {
            throw new ApiException(401, "invalid_signup_token", invalid);
        }
        AuthenticatedUser existing = accounts.findByIdentity(identity.provider(), identity.providerUid());
        if (existing != null) {
            existing.requireUsable();
            return existing;
        }
        List<AcceptedConsent> accepted = consents.acceptSignupDecisions(decisions);
        try {
            return accounts.createAccount(
                    identity.provider(),
                    identity.providerUid(),
                    identity.verifiedEmail(),
                    identity.providerToken() == null ? null : secrets.encrypt(identity.providerToken()),
                    accepted,
                    now);
        } catch (DataIntegrityViolationException race) {
            AuthenticatedUser winner =
                    accounts.findByIdentity(identity.provider(), identity.providerUid());
            if (winner != null) {
                return winner;
            }
            // 로그인과 제출 사이에 같은 이메일의 계정이 생겼다. 로그인의 이메일 겹침과 같은 안내다.
            AuthenticatedUser sameEmail = identity.verifiedEmail() == null
                    ? null
                    : accounts.findByEmail(identity.verifiedEmail());
            if (sameEmail != null) {
                throw emailTaken(sameEmail);
            }
            throw race;
        }
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
            throw invalidRefresh(invalid);
        }
        RefreshToken stored = accounts.getRefresh(JwtService.hashToken(refreshToken));
        if (stored == null || !stored.userId().equals(claims.userId())) {
            throw invalidRefresh();
        }
        AuthenticatedUser user = accounts.find(claims.userId());
        if (user == null) {
            throw invalidRefresh();
        }
        // 옮겨진 게스트의 사유가 먼저다. 웹은 이 401 의 사유를 보고 "옮겼어요" 안내를 띄운다 — 사유가
        // 없으면 안내 없이 새 게스트로 이어 간다.
        if (user.status() == UserStatus.DEACTIVATED && transferred.transferredGuest(user.id())) {
            throw new ApiException(401, "guest_transferred");
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
     * 로그아웃 — 요청에 실린 리프레시 토큰 <b>하나만</b> 폐기한다. 다른 기기의 세션은 그대로다.
     *
     * <p><b>멱등이다.</b> 이미 폐기됐거나 모르는 토큰, 위조된 토큰, 그리고 <b>남의 토큰</b>이어도 같은
     * 결과(204)이고 아무것도 폐기하지 않는다. 주체와 토큰의 소유자를 둘 다 보는 것은 그대로다 — 남의
     * 세션을 끊을 수 없고, 그 토큰이 실재하는지도 알려 주지 않는다.
     */
    public void revokeRefresh(UUID userId, String refreshToken) {
        JwtService.TokenClaims claims;
        try {
            claims = jwt.decodeRefreshToken(refreshToken);
        } catch (JwtService.TokenValidationException unusable) {
            return;
        }
        String hash = JwtService.hashToken(refreshToken);
        RefreshToken stored = accounts.getRefresh(hash);
        if (claims.userId().equals(userId) && stored != null && stored.userId().equals(userId)) {
            accounts.revoke(hash, clock.instant());
        }
    }

    /**
     * 웹 게스트를 만든다. 웹이 처음 보호 기능을 쓰려 할 때 부른다 — 랜딩·동의 문서·입시 정보만 보는 동안에는
     * 서버에 계정이 생기지 않는다. 토큰의 구조와 갱신·만료는 회원과 같다.
     */
    public AuthenticatedUser createGuest() {
        byte[] random = new byte[32];
        GUEST_UIDS.nextBytes(random);
        return accounts.createGuest(Base64.getUrlEncoder().withoutPadding().encodeToString(random));
    }

    /**
     * 제공자 쪽에서 연결이 끊겼다는 알림 — 그 신원 행만 지운다. 계정은 남는다.
     *
     * <p>모르는 신원이어도 같은 결과다. 우리가 탈퇴 때 직접 끊은 경우에도 이 알림이 오는데, 그때는
     * 신원이 이미 해시로 바뀌어 있어 찾아지지 않는다.
     */
    public void identityDisconnected(String provider, String providerUid) {
        accounts.removeIdentity(provider, providerUid);
    }

    private void requireEnabled(String provider) {
        try {
            providers.requireEnabled(provider);
        } catch (UnsupportedProviderError unsupported) {
            throw unsupported(unsupported);
        }
    }

    private ProviderIdentity verify(String provider, String idToken) {
        try {
            return providers.verify(provider, idToken);
        } catch (UnsupportedProviderError unsupported) {
            throw unsupported(unsupported);
        } catch (ProviderConfigurationError misconfigured) {
            throw notConfigured(misconfigured);
        } catch (InvalidIdentityToken invalid) {
            throw invalidProviderToken(invalid);
        }
    }

    private NaverTokenClient.NaverGrant exchangeNaverCode(LoginCredentials credentials) {
        try {
            return naverTokens.exchange(
                    credentials.authorizationCode(),
                    credentials.codeVerifier(),
                    credentials.redirectUri(),
                    credentials.state());
        } catch (InvalidIdentityToken invalid) {
            throw invalidProviderToken(invalid);
        } catch (ProviderConfigurationError misconfigured) {
            throw notConfigured(misconfigured);
        } catch (ProviderUnavailable unavailable) {
            throw unavailable(unavailable);
        }
    }

    /**
     * 처음 온 신원의 이메일을 검증된 것으로 볼지. 구글·애플은 ID 토큰의 {@code email_verified} 다.
     * 카카오는 ID 토큰에 그 표시가 없어 사용자 정보 API 에 묻고, 네이버는 주소로 판단한다.
     */
    private boolean emailVerified(String provider, ProviderIdentity identity, String email) {
        if (email == null) {
            return false;
        }
        if ("naver".equals(provider)) {
            return NaverEmail.verifiedByAccountStructure(email);
        }
        if (!"kakao".equals(provider)) {
            return identity.emailVerified();
        }
        try {
            return kakaoUsers.emailVerified(identity.providerUid(), email);
        } catch (ProviderConfigurationError misconfigured) {
            throw notConfigured(misconfigured);
        } catch (ProviderUnavailable unavailable) {
            throw unavailable(unavailable);
        }
    }

    private static boolean naverOwnAddress(String provider, String email) {
        return "naver".equals(provider) && NaverEmail.verifiedByAccountStructure(email);
    }

    /** 처음 온 신원이 탈퇴 때 제공자 쪽 연결을 끊는 데 쓸 토큰. 애플과 네이버에만 있다. */
    private String providerToken(
            String provider,
            ProviderIdentity identity,
            LoginCredentials credentials,
            NaverTokenClient.NaverGrant naverGrant) {
        if (naverGrant != null) {
            return naverGrant.refreshToken();
        }
        if (!"apple".equals(provider)) {
            return null;
        }
        try {
            return appleTokens.exchange(credentials.authorizationCode(), identity.audience());
        } catch (InvalidIdentityToken invalid) {
            throw invalidProviderToken(invalid);
        } catch (ProviderConfigurationError misconfigured) {
            throw notConfigured(misconfigured);
        } catch (ProviderUnavailable unavailable) {
            throw unavailable(unavailable);
        }
    }

    /**
     * 기존 회원의 토큰을 최신으로 둔다. 네이버는 로그인마다 새 refresh token 이 온다. 애플은 토큰이
     * 없을 때만(1.0.0 이전에 가입한 회원) 이번 코드를 바꿔 채운다 — <b>실패해도 로그인은 된다.</b>
     * 기존 회원의 로그인은 애플의 장애와 무관해야 한다.
     */
    private void keepProviderToken(
            String provider,
            ProviderIdentity identity,
            LoginCredentials credentials,
            NaverTokenClient.NaverGrant naverGrant) {
        if (naverGrant != null) {
            if (naverGrant.refreshToken() != null) {
                accounts.storeProviderToken(
                        provider, identity.providerUid(), secrets.encrypt(naverGrant.refreshToken()));
            }
            return;
        }
        if (!"apple".equals(provider) || !accounts.lacksProviderToken(provider, identity.providerUid())) {
            return;
        }
        try {
            String grant = appleTokens.exchange(credentials.authorizationCode(), identity.audience());
            accounts.storeProviderToken(provider, identity.providerUid(), secrets.encrypt(grant));
        } catch (InvalidIdentityToken tolerated) {
            // 이미 쓰인 코드 같은 예상된 거절이다. 다음 로그인에서 다시 채운다.
        } catch (RuntimeException failure) {
            // 애플의 무응답(External Failure)도 여기로 온다. 로그인은 되지만 삼키지 않는다 — 계속 답하지
            // 않으면 탈퇴 때 폐기할 토큰이 영영 채워지지 않는데, 보고가 없으면 아무도 모른다 (ADR-025).
            failureReporter.report(failure, new FailureContext("AuthService.keepProviderToken"));
        }
    }

    /**
     * 같은 이메일의 계정에 이 신원을 붙인다. 이메일이 검증됐는지는 부르는 쪽이 이미 확인했다.
     *
     * <p>같은 신원으로 두 요청이 동시에 들어오면 하나는 유니크 제약에 걸린다. 그때는 진 쪽이
     * <b>다시 조회해</b> 이긴 쪽이 붙인 계정을 쓴다 — 경합을 오류로 내보내면 사용자에게는
     * 이유 없는 실패가 된다.
     */
    private AuthenticatedUser attachToExisting(
            AuthenticatedUser existing, String provider, ProviderIdentity identity, String providerToken) {
        try {
            accounts.linkIdentity(
                    existing.id(),
                    provider,
                    identity.providerUid(),
                    providerToken == null ? null : secrets.encrypt(providerToken));
            return existing;
        } catch (DataIntegrityViolationException | IdentityAlreadyLinkedError race) {
            AuthenticatedUser winner = accounts.findByIdentity(provider, identity.providerUid());
            if (winner == null) {
                throw race;
            }
            return winner;
        }
    }

    /** "이미 OO로 가입한 이메일이에요" — 기존 계정의 제공자 이름을 함께 싣는다. */
    private ApiException emailTaken(AuthenticatedUser existing) {
        return new ApiException(409, "account_exists_with_different_provider")
                .with("providers", accounts.providersOf(existing.id()));
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    /** 모르는 제공자이거나 운영에서 꺼 둔 제공자다. */
    private static ApiException unsupported(Throwable cause) {
        return new ApiException(400, "unsupported_provider", cause);
    }

    private static ApiException invalidProviderToken(Throwable cause) {
        return new ApiException(401, "invalid_provider_token", cause);
    }

    private static ApiException notConfigured(Throwable cause) {
        return ApiException.unexpected(503, "provider_not_configured", cause);
    }

    /** 제공자가 답하지 않는다. 계정은 만들어지지 않는다. */
    private static ApiException unavailable(Throwable cause) {
        return ApiException.external(502, "provider_unavailable", cause);
    }

    private static ApiException invalidRefresh() {
        return invalidRefresh(null);
    }

    private static ApiException invalidRefresh(Throwable cause) {
        return new ApiException(401, "invalid_refresh_token", cause);
    }

    /** 로그인의 두 갈래. 어느 쪽이든 응답은 200 이고 본문의 {@code result} 로 가른다. */
    public sealed interface LoginOutcome {

        /** 이미 있는 계정. */
        record SignedIn(AuthenticatedUser user) implements LoginOutcome {
        }

        /** 처음 온 신원 — 아직 아무 행도 없다. */
        record SignupRequired(
                String signupToken,
                long expiresIn,
                List<PendingConsent> documents) implements LoginOutcome {
        }
    }

    /** 발급된 한 쌍. 응답으로 옮기는 일은 web 어댑터가 한다. */
    public record TokenPair(String accessToken, String refreshToken, long expiresIn) {
    }

    /** 갱신을 낸 사람과, 그 갱신 한 번이 쓸 시각. */
    public record RefreshAttempt(AuthenticatedUser user, Instant now) {
    }
}
