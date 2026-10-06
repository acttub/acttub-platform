package com.acttub.actingapi.feature.profile.domain;

import java.util.Set;

/**
 * 가입 계정의 최초 유입 출처 (SOMA-588·SOMA-591). 앱은 Airbridge 설치 귀속을, 웹은 개인정보 수집·이용
 * 동의 뒤 주소의 안전한 UTM 을 계정에 한 번 붙인다. <b>계정마다 처음 온 값만 남는다</b> — 다시 와도 바꾸지
 * 않는다.
 *
 * <p>광고 식별자와 URL은 없다. Airbridge는 채널·캠페인·광고 세트·소재처럼 광고를 가리키는 이름만,
 * 웹은 기존 store-links 정책과 같은 짧은 ASCII 캠페인 토큰만 둔다. 웹 UTM은 클라이언트가 보고한 유입
 * 정보이며 광고 플랫폼의 설치 귀속과 같은 뜻이 아니다.
 *
 * @param source {@code airbridge} · {@code web_utm}
 * @param platform {@code ios} · {@code android} · {@code web}. source와 허용 조합이 정해져 있다
 * @param channel 비어 있지 않다. 웹에서는 {@code utm_source}
 * @param medium 웹의 {@code utm_medium}. Airbridge에서는 {@code null}
 * @param campaign 없으면 {@code null}. 나머지 선택 값도 같다
 */
public record SignupAttribution(
        String source,
        String platform,
        String channel,
        String medium,
        String campaign,
        String adGroup,
        String adCreative,
        String content,
        String term,
        String subPublisher) {

    public static final String AIRBRIDGE_SOURCE = "airbridge";
    public static final Set<String> AIRBRIDGE_PLATFORMS = Set.of("ios", "android");
    public static final String WEB_SOURCE = "web_utm";
    public static final String WEB_PLATFORM = "web";

    /** Airbridge 값 하나의 최대 글자 수. 앱은 이보다 긴 값을 잘라서 보낸다. */
    public static final int MAX_LENGTH = 200;
    /** 웹 UTM 값 하나의 최대 길이와 허용 문자. apps/web의 store-links 정책과 같다. */
    public static final int WEB_MAX_LENGTH = 64;
    public static final String WEB_VALUE_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]*$";
}
