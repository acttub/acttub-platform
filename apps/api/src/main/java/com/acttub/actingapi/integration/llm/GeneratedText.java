package com.acttub.actingapi.integration.llm;

/**
 * 생성 텍스트와 과금·관측에 필요한 토큰 사용량·모델명을 함께 보존한다.
 *
 * <p>모델명을 여기 싣는 이유는 <b>아는 자리와 쓰는 자리가 다르기 때문</b>이다. 어느 모델로
 * 불렀는지는 이 패키지만 알고(환경변수가 정한다), 그것을 남겨야 하는 코치·노트·기억 쪽은
 * 모른다. 응답에 실어 보내면 그 사이에 배관을 하나 더 놓지 않아도 된다.
 *
 * <p>모델을 모르는 시험용 구현이 많아 두 칸짜리 생성자를 남겨 둔다 — 그때 모델명은 빈
 * 문자열이고, 관측은 빈 값을 속성으로 만들지 않는다.
 */
public record GeneratedText(String text, TokenUsage usage, String model) {

    public GeneratedText {
        model = model == null ? "" : model;
    }

    public GeneratedText(String text, TokenUsage usage) {
        this(text, usage, "");
    }
}
