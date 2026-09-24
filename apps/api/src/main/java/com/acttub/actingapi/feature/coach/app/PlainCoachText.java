package com.acttub.actingapi.feature.coach.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 코칭 출력은 평문이다(CONTRACT.md §8-5). 앱은 Markdown을 그리지 않으므로 모델이 섞은 제목·강조·목록·표·코드
 * 블록 기호를 저장 전에 걷어 낸다. 글자는 남기고 기호만 지우며, 인용한 대사와 일반 문장 부호는 건드리지 않는다.
 * 기호만 있던 응답은 빈 문자열이 되어 호출부가 실패로 처리한다.
 */
final class PlainCoachText {
    private static final Pattern FENCE = Pattern.compile("^(```|~~~).*");
    private static final Pattern TABLE_SEPARATOR = Pattern.compile("^\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)*\\|?$");
    private static final Pattern RULE = Pattern.compile("^([-*_])(\\s*\\1){2,}$");
    private static final Pattern HEADING = Pattern.compile("^#{1,6}(\\s+|$)");
    private static final Pattern BULLET = Pattern.compile("^[-*•+](\\s+|$)");
    private static final Pattern NUMBERED = Pattern.compile("^\\d{1,2}[.)]\\s+");
    private static final Pattern BOLD_STARS = Pattern.compile("\\*\\*(.+?)\\*\\*");
    private static final Pattern BOLD_UNDERSCORES = Pattern.compile("__(.+?)__");
    private static final Pattern INLINE_CODE = Pattern.compile("`([^`\\n]+)`");

    private PlainCoachText() {}

    static String plain(String text) {
        if (text == null || text.isBlank()) return "";
        List<String> lines = new ArrayList<>();
        for (String raw : text.replace("\r\n", "\n").replace('\r', '\n').split("\n", -1)) {
            String line = raw.strip();
            if (FENCE.matcher(line).matches() || TABLE_SEPARATOR.matcher(line).matches() || RULE.matcher(line).matches()) {
                continue;
            }
            line = HEADING.matcher(line).replaceFirst("");
            line = BULLET.matcher(line).replaceFirst("");
            line = NUMBERED.matcher(line).replaceFirst("");
            if (line.startsWith("|") && line.endsWith("|") && line.length() > 1) {
                line = Arrays.stream(line.substring(1, line.length() - 1).split("\\|"))
                        .map(String::strip).filter(cell -> !cell.isEmpty()).collect(Collectors.joining(" "));
            }
            line = BOLD_STARS.matcher(line).replaceAll("$1");
            line = BOLD_UNDERSCORES.matcher(line).replaceAll("$1");
            line = INLINE_CODE.matcher(line).replaceAll("$1");
            lines.add(line.replace("**", "").strip());
        }
        StringBuilder out = new StringBuilder();
        boolean pendingBlank = false;
        for (String line : lines) {
            if (line.isEmpty()) { pendingBlank = out.length() > 0; continue; }
            if (out.length() > 0) out.append(pendingBlank ? "\n\n" : "\n");
            out.append(line);
            pendingBlank = false;
        }
        return out.toString();
    }
}
