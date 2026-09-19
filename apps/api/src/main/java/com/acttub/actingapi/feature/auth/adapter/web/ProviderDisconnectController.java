package com.acttub.actingapi.feature.auth.adapter.web;

import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

import com.acttub.actingapi.feature.auth.app.AuthService;
import com.acttub.actingapi.integration.oidc.InvalidProviderNotice;
import com.acttub.actingapi.integration.oidc.KakaoUnlinkNotice;
import com.acttub.actingapi.integration.oidc.NaverDisconnectNotice;
import com.acttub.actingapi.integration.oidc.ProviderConfigurationError;
import com.acttub.actingapi.platform.web.ApiException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 제공자가 부르는 연결 끊기 알림. 사용자가 제공자 쪽에서 Acttub 연결을 끊거나 제공자 회원을 탈퇴하면
 * 온다. <b>그 신원 행만 지우고 계정은 그대로 둔다</b> (account.login).
 *
 * <p>부르는 쪽이 앱이 아니라서 클라이언트 판 헤더도 액세스 토큰도 보지 않는다. 대신 제공자가 정한
 * 방법으로 보낸 쪽을 확인하고, 확인하지 못하면 401 이고 아무것도 지우지 않는다. 요청 형식은 각 제공자의
 * 공식 문서가 정한 그대로다 — {@link NaverDisconnectNotice}, {@link KakaoUnlinkNotice}.
 *
 * <p>응답 코드도 제공자가 정한다. 네이버는 <b>204</b>, 카카오는 3초 안의 <b>200 OK</b> 다 — 카카오는
 * "사용자 정보가 없어도 200 으로 답하라"고 하고, 다른 응답은 발송 실패로 본다. 모르는 신원이어도 같은
 * 응답이다(탈퇴로 이미 해시가 된 신원이 그렇다).
 */
@RestController
@RequestMapping("/v2/auth/providers")
class ProviderDisconnectController {
    private final AuthService auth;
    private final NaverDisconnectNotice naver;
    private final KakaoUnlinkNotice kakao;

    ProviderDisconnectController(AuthService auth, NaverDisconnectNotice naver, KakaoUnlinkNotice kakao) {
        this.auth = auth;
        this.naver = naver;
        this.kakao = kakao;
    }

    @Operation(
            summary = "Naver Disconnect Callback",
            description = """
                    네이버 로그인 연결 끊기 알림(개발가이드 §4.4). application/x-www-form-urlencoded 로
                    clientId·encryptUniqueId·timestamp·signature 가 온다. 서명은 HmacSHA256 이다.""",
            operationId = "naver_disconnect_v2_auth_providers_naver_disconnect_post",
            tags = "v2-auth")
    @ApiResponse(responseCode = "204", description = "신원을 지웠거나, 모르는 신원이다")
    @PostMapping("/naver/disconnect")
    ResponseEntity<Void> naverDisconnected(HttpServletRequest request) {
        Map<String, String> notice = parameters(request);
        auth.identityDisconnected("naver", verified(() -> naver.disconnectedUserId(
                notice.get("clientId"),
                notice.get("encryptUniqueId"),
                notice.get("timestamp"),
                notice.get("signature"))));
        return ResponseEntity.noContent().build();
    }

    @Operation(
            summary = "Kakao Unlink Callback",
            description = """
                    카카오 연결 해제 웹훅. app_id·user_id·referrer_type 이 오고, 헤더
                    Authorization: KakaoAK <기본 어드민 키> 로 보낸 쪽을 확인한다.""",
            operationId = "kakao_disconnect_v2_auth_providers_kakao_disconnect_post",
            tags = "v2-auth")
    @ApiResponse(responseCode = "200", description = "신원을 지웠거나, 모르는 신원이다. 본문은 없다")
    @PostMapping("/kakao/disconnect")
    ResponseEntity<Void> kakaoUnlinked(HttpServletRequest request) {
        Map<String, String> notice = parameters(request);
        auth.identityDisconnected("kakao", verified(() -> kakao.unlinkedUserId(
                request.getHeader("Authorization"),
                notice.get("app_id"),
                notice.get("user_id"))));
        return ResponseEntity.ok().build();
    }

    private static String verified(java.util.function.Supplier<String> check) {
        try {
            return check.get();
        } catch (InvalidProviderNotice forged) {
            throw new ApiException(401, "invalid_provider_signature", forged);
        } catch (ProviderConfigurationError misconfigured) {
            throw ApiException.unexpected(503, "provider_not_configured", misconfigured);
        }
    }

    /**
     * 쿼리 문자열과 폼 본문의 값. 본문을 직접 푸는 것은 {@code RequestBodyCachingFilter} 가 본문을 미리
     * 읽어 두기 때문이다 — 그러면 컨테이너가 폼 값을 파싱하지 못해 {@code getParameter} 에는 쿼리
     * 문자열의 값만 남는다. 같은 이름이 둘 다에 있으면 본문이 이긴다.
     */
    private static Map<String, String> parameters(HttpServletRequest request) {
        Map<String, String> values = new LinkedHashMap<>();
        request.getParameterMap().forEach((name, all) -> {
            if (all.length > 0) {
                values.put(name, all[0]);
            }
        });
        String contentType = request.getContentType();
        if (contentType == null
                || !contentType.toLowerCase(Locale.ROOT).startsWith("application/x-www-form-urlencoded")) {
            return values;
        }
        try {
            String body = new String(request.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            for (String pair : body.split("&")) {
                int split = pair.indexOf('=');
                if (split > 0) {
                    values.put(
                            URLDecoder.decode(pair.substring(0, split), StandardCharsets.UTF_8),
                            URLDecoder.decode(pair.substring(split + 1), StandardCharsets.UTF_8));
                }
            }
        } catch (IOException | IllegalArgumentException unreadable) {
            // 읽지 못한 값은 빠진 값이고, 빠진 값은 검증이 401 로 거절한다.
        }
        return values;
    }
}
