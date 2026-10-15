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

    /**
     * 현재 공개된 개인정보 수집·이용 동의 판({@code v9} 꼴)이 최소 판 이상인가. 숫자 부분만 비교한다.
     * 이 기기 ID 를 받는다는 내용은 v9 부터 동의 문서에 있으므로, 그 판이 공개되기 전에는 받아 두지 않는다.
     * 어느 쪽이든 읽을 수 없으면 {@code false}.
     */
    public static boolean privacyVersionAtLeast(String current, String minimum) {
        int actual = versionNumber(current);
        int required = versionNumber(minimum);
        return actual >= 0 && required >= 0 && actual >= required;
    }

    private static int versionNumber(String version) {
        if (version == null) {
            return -1;
        }
        String digits = version.strip().replaceFirst("^[vV]", "");
        return digits.matches("[0-9]{1,6}") ? Integer.parseInt(digits) : -1;
    }

    /** 36자 UUID 이면서 모두 0 이 아니다. */
    public static boolean isUsable(String deviceUuid) {
        return deviceUuid != null && UUID_FORMAT.matcher(deviceUuid).matches() && !ZERO.equals(deviceUuid);
    }
}
