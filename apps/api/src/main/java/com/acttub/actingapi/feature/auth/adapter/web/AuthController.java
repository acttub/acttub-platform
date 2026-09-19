package com.acttub.actingapi.feature.auth.adapter.web;

import static com.acttub.actingapi.feature.auth.adapter.web.AuthDtos.*;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import com.acttub.actingapi.feature.auth.app.AuthService;
import com.acttub.actingapi.feature.auth.app.LoginCredentials;
import com.acttub.actingapi.feature.auth.app.PendingConsent;
import com.acttub.actingapi.feature.auth.app.SignupDecision;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.security.CurrentUserService;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 레이트리밋이 여기 남는다 — IP 와 주체로 세는 일이라 요청을 받는 자리의 몫이다. 로그인과 가입
 * 제출은 주체가 없는 요청이라 <b>IP 로만</b> 센다(각각 분당 60회). 갱신은 주체가 정해진 뒤 주체로
 * 한 번 더 센다.
 */
@RestController
@RequestMapping("/v2/auth")
public class AuthController {
    private final AuthService auth;
    private final CurrentUserService users;
    private final FixedWindowRateLimiter limiter;

    public AuthController(AuthService auth, CurrentUserService users, FixedWindowRateLimiter limiter) {
        this.auth = auth;
        this.users = users;
        this.limiter = limiter;
    }

    @Operation(
            summary = "Enabled Providers",
            description = """
                    운영에서 켜 둔 간편 로그인 제공자. 앱은 이 목록으로 로그인 버튼을 그린다 — 카카오·네이버는
                    검수 승인 뒤 서버 설정만 바꾸면 버튼이 나온다. 안드로이드에서 애플을 빼는 것은 앱이 한다.""",
            operationId = "providers_v2_auth_providers_get",
            tags = "v2-auth")
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ProvidersResponse.class)))
    @GetMapping("/providers")
    ProvidersResponse providers() {
        return new ProvidersResponse(auth.enabledProviders());
    }

    @Operation(summary = "Login", operationId = "login_v2_auth_login_post", tags = "v2-auth")
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "이미 있는 계정이면 signed_in, 처음 온 신원이면 signup_required",
                content = @Content(schema = @Schema(implementation = LoginResponse.class))),
        @ApiResponse(
                responseCode = "409",
                description = "제공자가 검증하지 않은 이메일이 기존 계정과 겹친다",
                content = @Content(schema = @Schema(implementation = AccountExistsError.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(implementation = HTTPValidationError.class)))
    })
    @PostMapping("/login")
    LoginResponse login(@Valid @RequestBody LoginRequest body, HttpServletRequest request) {
        ipLimit("auth-ip:", request);
        requireCredentials(body);
        AuthService.LoginOutcome outcome = auth.login(
                body.provider(),
                new LoginCredentials(
                        body.idToken(),
                        body.authorizationCode(),
                        body.codeVerifier(),
                        body.redirectUri(),
                        body.state()));
        return switch (outcome) {
            case AuthService.LoginOutcome.SignedIn signedIn -> signedIn(signedIn.user(), request);
            case AuthService.LoginOutcome.SignupRequired signup -> new SignupRequiredResponse(
                    "signup_required",
                    signup.signupToken(),
                    signup.expiresIn(),
                    signup.documents().stream().map(AuthController::document).toList());
        };
    }

    @Operation(summary = "Signup", operationId = "signup_v2_auth_signup_post", tags = "v2-auth")
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "계정이 생겼다",
                content = @Content(schema = @Schema(implementation = SignedInResponse.class))),
        @ApiResponse(
                responseCode = "409",
                description = "로그인과 제출 사이에 같은 이메일의 계정이 생겼다",
                content = @Content(schema = @Schema(implementation = AccountExistsError.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(implementation = HTTPValidationError.class)))
    })
    @PostMapping("/signup")
    SignedInResponse signup(@Valid @RequestBody SignupRequest body, HttpServletRequest request) {
        ipLimit("signup-ip:", request);
        List<SignupDecision> decisions = body.decisions().stream()
                .map(decision -> new SignupDecision(decision.documentId(), decision.action().name()))
                .toList();
        return signedIn(auth.signup(body.signupToken(), decisions), request);
    }

    @Operation(
            summary = "Create Guest",
            description = """
                    웹 게스트를 만든다. 웹이 처음 보호 기능(연습 시작, 대본 등록)을 쓰려 할 때 부른다 — 랜딩·동의
                    문서·입시 정보에서는 부르지 않는다. 한 IP 에서 시간당 10개까지다. 토큰의 구조와 갱신·만료는
                    회원과 같다.""",
            operationId = "create_guest_v2_auth_guest_post",
            tags = "v2-auth")
    @ApiResponse(
            responseCode = "201",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = GuestResponse.class)))
    @PostMapping("/guest")
    ResponseEntity<GuestResponse> createGuest(HttpServletRequest request) {
        String host = request.getRemoteAddr() == null ? "unknown" : request.getRemoteAddr();
        if (!limiter.allow("guest-ip:" + host, 10, Duration.ofHours(1))) {
            throw new ApiException(429, "rate limit exceeded");
        }
        AuthenticatedUser guest = auth.createGuest();
        AuthService.TokenPair tokens = auth.issueTokens(guest.id(), request.getHeader("user-agent"));
        return ResponseEntity.status(201).body(new GuestResponse(
                tokens.accessToken(),
                tokens.refreshToken(),
                "bearer",
                tokens.expiresIn(),
                new AuthUser(guest.id(), guest.email(), guest.status().dbValue()),
                "guest"));
    }

    @Operation(summary = "Refresh", operationId = "refresh_v2_auth_refresh_post", tags = "v2-auth")
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = RefreshTokenResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(implementation = HTTPValidationError.class)))
    })
    @PostMapping("/refresh")
    RefreshTokenResponse refresh(@Valid @RequestBody RefreshRequest body, HttpServletRequest request) {
        ipLimit("auth-ip:", request);
        AuthService.RefreshAttempt attempt = auth.beginRefresh(body.refreshToken());
        userLimit(attempt.user());
        AuthService.TokenPair tokens = auth.rotateTokens(
                attempt.user().id(), body.refreshToken(), request.getHeader("user-agent"), attempt.now());
        return new RefreshTokenResponse(
                tokens.accessToken(), tokens.refreshToken(), "bearer", tokens.expiresIn());
    }

    @Operation(
            summary = "Logout",
            operationId = "logout_v2_auth_logout_post",
            tags = "v2-auth",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "No Content"),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(implementation = HTTPValidationError.class)))
    })
    @PostMapping("/logout")
    ResponseEntity<Void> logout(@Valid @RequestBody LogoutRequest body, HttpServletRequest request) {
        AuthenticatedUser user = users.require(request);
        userLimit(user);
        auth.revokeRefresh(user.id(), body.refreshToken());
        return ResponseEntity.noContent().build();
    }

    private SignedInResponse signedIn(AuthenticatedUser user, HttpServletRequest request) {
        AuthService.TokenPair tokens = auth.issueTokens(user.id(), request.getHeader("user-agent"));
        return new SignedInResponse(
                "signed_in",
                tokens.accessToken(),
                tokens.refreshToken(),
                "bearer",
                tokens.expiresIn(),
                new AuthUser(user.id(), user.email(), user.status().dbValue()),
                auth.pendingConsents(user.id()).stream().map(AuthController::document).toList());
    }

    /**
     * 제공자에 필요한 자격 값이 빠졌으면 {@code @NotNull} 과 같은 모양의 422 배열이다. ID 토큰은 네이버
     * 말고는 전부 필수이고, 네이버는 서버가 교환할 authorization code 와 PKCE 의 code verifier 가
     * 필수다. (애플의 authorization code 만은 규칙 위반이라 서비스가 사유 코드로 답한다.)
     */
    private static void requireCredentials(LoginRequest body) {
        boolean naver = "naver".equals(body.provider().strip().toLowerCase(Locale.ROOT));
        String missing;
        if (!naver) {
            missing = body.idToken() == null ? "id_token" : null;
        } else if (body.authorizationCode() == null) {
            missing = "authorization_code";
        } else {
            missing = body.codeVerifier() == null ? "code_verifier" : null;
        }
        if (missing == null) {
            return;
        }
        // 자격 값은 되돌려 보내지 않는다. 무엇이 빠졌는지는 loc 이 말한다.
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("provider", body.provider());
        throw ApiValidationException.missing(List.of("body", missing), input);
    }

    private static ConsentDocument document(PendingConsent consent) {
        return new ConsentDocument(
                consent.id(),
                consent.type(),
                consent.version(),
                consent.title(),
                consent.body(),
                consent.required(),
                consent.publishedAt());
    }

    private void ipLimit(String bucket, HttpServletRequest request) {
        String host = request.getRemoteAddr() == null ? "unknown" : request.getRemoteAddr();
        if (!limiter.allow(bucket + host, 60)) {
            throw new ApiException(429, "rate limit exceeded");
        }
    }

    private void userLimit(AuthenticatedUser user) {
        if (!limiter.allow(user.id().toString(), 60)) {
            throw new ApiException(429, "rate limit exceeded");
        }
    }
}
