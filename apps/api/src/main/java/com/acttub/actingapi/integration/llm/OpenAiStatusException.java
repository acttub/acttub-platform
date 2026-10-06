package com.acttub.actingapi.integration.llm;

/** OpenAI 가 2xx 가 아닌 상태로 답했다. 부르는 쪽이 429·5xx 만 다시 시도하도록 상태 코드를 든다. */
public class OpenAiStatusException extends IllegalStateException {
    private final int status;

    OpenAiStatusException(int status, String message) {
        super(message);
        this.status = status;
    }

    public int status() {
        return status;
    }

    /** 잠시 뒤 다시 보내면 될 수 있는 상태 — 붐빔(429)과 서버 쪽 실패(5xx). */
    public boolean retryable() {
        return status == 429 || status >= 500;
    }
}
