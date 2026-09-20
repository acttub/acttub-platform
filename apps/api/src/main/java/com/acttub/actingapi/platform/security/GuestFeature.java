package com.acttub.actingapi.platform.security;

import java.util.List;
import java.util.Set;

import org.springframework.util.AntPathMatcher;

/**
 * 웹 게스트가 쓰는 기능과, 그 기능을 쓰기 전에 결정돼 있어야 하는 동의 문서 (account.guest).
 *
 * <p><b>회원의 규칙과 다른 규칙이다</b>(ADR-028). 회원은 미결정 문서가 하나라도 있으면 모든 보호 기능이
 * 막히고, 게스트는 <b>그 기능의 문서만</b> 본다 — 동의를 시작할 때가 아니라 기능을 처음 쓰는 순간에
 * 받기 때문이다. 선택 문서는 게스트에게 묻지 않고 프로필 게이트도 면제한다.
 *
 * <p>리딩의 문서는 둘이다. 녹음을 AI 로 대조하면 AI 분석 동의도 필요한지는 (결정 필요)라 넣지 않았다.
 * 리딩의 경로는 아직 서버에 없다 — 그 영역이 서버에 붙을 때 {@link #READING} 의 표에 적는다.
 */
public enum GuestFeature {

    /** 연습 — 촬영·업로드·분석·코치 대화·노트, 그리고 거기서 쌓이는 배우 기억. */
    PRACTICE(
            Set.of("terms", "privacy", "ai_analysis"),
            List.of("/v2/uploads/**", "/v2/practice-sessions/**", "/v2/coach/**", "/v2/reports/**",
                    "/v2/me/memory/**")),

    /** 리딩 — 대본 등록·리딩·녹음. */
    READING(Set.of("terms", "privacy"), List.of());

    private static final AntPathMatcher PATHS = new AntPathMatcher();

    private final Set<String> requiredDocumentTypes;
    private final List<String> routes;

    GuestFeature(Set<String> requiredDocumentTypes, List<String> routes) {
        this.requiredDocumentTypes = requiredDocumentTypes;
        this.routes = routes;
    }

    /** 이 기능을 쓰기 전에 결정돼 있어야 하는 문서의 종류. */
    public Set<String> requiredDocumentTypes() {
        return requiredDocumentTypes;
    }

    /**
     * 이 경로가 게스트의 어느 기능인가. 어느 기능도 아니면 {@code null} 이고, 그것은 <b>회원 전용</b>이다 —
     * 적지 않은 새 경로는 게스트에게 닫힌 채로 시작한다.
     */
    public static GuestFeature of(String path) {
        for (GuestFeature feature : values()) {
            for (String pattern : feature.routes) {
                // `/**` 는 뿌리 경로 자체도 덮는다 — `/v2/reports/**` 는 `/v2/reports` 에도 맞는다.
                if (PATHS.match(pattern, path)) {
                    return feature;
                }
            }
        }
        return null;
    }
}
