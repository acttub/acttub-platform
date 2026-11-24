package com.acttub.actingapi.feature.practice.adapter.web;

import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.RewardedCoachingService;
import com.acttub.actingapi.integration.admob.AdMobRewardVerifier;
import com.acttub.actingapi.integration.admob.AdMobRewardVerifier.AdMobKeysUnavailable;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.web.ApiException;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 무료 코칭 한도 뒤 「광고 보고 1회 더」(SOMA-1067). 스위치({@code COACHING_REWARDED_AD_ENABLED}) 뒤의 기능이라 OpenAPI 에 싣지 않는다.
 *
 * <ul>
 *   <li>{@code GET /v2/coaching-rewards} — 앱: 지금 버튼을 보일까({@code available})</li>
 *   <li>{@code GET /v2/coaching-rewards/requests/{request_id}} — 앱: 광고를 띄울 때 만든 요청 id 로 지급됐는가({@code granted})</li>
 *   <li>{@code GET /v2/coaching-rewards/ssv} — AdMob 서버 측 확인 콜백. 서명이 권한이고 앱 토큰·앱 헤더가 없다</li>
 * </ul>
 */
@Hidden
@RestController
@RequestMapping("/v2/coaching-rewards")
class CoachingRewardController {
    private static final Logger LOG = LoggerFactory.getLogger(CoachingRewardController.class);

    private final RewardedCoachingService rewards;
    private final AdMobRewardVerifier verifier;
    private final AccessGate auth;

    CoachingRewardController(RewardedCoachingService rewards, AdMobRewardVerifier verifier, AccessGate auth) {
        this.rewards = rewards;
        this.verifier = verifier;
        this.auth = auth;
    }

    @GetMapping
    Map<String, Boolean> status(HttpServletRequest request, HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        AuthenticatedUser user = auth.gatedUser(request);
        return Map.of("available", rewards.available(user.id(), user.guest()));
    }

    /** 모양이 틀린 id 는 지급되지 않은 것과 같다. */
    @GetMapping("/requests/{requestId}")
    Map<String, Boolean> confirm(@PathVariable String requestId, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        AuthenticatedUser user = auth.gatedUser(request);
        return Map.of("granted", rewards.granted(user.id(), uuid(requestId)));
    }

    /**
     * AdMob 콜백. 서명이 틀리면 403(다시 보내도 소용없다), Google 공개키를 받지 못하면 503(다시 보내면 될 수 있다)이다. 서명이 맞으면
     * 지급하지 않는 경우(스위치 꺼짐·중복·상한·비대상)도 200 이다 — 콘솔의 「URL 확인」 시험 요청도 여기서 200 을 받는다.
     */
    @GetMapping("/ssv")
    Map<String, String> verify(HttpServletRequest request) {
        String query = request.getQueryString();
        boolean valid;
        try {
            valid = verifier.verify(query);
        } catch (AdMobKeysUnavailable failure) {
            throw ApiException.external(503, "admob_keys_unavailable", failure);
        }
        if (!valid) {
            throw new ApiException(403, "invalid_signature");
        }
        Map<String, String> params = AdMobRewardVerifier.params(query);
        RewardedCoachingService.Outcome outcome = rewards.grant(params.get("user_id"), params.get("custom_data"),
                params.get("transaction_id"));
        // 사용자 id 는 남기지 않는다 — 거래 id 만으로 AdMob 보고서와 맞춰 볼 수 있다.
        LOG.info("coaching reward callback transaction={} result={}", params.get("transaction_id"), outcome);
        return Map.of("result", outcome.name().toLowerCase(Locale.ROOT));
    }

    private static UUID uuid(String value) {
        try {
            return value == null || value.length() != 36 ? null : UUID.fromString(value);
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }
}
