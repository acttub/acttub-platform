package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class GeminiLayerOneObserverTest {
    private static SpeechFacts.Word w(String word, double start, double end) {
        return new SpeechFacts.Word(word, start, end);
    }

    @Test
    void chunksSplitOnPausesAndMergeTinyPieces() {
        var chunks = GeminiLayerOneObserver.chunks(List.of(
                w("세상에서", 1.0, 1.4), w("나를", 1.5, 1.8),
                w("야", 3.0, 3.2),
                w("우리", 5.0, 5.3), w("엄마", 5.35, 5.9)));
        // "야"(0.2초)는 앞 덩어리에 붙는다.
        assertThat(chunks).extracting(GeminiLayerOneObserver.Chunk::text)
                .containsExactly("세상에서 나를 야", "우리 엄마");
        assertThat(chunks.getFirst().start()).isEqualTo(1.0);
        assertThat(chunks.getFirst().end()).isEqualTo(3.2);
    }

    @Test
    void noWordsMeansNoChunks() {
        assertThat(GeminiLayerOneObserver.chunks(List.of())).isEmpty();
        assertThat(GeminiLayerOneObserver.chunks(null)).isEmpty();
    }

    @Test
    void promptListsChunksWithClockTimes() {
        String prompt = GeminiLayerOneObserver.prompt("", List.of(new GeminiLayerOneObserver.Chunk(65.2, 66.4, "다 토한 거야")));
        assertThat(prompt).contains("배우가 적은 장면: 없음").contains("0. 1:05~1:06 \"다 토한 거야\"");
    }

    @Test
    void blockUsesHeardLineSkipsEmptyAndKeepsReading() throws Exception {
        var chunks = List.of(new GeminiLayerOneObserver.Chunk(0, 1, "우리 엄마"),
                new GeminiLayerOneObserver.Chunk(2, 3, "야"), new GeminiLayerOneObserver.Chunk(4, 5, "다 뒤져 있더라"));
        var parsed = new ObjectMapper().readTree("""
                {"chunks":[{"i":0,"heard":"","seen":"정면을 보며 헛웃음","reading":"냉소일 수 있다"},
                           {"i":1,"heard":"","seen":"","reading":""},
                           {"i":2,"heard":"다 죽어 있더라","seen":"무표정으로 정면","reading":""}],
                 "overall":"담담하게 이야기한다."}""");
        String block = GeminiLayerOneObserver.block(chunks, parsed);
        assertThat(block).startsWith("## 1층 관찰")
                .contains("- 장면 흐름: 담담하게 이야기한다.")
                .contains("\"우리 엄마\" — 본 것: 정면을 보며 헛웃음 / 해석 후보: 냉소일 수 있다")
                .contains("\"다 죽어 있더라\" — 본 것: 무표정으로 정면")
                .doesNotContain("\"야\"");
    }

    @Test
    void blockIsEmptyWhenNothingSeen() throws Exception {
        var parsed = new ObjectMapper().readTree("{\"chunks\":[{\"i\":0,\"seen\":\"\"}],\"overall\":\"x\"}");
        assertThat(GeminiLayerOneObserver.block(List.of(new GeminiLayerOneObserver.Chunk(0, 1, "a")), parsed)).isEmpty();
    }
}
