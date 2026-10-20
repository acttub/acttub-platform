package com.acttub.actingapi.integration.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/** 옵션 호출의 모델 선택·연결 실패·읽을 수 없는 본문·미완료 응답·사용량 계산 (OpenAI Responses). */
class OpenAiResponsesClientPayloadTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final GenerationOptions OPTIONS = new GenerationOptions("gpt-6-luna", "low", 200, null, null);

    private final List<OpenAiHttpRequest> requests = new ArrayList<>();

    private OpenAiResponsesClient client(Object... results) {
        List<Object> queue = new ArrayList<>(List.of(results));
        OpenAiHttpTransport transport = request -> {
            requests.add(request);
            Object result = queue.removeFirst();
            if (result instanceof IOException failure) {
                throw failure;
            }
            return new OpenAiHttpResponse(200, (String) result);
        };
        return new OpenAiResponsesClient(JSON, transport, transport, timeout -> transport, duration -> { },
                Map.of("OPENAI_API_KEY", "k", "OPENAI_CHAT_MODEL", "gpt-default")::get);
    }

    @Test
    void optionModelWinsAndUsageWithoutATotalIsSummed() {
        GeneratedText generated = client("""
                {"status":"completed","output_text":" 답 ","usage":{"input_tokens":5,"output_tokens":"7"}}
                """).generate("지침", "입력", OPTIONS);

        assertThat(generated).isEqualTo(new GeneratedText("답", new TokenUsage(5, 0, 5), "gpt-6-luna"));
        assertThat(requests.getFirst().body().path("model").asText()).isEqualTo("gpt-6-luna");
        assertThat(requests.getFirst().body().path("store").asBoolean(true)).isFalse();
        assertThat(client("{\"output_text\":\"기본\"}").generate("지침", "입력",
                new GenerationOptions(null, "low", 10, null, null)).model()).isEqualTo("gpt-default");
    }

    @Test
    void connectionFailureOnAnOptionCallIsAConnectionException() {
        IOException failure = new IOException("reset");

        assertThatThrownBy(() -> client(failure).generate("지침", "입력", OPTIONS))
                .isInstanceOf(OpenAiConnectionException.class)
                .hasCause(failure);
    }

    @Test
    void unreadableOrNonObjectBodyAndAnIncompleteResponseFail() {
        assertThatThrownBy(() -> client("not json").generate("지침", "입력", OPTIONS))
                .isInstanceOf(IllegalStateException.class).hasMessage("OpenAI 평문 응답을 읽지 못했습니다.");
        assertThatThrownBy(() -> client("[\"답\"]").generate("지침", "입력", OPTIONS))
                .isInstanceOf(IllegalStateException.class).hasMessage("OpenAI 평문 응답을 읽지 못했습니다.");
        assertThatThrownBy(() -> client("{\"status\":\"incomplete\",\"output_text\":\"잘린 답\"}")
                .generate("지침", "입력", OPTIONS))
                .isInstanceOf(IllegalStateException.class).hasMessage("OpenAI response did not complete");
        assertThat(client("{\"status\":\"incomplete\",\"output_text\":\"옵션 없는 호출\"}").generate("지침", "입력").text())
                .isEqualTo("옵션 없는 호출");
    }

    @Test
    void emptyAnswerWithoutARefusalHasNoDetailAndMalformedOutputItemsAreSkipped() {
        assertThatThrownBy(() -> client("""
                {"output":[1,{"content":"문자열"},{"content":[2,{"type":"refusal","refusal":""}]}],"usage":[]}
                """).generate("지침", "입력"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("OpenAI 평문 응답이 비었습니다.");
    }

    @Test
    void realSleeperWaitsAndAnInterruptStopsTheRetry() {
        long started = System.nanoTime();
        OpenAiResponsesClient.Sleeper.real().sleep(Duration.ofMillis(10));
        assertThat(System.nanoTime() - started).isGreaterThanOrEqualTo(Duration.ofMillis(10).toNanos());

        Thread.currentThread().interrupt();
        try {
            assertThatThrownBy(() -> OpenAiResponsesClient.Sleeper.real().sleep(Duration.ofSeconds(5)))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("OpenAI 재시도 대기가 중단됐습니다.");
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    void optionsRequireAPositiveBudgetAMatchingSchemaNameAndAPositiveTimeout() {
        assertThatThrownBy(() -> new GenerationOptions("m", "low", 0, null, null))
                .hasMessage("positive output budget required");
        assertThatThrownBy(() -> new GenerationOptions("m", "low", 1, "name", null))
                .hasMessage("schema name required");
        assertThatThrownBy(() -> new GenerationOptions("m", "low", 1, null, null, Duration.ZERO))
                .hasMessage("positive timeout required");
        assertThatThrownBy(() -> new GenerationOptions("m", "low", 1, null, null, Duration.ofSeconds(-1)))
                .hasMessage("positive timeout required");
        assertThat(new GenerationOptions("m", "low", 1, null, null, Duration.ofSeconds(90)).timeout())
                .isEqualTo(Duration.ofSeconds(90));
    }
}
