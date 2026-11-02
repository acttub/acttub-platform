package com.acttub.actingapi.feature.reading.app;

import java.util.concurrent.atomic.DoubleAdder;
import java.util.concurrent.atomic.LongAdder;

import com.acttub.actingapi.platform.observability.LlmTokens;

/**
 * 한 작업 한 단계가 {@link LineDecider} 호출에 쓴 재시도·토큰·비용(SOMA-1019). 작업이 만들어 호출마다 넘기므로 판단 모델을 여러 작업이 함께 쓰고
 * 호출이 스레드 풀에서 돌아도 작업끼리 섞이지 않는다. 그 작업의 풀 스레드들이 동시에 더한다.
 */
public final class DeciderTally {
    private final LongAdder rateLimitRetries = new LongAdder();
    private final LongAdder otherRetries = new LongAdder();
    private final LongAdder inputTokens = new LongAdder();
    private final LongAdder outputTokens = new LongAdder();
    private final LongAdder measured = new LongAdder();
    private final DoubleAdder cost = new DoubleAdder();
    private final LongAdder priced = new LongAdder();

    /** 다시 보낼 때마다 부른다. @param rateLimited 직전 응답이 429 다 */
    public void retried(boolean rateLimited) {
        (rateLimited ? rateLimitRetries : otherRetries).increment();
    }

    /** 성공한 응답의 사용량. @param costUsd 응답에 없으면 {@code null} */
    public void used(int input, int output, Double costUsd) {
        inputTokens.add(input);
        outputTokens.add(output);
        measured.increment();
        if (costUsd != null) {
            cost.add(costUsd);
            priced.increment();
        }
    }

    public long rateLimitRetries() {
        return rateLimitRetries.sum();
    }

    public long otherRetries() {
        return otherRetries.sum();
    }

    public LlmTokens tokens() {
        if (measured.sum() == 0) {
            return LlmTokens.unknown();
        }
        int input = inputTokens.intValue();
        int output = outputTokens.intValue();
        return LlmTokens.of(input, output, input + output);
    }

    /** 합친 비용(달러). 비용을 알려 준 응답이 하나도 없으면 {@code null}. */
    public Double cost() {
        return priced.sum() == 0 ? null : cost.sum();
    }
}
