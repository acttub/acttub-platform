package com.acttub.actingapi.feature.report.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

/** 공개 연습 노트: 초점이 가리키는 구간, 시도 결과, 근거만 내보내고 배우 메시지·상태는 내보내지 않는다. */
class PracticeNotePublicViewTest {
    static JsonNode note(String focus, String attempts) {
        return StructuredJson.parse("""
                {"schema_version":"acttub.practice_note.v1","note_id":"n1","revision":3,"mode":"action",
                 "end_reason":"actor_finished","record_ref":null,"lifecycle":"active",
                 "copy":{"title":"말끝","summary":null},"reading":null,"direction":null,
                 "focus":%s,"practice":null,"attempts":%s,"open_points":[{"text":"끝 길이","source_refs":["e1"]}],
                 "source_catalog":[
                   {"id":"u1","kind":"video_utterance","text":"가지 마","start_ms":4000,"end_ms":5800},
                   {"id":"e1","kind":"video_observation","text":"고개를 숙인다","start_ms":1000,"end_ms":2000},
                   {"id":"e2","kind":"video_observation","text":"끝을 끈다","start_ms":5000,"end_ms":7000},
                   {"id":"m1","kind":"actor_message","text":"붙잡고 싶었어","start_ms":null,"end_ms":null},
                   {"id":"l1","kind":"record_limitation","text":"손은 화면 밖","start_ms":0,"end_ms":8000}]}
                """.formatted(focus, attempts));
    }

    @Test void aLocalFocusWithoutUtterancePointsAtItsFirstEvidence() {
        JsonNode view = PracticeNote.publicView(note("{\"label\":\"숙인 고개\",\"utterance_ref\":null,\"evidence_refs\":[\"e1\"]}", "[]"));
        assertThat(view.path("focus").toString()).isEqualTo("{\"label\":\"숙인 고개\",\"start_ms\":1000,\"end_ms\":2000,\"quote\":null}");
        assertThat(view.path("evidence").findValuesAsText("id")).containsExactly("u1", "e1", "e2", "l1");
        assertThat(view.path("open_points").toString()).isEqualTo("[\"끝 길이\"]");
    }

    @Test void aFocusWithNothingToPointAtHasNoRange() {
        JsonNode view = PracticeNote.publicView(note("{\"label\":\"전체\",\"utterance_ref\":\"x9\",\"evidence_refs\":[]}", "[]"));
        assertThat(view.path("focus").toString()).isEqualTo("{\"label\":\"전체\",\"start_ms\":null,\"end_ms\":null,\"quote\":null}");
    }

    @Test void aWholeVideoFocusSpansItsVideoEvidenceAndQuotesNothing() {
        JsonNode view = PracticeNote.publicView(note(
                "{\"label\":\"전체 흐름\",\"utterance_ref\":\"u1\",\"scope\":\"whole_video\",\"evidence_refs\":[\"e1\",\"e2\",\"m1\",\"x9\"]}", "[]"));
        assertThat(view.path("focus").toString()).isEqualTo("{\"label\":\"전체 흐름\",\"start_ms\":1000,\"end_ms\":7000,\"quote\":null}");
        JsonNode actorOnly = PracticeNote.publicView(note(
                "{\"label\":\"전체 흐름\",\"utterance_ref\":null,\"scope\":\"whole_video\",\"evidence_refs\":[\"m1\"]}", "[]"));
        assertThat(actorOnly.path("focus").path("start_ms").isNull()).isTrue();
    }

    @Test void attemptsShowTheActorsReportedResultOnly() {
        JsonNode view = PracticeNote.publicView(note("null", """
                [{"attempt_id":"a1","proposal_id":"p1","execution":"reported_tried",
                  "instruction":{"text":"끝을 짧게","source_refs":["c2"]},
                  "result":{"direction":"closer","statement":{"text":"덜 애원했어","source_refs":["m1"]},"basis":"actor_report"}},
                 {"attempt_id":"a2","proposal_id":"p1","execution":"not_tried","instruction":null,"result":null}]
                """));
        assertThat(view.path("focus").isNull()).isTrue();
        assertThat(view.path("attempts").toString()).isEqualTo(
                "[{\"attempt_id\":\"a1\",\"proposal_id\":\"p1\",\"execution\":\"reported_tried\",\"instruction\":\"끝을 짧게\","
                        + "\"result\":{\"direction\":\"closer\",\"statement\":\"덜 애원했어\",\"basis\":\"actor_report\"}},"
                        + "{\"attempt_id\":\"a2\",\"proposal_id\":\"p1\",\"execution\":\"not_tried\",\"instruction\":null,\"result\":null}]");
        assertThat(view.toString()).doesNotContain("붙잡고 싶었어");
    }
}
