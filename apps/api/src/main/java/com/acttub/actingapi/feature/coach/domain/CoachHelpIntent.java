package com.acttub.actingapi.feature.coach.domain;

import java.text.Normalizer;
import java.util.Locale;
import java.util.Set;

/** 짧은 도움 요청만 판별한다. "대사를 모르겠어요" 같은 실제 문제 설명은 제외한다. */
public final class CoachHelpIntent {
    private static final Set<String> UNSURE = Set.of(
            "잘모르겠어요", "잘모르겠어", "모르겠어요", "모르겠어", "모르겠습니다",
            "감이안와요", "생각이안나요", "이해가안돼요", "무슨뜻이에요",
            "idontknow", "imnotsure", "notsure", "idontunderstand");
    private static final Set<String> HELP = Set.of(
            "예시로설명해주세요", "explainwithanexample",
            "제가되물을게요", "코치에게질문", "askaquestion",
            "지금은연습하기어려워요다음에해볼방법을설명해주세요",
            "icantpracticenowpleaseexplainwhaticantrylater");

    private CoachHelpIntent() {
    }

    public static boolean isUnsure(String text) {
        return UNSURE.contains(normalize(text));
    }

    public static boolean isHelpOnly(String text) {
        return isUnsure(text) || HELP.contains(normalize(text));
    }

    public static boolean needsExplanation(String text) {
        return isUnsure(text) || Set.of("예시로설명해주세요", "explainwithanexample")
                .contains(normalize(text));
    }

    private static String normalize(String text) {
        return Normalizer.normalize(text, Normalizer.Form.NFKC)
                .toLowerCase(Locale.ROOT).replaceAll("[\\p{P}\\p{Z}\\s]", "");
    }
}
