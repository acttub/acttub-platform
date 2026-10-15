package com.acttub.actingapi.integration.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

/**
 * 기능별 OpenAI 키로 부르는 생성기 모음. 기존/비직접 코칭은 {@link OpenAiResponsesClient} 빈
 * (OPENAI_COACH_API_KEY)이고, 대본 분리·코칭 노트(리포트)·배우 기억은 각자 전용 키를 읽는다
 * (OPENAI_SCRIPT_SPLIT_API_KEY, OPENAI_REPORT_API_KEY, OPENAI_MEMORY_API_KEY). 전용 키가 비면 모두
 * OPENAI_API_KEY 로 대체한다.
 *
 * <p>왜 {@code TextGenerator} 빈을 여럿 두지 않는가: 인자 없이 {@code TextGenerator} 를 받는 코치 쪽 주입과
 * 테스트 대역(@Primary·@MockitoBean)이 모호해진다. 그래서 기능 생성기는 이 한 빈이 호출 시점에 내준다.
 * 기본 {@code TextGenerator} 가 실제 클라이언트가 아니면(테스트 대역 등) 기능 생성기도 그 대역을 그대로 쓴다.
 */
@Component
public class OpenAiTextGenerators {
    static final String SCRIPT_SPLIT_KEY = "OPENAI_SCRIPT_SPLIT_API_KEY";
    static final String REPORT_KEY = "OPENAI_REPORT_API_KEY";
    static final String MEMORY_KEY = "OPENAI_MEMORY_API_KEY";

    private final ObjectProvider<TextGenerator> defaultGenerator;
    private final java.util.function.Function<String, TextGenerator> factory;
    private final java.util.concurrent.ConcurrentHashMap<String, TextGenerator> cache =
            new java.util.concurrent.ConcurrentHashMap<>();

    @org.springframework.beans.factory.annotation.Autowired
    public OpenAiTextGenerators(ObjectMapper objectMapper, ObjectProvider<TextGenerator> defaultGenerator) {
        this(defaultGenerator, keyName -> new OpenAiResponsesClient(objectMapper, keyName));
    }

    OpenAiTextGenerators(ObjectProvider<TextGenerator> defaultGenerator,
            java.util.function.Function<String, TextGenerator> factory) {
        this.defaultGenerator = defaultGenerator;
        this.factory = factory;
    }

    public TextGenerator scriptSplit() {
        return feature(SCRIPT_SPLIT_KEY);
    }

    public TextGenerator report() {
        return feature(REPORT_KEY);
    }

    public TextGenerator memory() {
        return feature(MEMORY_KEY);
    }

    private TextGenerator feature(String keyName) {
        TextGenerator base = defaultGenerator.getObject();
        if (!(base instanceof OpenAiResponsesClient)) {
            return base;
        }
        return cache.computeIfAbsent(keyName, factory);
    }
}
