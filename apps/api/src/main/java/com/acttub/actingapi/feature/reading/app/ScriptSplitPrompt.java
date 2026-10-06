package com.acttub.actingapi.feature.reading.app;

import java.util.List;

/**
 * 나누기 모델에 주는 지시문 (SOMA-593 7-3·7-14). 2026-10-02 시험의 지시문에 괄호만 있는 줄의 규칙 한 줄을 더했다 — 가짜 대본
 * 묶음을 실제 모델로 여러 판 돌렸을 때 판마다 달라지던 자리다. 「때·장소 줄은 s」도 넣어 봤으나 무대 묘사 지문까지 장면 머리로
 * 읽어 뺐다. 입력은 {@code 줄번호<TAB>원문} 이고 출력은
 * 줄마다 {@code 줄번호<TAB>종류<TAB>배역<TAB>떼어낼머리} 다. 글자는 모델이 쓰지 않는다 — 머리를 뗀 나머지가 대사다.
 */
public final class ScriptSplitPrompt {

    private static final String RULES = """
            너는 연기 연습 앱의 대본 분석기다. 대본 원문을 "줄번호<TAB>원문"으로 받는다.
            모든 줄에 대해 한 줄씩 "줄번호<TAB>종류<TAB>배역<TAB>떼어낼머리" 형식으로만 답한다. 설명·코드블록 없이 결과 줄만 쓴다.
            - 종류: d=대사, x=지문(행동·상황·괄호 지문·효과음), s=장면 머리, t=제목·작가, c=등장인물 소개, i=무시(쪽 번호·반복 머리글·워터마크·각주, 블록 형식의 이름만 있는 줄)
            - 배역: d일 때 말하는 배역 이름. 같은 사람은 같은 표기로 맞춘다. d가 아니면 비운다.
            - 떼어낼머리: 그 줄 맨 앞에서 본문이 아닌 부분(예: "윤서: ", "LOMOV. ", "[ 주인] ")을 원문 글자 그대로. 없으면 비운다.
            - 대사 안의 짧은 괄호 지문(예: (웃으며))은 대사에 둔다.
            - 이름 한 줄 뒤에 대사가 오는 블록 형식이면 이름 줄은 i, 뒤따르는 대사 줄마다 그 배역을 준다.
            - 괄호로만 이루어진 줄(예: "(사이)", "(가방을 내려놓으며)")은 블록 형식 안에 있어도 x다.
            - 받은 줄 번호를 하나도 빠뜨리지 않는다. 길어도 거절하거나 요약하지 말고 마지막 줄까지 모두 쓴다.""";

    /** 첫 호출에만 붙는다. 소설·기사를 붙여넣었을 때 조각 호출 수십 번을 내보내지 않으려는 것이다. */
    private static final String JUDGMENT = """
            답의 첫 줄은 "대본<TAB>예" 또는 "대본<TAB>아니오"다. 배역 이름과 그 배역이 말하는 대사가 있는 글(희곡·시나리오·대본, 혼자 하는 독백 포함)이면 예, 소설·기사·논문·목록처럼 말하는 배역이 없는 글이면 아니오다. 아니오면 그 한 줄만 쓴다.""";

    private static final String ROSTER = """
            대본 앞부분을 받는다. 그다음 줄부터 말하는 배역 이름 목록을 대본에 쓰인 표기 그대로 한 줄에 하나씩만 답한다. 설명 없이 이름만.""";

    private ScriptSplitPrompt() {
    }

    /**
     * @param judge 첫 호출인가 — 대본 여부 한 줄을 함께 받는다
     * @param roster 배역 목록 호출이 준 이름들. 비어 있으면 붙이지 않는다
     */
    public static String split(boolean judge, List<String> roster) {
        StringBuilder prompt = new StringBuilder(RULES);
        if (judge) {
            prompt.append('\n').append(JUDGMENT);
        }
        if (!roster.isEmpty()) {
            prompt.append("\n알려진 배역(이 표기를 그대로 쓴다. 목록에 없는 새 배역이 나오면 대본 표기대로 쓴다): ")
                    .append(String.join(", ", roster));
        }
        return prompt.toString();
    }

    /** 조각이 둘 이상일 때 앞 400줄로 배역 목록과 대본 여부를 함께 받는다. */
    public static String roster() {
        return JUDGMENT + "\n" + ROSTER;
    }
}
