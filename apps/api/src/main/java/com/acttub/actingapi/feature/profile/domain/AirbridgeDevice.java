package com.acttub.actingapi.feature.profile.domain;

import java.util.regex.Pattern;

/**
 * 앱이 넘기는 Airbridge 기기 ID 의 값 규칙. 서버가 귀속을 다시 조회하는 데 한 번 쓰고 지운다(V43).
 * 광고 추적 제한으로 0 으로 채워진 ID 는 아무 기기도 가리키지 않으므로 받지 않는다.
 */
public final class AirbridgeDevice {

    private static final Pattern UUID_FORMAT =
            Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
    private static final String ZERO = "00000000-0000-0000-0000-000000000000";

    private AirbridgeDevice() {
    }

    /** 36자 UUID 이면서 모두 0 이 아니다. */
    public static boolean isUsable(String deviceUuid) {
        return deviceUuid != null && UUID_FORMAT.matcher(deviceUuid).matches() && !ZERO.equals(deviceUuid);
    }
}
