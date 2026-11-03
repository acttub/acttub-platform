package com.acttub.actingapi.integration.observation;

import com.acttub.actingapi.platform.observability.LlmTokens;
import com.google.genai.types.GenerateContentResponse;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;
import java.util.stream.Collectors;

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
    /** 비용을 맞추려고 호출마다 더한 모델별 토큰. 줄이기·받아 적기처럼 스레드가 다른 호출도 함께 쓴다. */
    private final Map<String, LlmTokens> tokens;

    /** @param minimal 이 턴의 답을 생각 최소로 쓰게 요청할지(모델이 MINIMAL 을 받을 때만 실제로 적용된다). */
    public ReplyTrace(boolean minimal) {
        this(minimal, new ConcurrentHashMap<>());
    }

    private ReplyTrace(boolean minimal, Map<String, LlmTokens> tokens) {
        this.minimal = minimal;
        this.tokens = tokens;
    }

    /** 같은 턴의 다른 호출용. 토큰만 이 턴에 더하고, 생각 단계와 생각·출력 토큰 칸은 따로 둔다. */
    public ReplyTrace sibling(boolean minimal) {
        return new ReplyTrace(minimal, tokens);
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

    public static ReplyTrace current() {
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

    /** 모델 호출 한 번의 토큰을 더한다. 모르는 값은 건너뛴다. */
    public void add(String model, LlmTokens used) {
        if (!used.isUnknown()) tokens.merge(model, used, ReplyTrace::plus);
    }

    /** 이 모델 호출들의 토큰 합. 받은 적이 없으면 {@link LlmTokens#unknown()}. */
    public LlmTokens tokens(String model) {
        return model == null ? LlmTokens.unknown() : tokens.getOrDefault(model, LlmTokens.unknown());
    }

    /** 이 모델 말고 쓴 모델의 토큰. {@code 모델:입력/출력/합} 을 쉼표로 잇고, 없으면 빈 글이다. */
    public String otherModels(String model) {
        return tokens.entrySet().stream().filter(entry -> !entry.getKey().equals(model))
                .sorted(Map.Entry.comparingByKey())
                .map(entry -> entry.getKey() + ":" + entry.getValue().input() + "/" + entry.getValue().output()
                        + "/" + entry.getValue().total())
                .collect(Collectors.joining(","));
    }

    private static LlmTokens plus(LlmTokens left, LlmTokens right) {
        return LlmTokens.of(plus(left.input(), right.input()), plus(left.output(), right.output()),
                plus(left.total(), right.total()));
    }

    private static Integer plus(Integer left, Integer right) {
        return left == null ? right : right == null ? left : Integer.valueOf(left + right);
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
