package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * practice.note 의 "요약 인용 ≤ 2 이고 각 인용에 출처(배우 말·관찰)가 있다" 를 본다.
 *
 * <p>노트 정본({@code acttub.practice_note.v1})은 3층 모델이 고른 발췌를 한 줄로 이어 {@code copy.summary} 에
 * 두고 출처 목록만 따로 남긴다. {@link NoteWriter} 가 그 둘과 {@code source_catalog} 로 발췌를 되살리는데,
 * 여기서는 <b>되살린 것이 출처 원문의 조각인지</b>와 <b>코치의 말이 인용이 되지 않는지</b>를 본다.
 */
class NoteSummaryQuotesTest {

    private static final String NOTE = """
            {"schema_version":"acttub.practice_note.v1",
             "copy":{"title":"대사가 끝난 뒤 시선",
                     "text_unused":null,
                     "summary":{"text":"“붙잡고는 싶어”라고 했어요. 대사가 끝난 뒤 시선이 아래로 내려간다.",
                                "source_refs":["m1","e1"]}},
             "source_catalog":[
               {"id":"m1","kind":"actor_message","text":"붙잡고는 싶어 그런데 애원처럼 보이긴 싫어."},
               {"id":"e1","kind":"video_observation","text":"대사가 끝난 뒤 시선이 아래로 내려간다."},
               {"id":"c1","kind":"coach_message","text":"지금까지 이야기한 내용으로 정리할게요."}]}
            """;

    @Test
    @DisplayName("practice.note: 요약 인용은 배우 말과 관찰의 원문 발췌이고 각 인용에 출처가 붙는다")
    void summaryQuotesCarryTheirSource() {
        JsonNode quotes = NoteWriter.summaryQuotes(StructuredJson.parse(NOTE));

        assertThat(quotes).hasSize(2);
        assertThat(quotes.get(0).path("quote").asText()).isEqualTo("붙잡고는 싶어");
        assertThat(quotes.get(0).path("source_ref").asText()).isEqualTo("m1");
        assertThat(quotes.get(0).path("kind").asText()).isEqualTo("actor");
        assertThat(quotes.get(1).path("quote").asText()).isEqualTo("대사가 끝난 뒤 시선이 아래로 내려간다.");
        assertThat(quotes.get(1).path("source_ref").asText()).isEqualTo("e1");
        assertThat(quotes.get(1).path("kind").asText()).isEqualTo("observation");
    }

    @Test
    @DisplayName("practice.note: 요약이 없는 노트의 인용은 빈 배열이고, 코치 발화는 인용이 되지 않는다")
    void summaryQuotesStayEmptyWithoutASummaryAndNeverQuoteTheCoach() {
        JsonNode none = StructuredJson.parse(
                "{\"copy\":{\"title\":\"제목\",\"summary\":null},\"source_catalog\":[]}");
        assertThat(NoteWriter.summaryQuotes(none)).isEmpty();

        JsonNode coachOnly = StructuredJson.parse("""
                {"copy":{"summary":{"text":"지금까지 이야기한 내용으로 정리할게요.","source_refs":["c1"]}},
                 "source_catalog":[{"id":"c1","kind":"coach_message",
                                    "text":"지금까지 이야기한 내용으로 정리할게요."}]}
                """);
        assertThat(NoteWriter.summaryQuotes(coachOnly)).isEmpty();
    }
}
