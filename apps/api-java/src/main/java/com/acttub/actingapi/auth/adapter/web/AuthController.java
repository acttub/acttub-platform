package com.acttub.actingapi.auth.adapter.web;
import java.util.*; import jakarta.servlet.http.HttpServletRequest; import jakarta.validation.Valid; import org.springframework.http.*; import org.springframework.web.bind.annotation.*; import com.acttub.actingapi.auth.app.AuthService; import com.acttub.actingapi.auth.app.PendingConsent; import com.acttub.actingapi.platform.security.AuthenticatedUser; import com.acttub.actingapi.platform.security.CurrentUserService; import com.acttub.actingapi.platform.security.FixedWindowRateLimiter; import com.acttub.actingapi.platform.web.ApiException; import io.swagger.v3.oas.annotations.*; import io.swagger.v3.oas.annotations.media.*; import io.swagger.v3.oas.annotations.responses.*; import io.swagger.v3.oas.annotations.security.SecurityRequirement; import static com.acttub.actingapi.auth.adapter.web.AuthDtos.*;
/**
 * 레이트리밋이 여기 남는다 — IP 와 주체로 세는 일이라 요청을 받는 자리의 몫이다. 로그인은
 * 주체가 정해지기 <b>전에</b> IP 로 한 번, 정해진 <b>뒤에</b> 주체로 한 번 센다.
 */
@RestController @RequestMapping("/v2/auth") public class AuthController {
    private final AuthService auth;private final CurrentUserService users;private final FixedWindowRateLimiter limiter;
    public AuthController(AuthService auth,CurrentUserService users,FixedWindowRateLimiter limiter){this.auth=auth;this.users=users;this.limiter=limiter;}
    @Operation(summary="Login",operationId="login_v2_auth_login_post",tags="v2-auth") @ApiResponses({@ApiResponse(responseCode="200",description="Successful Response",content=@Content(schema=@Schema(implementation=TokenPairResponse.class))),@ApiResponse(responseCode="422",description="Validation Error",content=@Content(schema=@Schema(implementation=HTTPValidationError.class)))})
    @PostMapping("/login") TokenPairResponse login(@Valid @RequestBody LoginRequest body,HttpServletRequest request){
        ipLimit(request);
        AuthenticatedUser user=auth.login(body.provider(),body.idToken(),body.signupAttribution());
        userLimit(user);
        AuthService.TokenPair tokens=auth.issueTokens(user.id(),request.getHeader("user-agent"));
        return new TokenPairResponse(tokens.accessToken(),tokens.refreshToken(),"bearer",tokens.expiresIn(),new AuthUser(user.id(),user.email(),user.status().dbValue()),auth.pendingConsents(user.id()).stream().map(AuthController::document).toList());
    }
    @Operation(summary="Refresh",operationId="refresh_v2_auth_refresh_post",tags="v2-auth") @ApiResponses({@ApiResponse(responseCode="200",description="Successful Response",content=@Content(schema=@Schema(implementation=RefreshTokenResponse.class))),@ApiResponse(responseCode="422",description="Validation Error",content=@Content(schema=@Schema(implementation=HTTPValidationError.class)))})
    @PostMapping("/refresh") RefreshTokenResponse refresh(@Valid @RequestBody RefreshRequest body,HttpServletRequest request){
        ipLimit(request);
        AuthService.RefreshAttempt attempt=auth.beginRefresh(body.refreshToken());
        userLimit(attempt.user());
        AuthService.TokenPair tokens=auth.rotateTokens(attempt.user().id(),body.refreshToken(),request.getHeader("user-agent"),attempt.now());
        return new RefreshTokenResponse(tokens.accessToken(),tokens.refreshToken(),"bearer",tokens.expiresIn());
    }
    @Operation(summary="Logout",operationId="logout_v2_auth_logout_post",tags="v2-auth",security=@SecurityRequirement(name="HTTPBearer")) @ApiResponses({@ApiResponse(responseCode="204",description="No Content"),@ApiResponse(responseCode="422",description="Validation Error",content=@Content(schema=@Schema(implementation=HTTPValidationError.class)))})
    @PostMapping("/logout") ResponseEntity<Void> logout(@Valid @RequestBody LogoutRequest body,HttpServletRequest request){
        AuthenticatedUser user=users.require(request);
        userLimit(user);
        auth.revokeRefresh(user.id(),body.refreshToken());
        return ResponseEntity.noContent().build();
    }
    private static ConsentDocument document(PendingConsent consent){return new ConsentDocument(consent.id(),consent.type(),consent.version(),consent.title(),consent.body(),consent.required(),consent.publishedAt());}
    private void ipLimit(HttpServletRequest r){String host=r.getRemoteAddr()==null?"unknown":r.getRemoteAddr();if(!limiter.allow("auth-ip:"+host,60))throw new ApiException(429,"rate limit exceeded");} private void userLimit(AuthenticatedUser u){if(!limiter.allow(u.id().toString(),60))throw new ApiException(429,"rate limit exceeded");}
}
