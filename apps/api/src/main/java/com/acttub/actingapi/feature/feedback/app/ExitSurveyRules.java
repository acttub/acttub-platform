package com.acttub.actingapi.feature.feedback.app;

import java.util.List;
import java.util.regex.Pattern;

import com.acttub.actingapi.platform.web.PythonText;

/**
 * 이탈 설문의 값 규칙 (practice.feedback).
 *
 * <p>대상은 코치·노트 화면에서의 이탈이고 계기는 x·leave·back 셋이다. 본문은 공백을 정리한 뒤 1~100자이고
 * 없을 수도 있다(건너뛰기 = {@code dismissed}). 연락처는 각각 80자 선택이다.
 */
public final class ExitSurveyRules {

    public static final List<String> SCREENS = List.of("coach", "report");
    public static final List<String> TRIGGERS = List.of("x", "leave", "back");
    public static final int BODY_MAX_CHARS = 100;
    public static final int CONTACT_MAX_CHARS = 80;

    private static final Pattern INTERNAL_WHITESPACE =
            Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS);

    private ExitSurveyRules() {
    }

    /**
     * 본문을 저장할 꼴로 다듬는다. 안쪽 공백을 하나로 접고 앞뒤를 턴다 — 기억의 규칙과 같다.
     *
     * @return 비어 있으면 {@code null}(건너뛰기)
     */
    public static String normalize(String raw) {
        if (raw == null) {
            return null;
        }
        String collapsed = PythonText.strip(INTERNAL_WHITESPACE.matcher(raw).replaceAll(" "));
        return collapsed.isEmpty() ? null : collapsed;
    }

    public static int length(String value) {
        return value == null ? 0 : value.codePointCount(0, value.length());
    }
}
