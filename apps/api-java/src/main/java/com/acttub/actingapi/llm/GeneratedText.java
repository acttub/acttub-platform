package com.acttub.actingapi.llm;

/** 생성 텍스트와 과금·관측에 필요한 토큰 사용량을 함께 보존한다. */
public record GeneratedText(String text, TokenUsage usage) {
}
