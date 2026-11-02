package com.acttub.actingapi.integration.llm;

/** 서버가 쓰는 OpenAI 글 모델의 유일한 정본. 모델을 바꿀 때는 이 값만 고치고 배포한다. */
public final class OpenAiModels {
    public static final String CHAT = "gpt-6-luna";

    private OpenAiModels() {
    }
}
