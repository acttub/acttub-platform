package com.acttub.actingapi.feature.coach.app;

import java.util.regex.Pattern;

import com.acttub.actingapi.feature.coach.domain.ClosingIntent;

/** 배우가 대화를 마치자고 했는지 가르는 좁은 판정. 배우의 해석을 평가하지 않는다. */
final class DialogueProgress {
    private DialogueProgress() { }

    /**
     * 영어로 쓰는 사람의 같은 뜻 (SOMA-544). 한국어 판정과 같은 기준이다 — 오탐이 미탐보다
     * 비싸므로, 발화 전체가 마치자는 말일 때만 잡고 설명하는 문장은 건드리지 않는다.
     */
    private static final Pattern FINISH_EN = Pattern.compile(
            "(?is)(?:.*[.!?]\\s*)?(?:(?:ok|okay|yes|yeah|alright|sure)[,\\s]*)?"
                    + "(?:(?:for\\s+today|for\\s+now)\\s*)?"
                    + "(?:that'?s\\s+(?:it|all|enough)|let'?s\\s+(?:stop|finish|wrap\\s*up|call\\s+it)"
                    + "|wrap\\s*(?:it\\s*)?up|i'?m\\s+done|we'?re\\s+done|sum\\s*(?:it\\s*)?up"
                    + "|summari[sz]e(?:\\s+(?:it|this|what\\s+we.{0,20}))?)"
                    + "(?:\\s+(?:for\\s+today|for\\s+now|please))?[.!?\\s]*");

    static boolean actorFinished(String text) {
        if (text == null) return false;
        if (ClosingIntent.isClosing(text)) return true;
        // A correction can precede an explicit closing sentence. Quoted script endings are not commands.
        String unquoted = text.replaceAll("“[^”]*”|‘[^’]*’|\"[^\"]*\"|'[^']*'", "");
        return unquoted.strip().matches("(?s)(?:.*[.!?。]\\s*)?(?:(?:네|응|ㅇㅇ|알겠어|알겠어요)[,\\s]*)?"
                + "(?:(?:오늘은|이번 대화는)\\s*)?여기까지(?:\\s*(?:할게|할게요|하자|정리해줘|정리해 주세요))?[.!?\\s]*")
                || unquoted.strip().matches("(?s)(?:.*[.!?。]\\s*)?(?:(?:여기까지|지금까지|오늘은|오늘 대화|이번 대화)\\s*)?정리(?:해줘|해 줘|해주세요|해 주세요)[.!?\\s]*")
                || FINISH_EN.matcher(unquoted.strip()).matches();
    }
}
