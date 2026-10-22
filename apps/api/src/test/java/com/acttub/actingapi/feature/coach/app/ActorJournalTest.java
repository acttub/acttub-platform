package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/** 배우 일지 자동 칸 규칙(practice.journal, SOMA-720) — 10/19 v4 가상 대화(fixtures)로 확인한다. */
class ActorJournalTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    static JsonNode resource(String name) throws IOException {
        try (InputStream in = ActorJournalTest.class.getResourceAsStream("/coach/journal/" + name)) {
            return JSON.readTree(in);
        }
    }

    @Test
    void promptResourceIsTheAdoptedV4Prompt() {
        assertThat(JournalService.PROMPT).startsWith("너는 ACTTUB의 3층 기록 보조자다.");
        assertThat(JournalService.PROMPT).contains("\"schema_version\": \"acttub.actor_journal_draft.v4\"");
    }

    @Test
    void v4VideoFixtureKeepsEveryGroundedItemAndTurnsTheMomentIntoSeconds() throws IOException {
        ActorJournal.Draft draft = ActorJournal.sanitize(resource("v4-video.output.json"), resource("v4-video.input.json"));

        assertThat(draft.practice()).containsExactly(
                new ActorJournal.PracticeItem("「가지 마」 대사를 소리 지르지 않고 상대 눈을 보며 낮게 말해 봤어요", "actor_report"));
        assertThat(draft.character()).extracting(ActorJournal.CharacterItem::aspect).containsExactly("wants", "partner", "situation");
        assertThat(draft.feedback()).extracting(ActorJournal.FeedbackItem::at).containsExactly(42, null);
    }

    @Test
    void v4NoVideoFixtureLeavesCharacterAndFeedbackEmpty() throws IOException {
        ActorJournal.Draft draft = ActorJournal.sanitize(resource("v4-no-video.output.json"), resource("v4-no-video.input.json"));

        assertThat(draft.practice()).hasSize(1);
        assertThat(draft.character()).isEmpty();
        assertThat(draft.feedback()).isEmpty();
    }

    @Test
    void itemsWithoutRealGroundAreDropped() throws IOException {
        JsonNode input = resource("v4-video.input.json");
        ObjectNode output = (ObjectNode) resource("v4-video.output.json").deepCopy();
        // 실행했다고 했지만 근거가 코치 말뿐, 모르는 근거 id, 코치 짐작만으로 쓴 인물, 지시형 말투, 남의 말을 옮긴 꼬리.
        ArrayNode practice = output.putArray("practice");
        practice.addObject().put("text", "상대를 보며 말해 봤어요").put("basis", "actor_report").putArray("source_refs").add("c1");
        practice.addObject().put("text", "대사를 살펴봤어요").put("basis", "discussed").putArray("source_refs").add("zz9");
        ArrayNode character = output.putArray("character");
        character.addObject().put("aspect", "wants").put("text", "상대를 붙잡기").putArray("source_refs").add("c0");
        character.addObject().put("aspect", "partner").put("text", "오래 사귄 연인이자 같은 회사 동료").putArray("source_refs").add("sc1");
        ArrayNode feedback = output.putArray("feedback");
        feedback.addObject().put("text", "앞 대사부터 붙잡듯 말해 보세요").put("giver", "coach").putNull("moment_ref")
                .putArray("source_refs").add("c2");
        feedback.addObject().put("text", "상대를 오래 봤다고 했어요").put("giver", "coach").putNull("moment_ref")
                .putArray("source_refs").add("c1");

        ActorJournal.Draft draft = ActorJournal.sanitize(output, input);

        assertThat(draft.practice()).isEmpty();
        assertThat(draft.character()).isEmpty();
        assertThat(draft.feedback()).isEmpty();
    }

    @Test
    void videoEvidenceIsRefusedWhenThePracticeHadNoVideo() throws IOException {
        ObjectNode input = (ObjectNode) resource("v4-video.input.json").deepCopy();
        ((ObjectNode) input.path("session")).put("input_mode", "no_video");

        ActorJournal.Draft draft = ActorJournal.sanitize(resource("v4-video.output.json"), input);

        // 피드백 문장은 코치 말이 근거라 남지만 영상 시간은 붙지 않는다.
        assertThat(draft.feedback()).extracting(ActorJournal.FeedbackItem::at).containsOnlyNulls();
    }

    @Test
    void wrongSchemaVersionIsAGenerationFailure() {
        ObjectNode output = JSON.createObjectNode().put("schema_version", "acttub.actor_journal_draft.v3");
        assertThatThrownBy(() -> ActorJournal.sanitize(output, JSON.createObjectNode()))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void modelInputCarriesTurnsSceneAndAnswersVerbatim() {
        CoachSessionSnapshot session = session("evaluate", List.of(
                new CoachTurnSnapshot("ai", "어느 쪽으로 해 볼래요?"),
                new CoachTurnSnapshot("actor", "준호를 보며 선 긋기")));
        ActorJournal.Answers answers = new ActorJournal.Answers(new ActorJournal.Feeling("떨렸어요", "낮게 하니까 오히려 더 떨렸어요"),
                new ActorJournal.Unknown(false, "「잘 지내」가 서운한 건지 모르겠어요"), new ActorJournal.Next(false, "「잘 지내」부터 준호를 보며 말하기"),
                "준호를 보니까 「잘 지내」가 진짜 작별처럼 느껴졌다");
        PurposeView purpose = new PurposeView("evaluate", "wrap", List.of(), null, List.of(new PurposeView.Line(31, "잘 지내")),
                new PurposeView.Card(null, new PurposeView.CardItem(31, "준호를 안 보고 말해요"), null), null);

        ObjectNode input = ActorJournal.modelInput(JSON, session, purpose, answers);

        assertThat(input.path("session").path("input_mode").asText()).isEqualTo("video");
        assertThat(input.path("conversation").get(0).path("id").asText()).isEqualTo("c0");
        assertThat(input.path("conversation").get(1).path("id").asText()).isEqualTo("m0");
        assertThat(input.path("source_catalog").findValuesAsText("kind"))
                .containsExactly("coach_message", "actor_message", "scene_context", "video_observation", "video_utterance");
        assertThat(input.path("source_catalog").get(3).path("start_ms").asLong()).isEqualTo(31000L);
        assertThat(ActorJournal.answersOf(input.path("answers"))).isEqualTo(answers);

        ObjectNode talk = ActorJournal.modelInput(JSON, session("talk:stuck", session.turns()), purpose, answers);
        assertThat(talk.path("session").path("input_mode").asText()).isEqualTo("no_video");
        assertThat(talk.path("session").path("purpose").asText()).isEqualTo("stuck");
        assertThat(talk.path("source_catalog").findValuesAsText("kind")).doesNotContain("video_observation", "video_utterance");
    }

    static CoachSessionSnapshot session(String purpose, List<CoachTurnSnapshot> turns) {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null,
                "카페에서 헤어지자고 말하는 장면", "서연", null, 48000, null, null, null, "closed", "actor_finished", turns,
                null, "v2", 3, null, null, purpose);
    }
}
