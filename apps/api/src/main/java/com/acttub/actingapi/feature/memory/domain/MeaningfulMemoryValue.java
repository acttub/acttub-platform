package com.acttub.actingapi.feature.memory.domain;

import java.util.Optional;
import java.util.regex.Pattern;

/**
 * 기억 갱신(모델)이 낸 값이 <b>배우에 대한 말인지</b> 본다 (SOMA-795).
 *
 * <p>운영 기억에 "…표현과 표정에서 막히는 지점을 골랐다." 처럼 배우가 화면에서 무엇을 눌렀는지, "…지적이 있었고" 처럼 코치가
 * 무엇을 했는지 적힌 값이 쌓여 있었다(2026-10-22). 다음 연습의 코치에게는 아무것도 알려 주지 않으면서 칸만 차지하고,
 * 이전의 쓸 만한 값을 밀어낸다. 그런 값은 버리고 이전 값을 그대로 둔다. 프롬프트에도 같은 말을 적었지만 모델이 늘 지키지는
 * 않으므로 여기가 방어선이다.
 */
public final class MeaningfulMemoryValue {

    /**
     * 이보다 짧으면 다음 연습에 가져갈 내용이 없다고 본다(공백·부호 제외 글자 수). 1~2자("합격", "네")만 막는다 — 5자로 두면
     * "복수하기"·"사과받기" 같은 네 글자 인물 목표까지 버린다.
     */
    static final int MIN_LETTERS = 3;

    /** 화면에서 무엇을 골랐는지 — 배우가 아니라 선택 UI 를 설명한다. */
    private static final Pattern SELECTION = Pattern.compile(
            "골랐|고른\\s*(것|지점|칸|항목|막히는)|선택지|버튼|화면에서");

    /** 코치가 무엇을 했는지 — 대화의 진행을 옮긴 것이다. */
    private static final Pattern COACH_PROCESS = Pattern.compile(
            "지적(이|을|받|했|됐|되었)|코치(가|는|의|에게서)|피드백을\\s*(받|주|들)|"
                    + "(이번|지난)\\s*(연습|대화|회차)에서는?\\s.*(다뤘|나눴|이야기했|진행했)|대화를\\s*(나눴|진행)");

    /** 코치가 무엇을 했는지 가운데 "바라는 것" 칸에도 해당하는 것 — 그 칸은 "코치가 ~해 주길 바란다" 가 정상이다. */
    private static final Pattern COACH_PROCESS_FOR_WANTS = Pattern.compile(
            "지적(이|을|받|됐|되었)|피드백을\\s*(받았|들었)|(이번|지난)\\s*(연습|대화|회차)에서는?\\s.*(다뤘|나눴|이야기했|진행했)");

    /** 없다는 말을 값으로 적은 것. 칸을 빼야 할 자리다. */
    private static final Pattern ABSENCE = Pattern.compile(
            "^\\s*(없음|없다|없습니다|미정|해당\\s*없|알\\s*수\\s*없)|특정(되지|하지)\\s*않|드러나지\\s*않았|확인되지\\s*않|언급(이|하지)\\s*(없|않)");

    private MeaningfulMemoryValue() {
    }

    /**
     * @return 버릴 이유. 쓸 만하면 비어 있다
     */
    public static Optional<String> problem(String field, String value) {
        if (value == null) return Optional.of("빈 값");
        String letters = value.replaceAll("[\\s\\p{Punct}“”‘’「」·…]", "");
        if (letters.codePointCount(0, letters.length()) < MIN_LETTERS) return Optional.of("너무 짧음");
        if (ABSENCE.matcher(value).find()) return Optional.of("없다는 말");
        if (SELECTION.matcher(value).find()) return Optional.of("화면 선택을 설명함");
        Pattern coach = "wants".equals(field) ? COACH_PROCESS_FOR_WANTS : COACH_PROCESS;
        if (coach.matcher(value).find()) return Optional.of("코치의 진행을 설명함");
        return Optional.empty();
    }
}
