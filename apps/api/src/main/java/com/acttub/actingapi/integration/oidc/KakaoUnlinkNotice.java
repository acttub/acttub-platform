package com.acttub.actingapi.integration.oidc;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 카카오 "연결 해제 웹훅"의 검증 — 카카오 로그인 › 웹훅 › 연결 해제 웹훅.
 *
 * <p>카카오는 등록해 둔 주소로 {@code app_id}·{@code user_id}·{@code referrer_type} 을 보내고, 헤더
 * {@code Authorization: KakaoAK <기본 어드민 키>} 로 자기가 보낸 것임을 알린다. 이 웹훅에는 서명이
 * 없다 — <b>어드민 키의 일치가 검증의 전부다.</b> (SET 서명을 쓰는 것은 "계정 상태 변경 웹훅"이고
 * 1.0.0 은 그것을 받지 않는다.)
 *
 * <p>{@code KAKAO_APP_ID} 가 설정돼 있으면 {@code app_id} 도 맞춰 본다. 어드민 키가 앱마다 다르므로
 * 없어도 검증은 성립한다.
 */
@Component
public class KakaoUnlinkNotice {
    private static final String SCHEME = "KakaoAK ";

    private final String adminKey;
    private final String appId;

    public KakaoUnlinkNotice(
            @Value("${KAKAO_ADMIN_KEY:}") String adminKey,
            @Value("${KAKAO_APP_ID:}") String appId) {
        this.adminKey = adminKey == null ? "" : adminKey.strip();
        this.appId = appId == null ? "" : appId.strip();
    }

    /**
     * 헤더를 확인하고 끊긴 이용자의 카카오 회원번호를 돌려준다.
     *
     * @throws ProviderConfigurationError 어드민 키가 없다
     * @throws InvalidProviderNotice 헤더가 없거나 키가 다르거나, 우리 앱의 알림이 아니거나, 회원번호가 없다
     */
    public String unlinkedUserId(String authorization, String noticeAppId, String userId) {
        if (adminKey.isEmpty()) {
            throw new ProviderConfigurationError("KAKAO_ADMIN_KEY not configured");
        }
        if (authorization == null
                || !authorization.regionMatches(true, 0, SCHEME, 0, SCHEME.length())
                || !MessageDigest.isEqual(
                        adminKey.getBytes(StandardCharsets.UTF_8),
                        authorization.substring(SCHEME.length()).strip().getBytes(StandardCharsets.UTF_8))
                || userId == null
                || userId.isBlank()
                || (!appId.isEmpty() && !appId.equals(noticeAppId))) {
            throw new InvalidProviderNotice();
        }
        return userId.strip();
    }
}
