package com.acttub.actingapi.integration.observation;

import com.google.genai.types.GenerateContentResponse;
import java.util.function.Supplier;

/**
 * 코치 답 한 턴의 생각 단계 요청과 실제 생각·출력 토큰 수(SOMA-780). 답장(첫 질문이 아닌 턴)만 생각을 최소로 쓰게 하고,
 * 로그·Langfuse 에 어떤 단계로 썼는지와 Gemini 가 알려 준 토큰 수를 남긴다.
 * {@link #run} 안에서 만든 요청만 이 값을 따른다. 인터페이스 시그니처를 바꾸지 않으려고 호출 스레드에 잠깐 붙인다.
 */
public final class ReplyTrace {
    private static final ThreadLocal<ReplyTrace> CURRENT = new ThreadLocal<>();

    private final boolean minimal;
    private volatile String thinking = "";
    private volatile int thoughtsTokens = -1;
    private volatile int candidatesTokens = -1;

    /** @param minimal 이 턴의 답을 생각 최소로 쓰게 요청할지(모델이 MINIMAL 을 받을 때만 실제로 적용된다). */
    public ReplyTrace(boolean minimal) {
        this.minimal = minimal;
    }

    /** 이 턴의 호출을 {@code call} 안에서 만든 요청에 적용한다. */
    public <T> T run(Supplier<T> call) {
        ReplyTrace previous = CURRENT.get();
        CURRENT.set(this);
        try {
            return call.get();
        } finally {
            if (previous == null) CURRENT.remove();
            else CURRENT.set(previous);
        }
    }

    /** 지금 스레드가 최소 생각을 요청한 {@link #run} 안인지. 테스트와 로그용이다. */
    public static boolean minimalRequested() {
        ReplyTrace current = CURRENT.get();
        return current != null && current.minimal;
    }

    static ReplyTrace current() {
        return CURRENT.get();
    }

    boolean minimal() {
        return minimal;
    }

    void applied(String level) {
        this.thinking = level;
    }

    /** 응답에 붙은 토큰 수를 남긴다. 여러 번 불렀으면 생각 토큰은 가장 큰 값, 출력 토큰은 마지막 값이다. */
    void usage(GenerateContentResponse response) {
        response.usageMetadata().ifPresent(usage -> {
            usage.thoughtsTokenCount().ifPresent(count -> thoughtsTokens = Math.max(thoughtsTokens, count));
            usage.candidatesTokenCount().ifPresent(count -> candidatesTokens = count);
        });
    }

    /** {@code minimal}, {@code low}, {@code off}(gemini-3 이전 모델) 중 마지막으로 요청한 단계. 아직 없으면 빈 글. */
    public String thinking() {
        return thinking;
    }

    /** 가장 큰 생각 토큰 수. 알려 주지 않았으면 -1. */
    public int thoughtsTokens() {
        return thoughtsTokens;
    }

    /** 마지막 출력 토큰 수. 알려 주지 않았으면 -1. */
    public int candidatesTokens() {
        return candidatesTokens;
    }
}
