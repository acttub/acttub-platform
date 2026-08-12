package com.acttub.actingapi.llm;

/** OpenAI Responses API가 돌려준 입력·출력 토큰 사용량. */
public record TokenUsage(int prompt, int completion, int total) {
}
