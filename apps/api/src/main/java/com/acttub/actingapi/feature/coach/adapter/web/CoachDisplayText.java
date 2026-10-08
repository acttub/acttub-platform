package com.acttub.actingapi.feature.coach.adapter.web;

import java.util.regex.Pattern;

/**
 * 앱에 보내는 코치 발화를 한 덩어리로 보이게 한다.
 *
 * <p>모바일 앱({@code apps/mobile/lib/practice/coach.ts} {@code splitCoachQuestion})은 물음표로 끝나는 코치 발화를
 * {@code . ! ? 。} 뒤 공백에서 잘라, 마지막 문장은 큰 질문 칸에, 앞 문장들은 힌트 칸에 나눠 보여 준다.
 * 코치의 관찰과 질문이 둘로 갈라지면 앞 말이 힌트처럼 작게 밀려나 대화가 끊겨 보인다.
 * 앱을 새로 내지 않고 막으려고, 문장부호와 그 뒤 공백 사이에 보이지 않는 글자(U+200B)를 끼운다.
 * 앱의 정규식은 문장부호 바로 뒤의 공백만 자르므로 더는 나누지 않는다. 화면의 띄어쓰기와 줄바꿈은 그대로다.
 *
 * <p>저장된 대화·모델 기록·운영 화면은 바꾸지 않는다. 앱으로 나가는 응답에만 쓴다.
 */
final class CoachDisplayText {
    private CoachDisplayText() {}

    static final String INVISIBLE = "\u200B";
    private static final Pattern SENTENCE_GAP = Pattern.compile("([.!?。])(?=\\s)");

    /** 물음표로 끝나는 코치 발화만 바꾼다(앱은 그때만 나눈다). 그 밖의 말과 배우의 말은 그대로. */
    static String keepWhole(String role, String text) {
        if (text == null || !("coach".equals(role) || "ai".equals(role))) return text;
        if (!text.strip().endsWith("?")) return text;
        return SENTENCE_GAP.matcher(text).replaceAll("$1" + INVISIBLE);
    }
}
