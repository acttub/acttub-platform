package com.acttub.actingapi.feature.auth.adapter.web;

import static com.acttub.actingapi.feature.auth.adapter.web.AuthDtos.*;

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
        requireIdToken(body);
        AuthService.LoginOutcome outcome = auth.login(
                body.provider(),
                new LoginCredentials(
                        body.idToken(),
                        body.authorizationCode(),
                        body.codeVerifier(),
                        body.redirectUri()));
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
     * ID 토큰은 네이버 말고는 전부 필수다. 빠지면 {@code @NotNull} 과 같은 모양의 422 배열이다 —
     * 네이버만 서버가 authorization code 를 교환해 ID 토큰을 얻는다.
     */
    private static void requireIdToken(LoginRequest body) {
        if (body.idToken() != null || "naver".equals(body.provider().strip().toLowerCase(Locale.ROOT))) {
            return;
        }
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("provider", body.provider());
        if (body.authorizationCode() != null) {
            input.put("authorization_code", body.authorizationCode());
        }
        throw ApiValidationException.missing(List.of("body", "id_token"), input);
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
