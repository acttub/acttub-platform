package com.acttub.actingapi.spike;

import java.util.function.Function;
import java.util.function.Supplier;

/**
 * {@code acting-summary/summarizer.py:summarize} 의 재시도 루프 대응.
 *
 * <p>원본은 {@code for _ in range(2)} 로 생성 호출을 감싼다 — 즉 <b>총 2회 시도 = 재시도 1회</b>다.
 * 두 번째 응답도 파싱에 실패하면 그대로 예외이며, <b>세 번째를 보지 않는다.</b>
 * 예외 문구도 단수형 {@code "failed to parse after retry"} 다.
 *
 * <p>M4 사양 3차 개정이 이 자리를 "재시도 2회" 로 적었다가 4차에서 고쳤다. 숫자를 늘리면
 * Gemini 호출 수가 늘어 스텁 호출 예산(fixtures/llm.json 의 budget)이 어긋난다.
 */
final class ParseRetryLoop {

    static final int ATTEMPTS = 2;

    static final class ParseFailedException extends RuntimeException {
        ParseFailedException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    private ParseRetryLoop() {
    }

    /**
     * @param generate 매 시도마다 새 응답 텍스트를 낸다(실제로는 Gemini 호출)
     * @param parse    응답을 파싱한다. 실패하면 예외를 던진다
     */
    static <T> T generateAndParse(Supplier<String> generate, Function<String, T> parse) {
        RuntimeException last = null;
        for (int attempt = 0; attempt < ATTEMPTS; attempt++) {
            String text = generate.get();
            try {
                return parse.apply(text);
            } catch (RuntimeException exc) {
                last = exc;
            }
        }
        throw new ParseFailedException("failed to parse after retry: " + last, last);
    }
}
