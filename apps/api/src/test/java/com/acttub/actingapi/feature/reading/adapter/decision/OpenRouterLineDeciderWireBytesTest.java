package com.acttub.actingapi.feature.reading.adapter.decision;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import com.acttub.actingapi.feature.reading.app.DeciderTally;
import com.acttub.actingapi.feature.reading.domain.LineReview;
import com.acttub.actingapi.feature.reading.domain.SpeakerMerge;
import com.acttub.actingapi.platform.config.JacksonConfig;
import com.acttub.actingapi.support.FrozenValue;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;
import org.springframework.context.annotation.Import;

/**
 * OpenRouter 판단 API 로 나가는 세 가지 요청(줄 판단, 말하는 글 판단, 배역 후보 판단)의 본문을 바이트 그대로 고정한다.
 * JSON 라이브러리를 바꿔도 같은 바이트가 나가야 한다. 운영과 같은 ObjectMapper(앱 설정과 {@link JacksonConfig})로 만들고,
 * 실제 HTTP 로 받은 바이트를 본다. 기대값은 {@code frozen/wire-bytes/openrouter-*.json} 이고 마지막에 줄바꿈이 없다.
 */
@JsonTest
@Import(JacksonConfig.class)
class OpenRouterLineDeciderWireBytesTest {
    /** 한글, 따옴표, 빗금, 역빗금, 줄바꿈, 탭, 제어 문자, 이모지. */
    private static final String TRICKY = "따옴표\"와 빗금/와 역빗금\\ 줄\n탭\t제어\u001f 이모지😀";
    /** 세 질문의 답을 모두 담은 응답. 요청마다 필요한 답만 읽는다. */
    private static final String ANSWER = "{\"answers\":{"
            + "\"kind\":{\"choice\":\"dialogue\",\"confidence\":0.9},"
            + "\"speaker\":{\"choice\":\"none\",\"confidence\":0.5},"
            + "\"script\":{\"choice\":\"speech\",\"confidence\":1},"
            + "\"role\":{\"choice\":\"r0\",\"probabilities\":{\"r0\":1}}}}";

    @Autowired
    ObjectMapper objectMapper;

    private final List<byte[]> received = new ArrayList<>();
    private HttpServer server;
    private OpenRouterLineDecider decider;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            received.add(exchange.getRequestBody().readAllBytes());
            byte[] out = ANSWER.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();
        decider = new OpenRouterLineDecider(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/"),
                objectMapper, "typesafe/jev-1.14", "not-a-real-key", Duration.ofSeconds(5), 1);
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    @Test
    @DisplayName("줄 판단 본문은 종류, 화자, 더 묻는 질문 순서로 보기를 싣는다")
    void lineQuestionBody() {
        LineReview.Question question = new LineReview.Question(7, Set.of("nohead"), TRICKY,
                List.of(new LineReview.Choice("민수", "민수", "배역 「민수」"),
                        new LineReview.Choice(LineReview.NONE, "없음", TRICKY)),
                null, List.of(new LineReview.Extra(LineReview.NOTE_QUESTION, LineReview.NOTE_INSTRUCTIONS, LineReview.NOTES)),
                null, null, Set.of());

        decider.decide(question, new DeciderTally());

        assertThat(received).hasSize(1);
        assertThat(received.getFirst()).asString(StandardCharsets.UTF_8)
                .isEqualTo(FrozenValue.of("wire-bytes/openrouter-line.json"));
    }

    @Test
    @DisplayName("말하는 글 판단 본문은 글과 고정 보기 두 개를 싣는다")
    void speechQuestionBody() {
        decider.speech(TRICKY, new DeciderTally());

        assertThat(received).hasSize(1);
        assertThat(received.getFirst()).asString(StandardCharsets.UTF_8)
                .isEqualTo(FrozenValue.of("wire-bytes/openrouter-speech.json"));
    }

    @Test
    @DisplayName("배역 후보 판단 본문은 역할 보기 뒤에 독립 배역, 배역 아님, 판단 보류를 싣는다")
    void roleQuestionBody() {
        SpeakerMerge.Candidate candidate = new SpeakerMerge.Candidate("민수\"", List.of("민수", "민 수/B"), TRICKY,
                false, List.of("태수"));

        decider.role(candidate, false, new DeciderTally());

        assertThat(received).hasSize(1);
        assertThat(received.getFirst()).asString(StandardCharsets.UTF_8)
                .isEqualTo(FrozenValue.of("wire-bytes/openrouter-role.json"));
    }
}
