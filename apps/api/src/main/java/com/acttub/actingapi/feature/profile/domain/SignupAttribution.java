package com.acttub.actingapi.feature.profile.domain;

import java.util.Set;

/**
 * 가입 계정의 유입 광고 (SOMA-588). 앱이 Airbridge SDK 에서 받은 설치 귀속 결과를 그 기기에서 새로 가입한
 * 계정에 한 번 붙인다. <b>계정마다 처음 온 값만 남는다</b> — 다시 와도 바꾸지 않는다.
 *
 * <p>광고 식별자는 없다. 채널·캠페인·광고 세트·소재처럼 광고를 가리키는 이름만 둔다. {@code channel} 이
 * {@code unattributed} 면 광고 없이 들어온 설치다(Airbridge 의 표기 그대로).
 *
 * @param source 귀속을 판정한 곳. 지금은 {@code airbridge} 하나
 * @param platform {@code ios} · {@code android}
 * @param channel 비어 있지 않다
 * @param campaign 없으면 {@code null}. 나머지 선택 값도 같다
 */
public record SignupAttribution(
        String source,
        String platform,
        String channel,
        String campaign,
        String adGroup,
        String adCreative,
        String content,
        String term,
        String subPublisher) {

    public static final Set<String> SOURCES = Set.of("airbridge");
    public static final Set<String> PLATFORMS = Set.of("ios", "android");
    /** 값 하나의 최대 글자 수. 앱은 이보다 긴 값을 잘라서 보낸다. */
    public static final int MAX_LENGTH = 200;
}
