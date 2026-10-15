package com.acttub.actingapi.integration.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;

/** 기능별 OpenAI 키 선택. 가짜 키 문자열과 가짜 전송기만 쓰고 실제 호출은 없다. */
class OpenAiFeatureKeysTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final OpenAiHttpResponse OK = new OpenAiHttpResponse(200, "{\"output_text\":\"ok\"}");

    private static final class Recording implements OpenAiHttpTransport {
        final List<String> authorizations = new ArrayList<>();

        @Override
        public OpenAiHttpResponse exchange(OpenAiHttpRequest request) throws IOException {
            authorizations.add(request.headers().get("Authorization"));
            return OK;
        }
    }

    private static OpenAiResponsesClient client(Recording transport, String keyName, Map<String, String> env) {
        return new OpenAiResponsesClient(MAPPER, transport, transport, t -> transport, d -> { }, env::get, keyName);
    }

    @Test
    void featureKeyWinsAndBlankOrMissingFallsBackToLegacyKey() {
        Recording transport = new Recording();
        client(transport, "OPENAI_REPORT_API_KEY",
                Map.of("OPENAI_REPORT_API_KEY", "report", "OPENAI_API_KEY", "legacy")).generate("s", "i");
        client(transport, "OPENAI_REPORT_API_KEY",
                Map.of("OPENAI_REPORT_API_KEY", "  ", "OPENAI_API_KEY", "legacy")).generate("s", "i");
        client(transport, "OPENAI_REPORT_API_KEY", Map.of("OPENAI_API_KEY", "legacy")).generate("s", "i");
        assertThat(transport.authorizations).containsExactly("Bearer report", "Bearer legacy", "Bearer legacy");
    }

    @Test
    void missingEverythingNamesBothVariables() {
        assertThatThrownBy(() -> client(new Recording(), "OPENAI_MEMORY_API_KEY", Map.of()).generate("s", "i"))
                .hasMessageContaining("OPENAI_MEMORY_API_KEY").hasMessageContaining("OPENAI_API_KEY");
    }

    @Test
    void defaultClientIsTheCoachKeyWithLegacyFallback() {
        Recording transport = new Recording();
        new OpenAiResponsesClient(MAPPER, transport, d -> { },
                Map.of("OPENAI_COACH_API_KEY", "coach", "OPENAI_SCRIPT_SPLIT_API_KEY", "split",
                        "OPENAI_API_KEY", "legacy")::get).generate("s", "i");
        new OpenAiResponsesClient(MAPPER, transport, d -> { }, Map.of("OPENAI_API_KEY", "legacy")::get)
                .generate("s", "i");
        assertThat(transport.authorizations).containsExactly("Bearer coach", "Bearer legacy");
    }

    @Test
    void eachFeatureGeneratorReadsItsOwnKeyAndStaysSeparateFromCoach() {
        Recording transport = new Recording();
        Map<String, String> env = Map.of(
                "OPENAI_COACH_API_KEY", "coach", "OPENAI_SCRIPT_SPLIT_API_KEY", "split",
                "OPENAI_REPORT_API_KEY", "report", "OPENAI_MEMORY_API_KEY", "memory", "OPENAI_API_KEY", "legacy");
        OpenAiResponsesClient coach = client(transport, "OPENAI_COACH_API_KEY", env);
        OpenAiTextGenerators generators = new OpenAiTextGenerators(provider(coach), keyName -> client(transport, keyName, env));

        coach.generate("s", "i");
        generators.scriptSplit().generate("s", "i");
        generators.report().generate("s", "i");
        generators.memory().generate("s", "i");
        assertThat(transport.authorizations)
                .containsExactly("Bearer coach", "Bearer split", "Bearer report", "Bearer memory");
        assertThat(generators.report()).isSameAs(generators.report()).isNotSameAs(generators.memory());
    }

    @Test
    void featureGeneratorsFallBackToLegacyWhenTheirKeysAreUnset() {
        Recording transport = new Recording();
        Map<String, String> env = Map.of("OPENAI_API_KEY", "legacy");
        OpenAiTextGenerators generators = new OpenAiTextGenerators(
                provider(client(transport, "OPENAI_COACH_API_KEY", env)), keyName -> client(transport, keyName, env));
        generators.scriptSplit().generate("s", "i");
        generators.report().generate("s", "i");
        generators.memory().generate("s", "i");
        assertThat(transport.authorizations).containsOnly("Bearer legacy").hasSize(3);
    }

    @Test
    void aReplacedDefaultGeneratorIsUsedForEveryFeature() {
        TextGenerator stub = new TextGenerator() {
            @Override
            public GeneratedText generate(String instructions, String input) {
                return new GeneratedText("stub", new TokenUsage(0, 0, 0), "stub");
            }
        };
        OpenAiTextGenerators generators = new OpenAiTextGenerators(provider(stub), keyName -> {
            throw new AssertionError("실제 클라이언트를 만들면 안 된다");
        });
        assertThat(generators.scriptSplit()).isSameAs(stub);
        assertThat(generators.report()).isSameAs(stub);
        assertThat(generators.memory()).isSameAs(stub);
    }

    private static ObjectProvider<TextGenerator> provider(TextGenerator generator) {
        DefaultListableBeanFactory factory = new DefaultListableBeanFactory();
        factory.registerSingleton("default", generator);
        return factory.getBeanProvider(TextGenerator.class);
    }
}
