package com.acttub.actingapi.coach.domain;

import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 배우가 대화를 끝내겠다고 한 말인지 판정한다.
 *
 * <p>오탐이 미탐보다 훨씬 비싸다. 오탐이면 답변 도중에 세션이 끊기고, 미탐이면 배우가 '그만'을
 * 한 번 더 치면 된다. 그래서 길게 설명하는 문장은 종료로 보지 않는다. 어절 경계 없는 오타
 * '그렇그만'으로 세션이 끊긴 사고가 있어 loose 는 어절 시작만 본다.
 */
public final class ClosingIntent {

    private static final Pattern STRIP = Pattern.compile(
            "[\\s.,!?~…·'\"]+", Pattern.UNICODE_CHARACTER_CLASS);
    // 이 넷은 발화 전체가 그 말일 때만 종료로 본다. "끝"은 한 글자라
    // "끝까지", "끝나고" 같은 정상 답변에 항상 걸린다.
    private static final Set<String> EXACT = Set.of("그만", "종료", "끝", "여기까지");
    // 짧은 발화 안에서만 부분 일치를 허용한다 ("여기서 그만할게").
    private static final List<String> LOOSE = List.of("그만", "종료");
    private static final int LOOSE_MAX_LEN = 10;
    // 원본은 loose 단어마다 정규식을 두지만 둘의 패턴이 같아 하나로 둔다.
    private static final Pattern LOOSE_ENDING = Pattern.compile(
            "^\\s*(?:(?:할게|할래)(?:요)?|하자|하고\\s*싶어요?|요|용)?[\\s.,!?~…·'\"]*$",
            Pattern.UNICODE_CHARACTER_CLASS);
    private static final Set<String> NEGATIONS = Set.of("안", "못");

    private ClosingIntent() {
    }

    public static boolean isClosing(String text) {
        String stripped = STRIP.matcher(text).replaceAll("");
        if (EXACT.contains(stripped)) {
            return true;
        }
        if (stripped.length() > LOOSE_MAX_LEN) {
            return false;
        }
        for (String word : LOOSE) {
            int start = text.indexOf(word);
            while (start != -1) {
                if (start == 0 || Character.isWhitespace(text.charAt(start - 1))) {
                    String previousWord = previousWord(text.substring(0, start));
                    String ending = text.substring(start + word.length());
                    if (!NEGATIONS.contains(previousWord)
                            && LOOSE_ENDING.matcher(ending).matches()) {
                        return true;
                    }
                }
                start = text.indexOf(word, start + word.length());
            }
        }
        return false;
    }

    /** 종료어 바로 앞 어절에서 구두점을 걷어낸 값. 앞이 비었으면 빈 문자열이다. */
    private static String previousWord(String head) {
        String trimmed = head.stripTrailing();
        if (trimmed.isEmpty()) {
            return "";
        }
        int boundary = -1;
        for (int i = trimmed.length() - 1; i >= 0; i--) {
            if (Character.isWhitespace(trimmed.charAt(i))) {
                boundary = i;
                break;
            }
        }
        Matcher matcher = STRIP.matcher(trimmed.substring(boundary + 1));
        return matcher.replaceAll("");
    }
}
