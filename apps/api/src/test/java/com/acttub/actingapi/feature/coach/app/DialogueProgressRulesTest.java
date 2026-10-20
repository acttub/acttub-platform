package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Locale;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;

/** 대화 복구 신호: 배우의 말에서 혼란·모름·손 질문을 읽고, 그에 맞지 않는 코치 응답을 거절한다. */
class DialogueProgressRulesTest {
    ObjectNode input(String latest, String... limitations) {
        ObjectNode input = StructuredJson.MAPPER.createObjectNode();
        input.putObject("user_message").put("id", "m3").put("text", latest);
        input.putObject("coaching_state").put("revision", 4);
        input.putArray("recent_messages");
        var catalog = input.putObject("record_view").putArray("source_catalog");
        int i = 1;
        for (String limitation : limitations) {
            catalog.addObject().put("id", "l" + i++).put("kind", "record_limitation").put("text", limitation);
        }
        return input;
    }

    ObjectNode reply(String move, String message) {
        var reply = StructuredJson.MAPPER.createObjectNode().put("action", "respond").put("flow", "continue").put("message", message);
        reply.putObject("reply_link").put("move", move).putObject("selection").putNull("question");
        return reply;
    }

    @Test void handQuestionsCountOnlyWhenTheHandIsTheSubjectAndCannotBeSeen() {
        String offScreen = "손과 하체가 화면 밖이므로 손동작은 확인할 수 없다.";
        JsonNode asked = DialogueProgress.controls(input("손동작이 영상에서 잘 보였어?", offScreen));
        assertThat(asked.path("unobservable_hand_requested").asBoolean()).isTrue();
        assertThat(asked.path("unobservable_hand_refs").toString()).isEqualTo("[\"l1\"]");
        assertThat(DialogueProgress.controls(input("손동작 말고 표정이 영상에서 잘 보였어?", offScreen))
                .path("unobservable_hand_requested").asBoolean()).isFalse();
        assertThat(DialogueProgress.controls(input("Not my hands, but did my face read in the video?", offScreen))
                .path("unobservable_hand_requested").asBoolean()).isFalse();
        assertThat(DialogueProgress.controls(input("Did my hand gesture land in the video?", offScreen))
                .path("unobservable_hand_requested").asBoolean()).isTrue();
        JsonNode visible = DialogueProgress.controls(input("손동작이 영상에서 잘 보였어?", "손이 화면 가장자리에 걸쳐 있다."));
        assertThat(visible.path("unobservable_hand_requested").asBoolean()).isFalse();
        assertThat(visible.path("unobservable_hand_refs")).isEmpty();
    }

    @Test void notKnowingTheSceneAsksForExplanationInsteadOfPractice() {
        JsonNode progress = DialogueProgress.controls(input("모르겠어요."));
        assertThat(progress.path("analysis_uncertain").asBoolean()).isTrue();
        assertThat(DialogueProgress.turnInstruction(progress)).startsWith("\n\n[이번 응답에서 가장 먼저 지킬 것]\n배우는 아직 장면의 뜻을 모른다.");
        assertThatThrownBy(() -> DialogueProgress.validate(reply("explain", "한 번 말해 보세요."), progress))
                .hasMessageStartingWith("아직 장면의 뜻을 모른다.");
        assertThatThrownBy(() -> DialogueProgress.validate(reply("suggest", "끝을 짧게 해요."), progress))
                .hasMessageStartingWith("아직 장면의 뜻을 모른다.");
        assertThatCode(() -> DialogueProgress.validate(reply("explain", "이 대사는 떠나지 말라는 뜻이에요."), progress))
                .doesNotThrowAnyException();
    }

    @Test void confusionGetsAPlainExplanationFirst() {
        JsonNode progress = DialogueProgress.controls(input("무슨 말이야?"));
        assertThat(DialogueProgress.turnInstruction(progress)).startsWith("\n\n[이번 응답에서 가장 먼저 지킬 것]\n배우는 코치 말을 이해하지 못했다.");
        assertThatThrownBy(() -> DialogueProgress.validate(reply("explain", "제가 질문을 드린 건 장면 이야기예요."), progress))
                .hasMessageStartingWith("코치가 무엇을 물었는지 설명하지 않는다.");
        var asking = reply("explain", "떠나지 말라는 뜻이에요.");
        ((ObjectNode) asking.path("reply_link").path("selection")).putObject("question").put("missing_information", "이유");
        assertThatThrownBy(() -> DialogueProgress.validate(asking, progress)).hasMessageStartingWith("배우가 질문에 혼란을 보였다.");
        assertThat(DialogueProgress.turnInstruction(DialogueProgress.controls(input("떠나지 말라는 뜻 같아.")))).isEmpty();
        assertThat(DialogueProgress.turnInstruction(StructuredJson.MAPPER.createObjectNode().put("allow_finish", true)
                .put("explain_instead_of_repeating_question", true))).isEmpty();
    }

    @Test void theCoachDoesNotExplainItsOwnQuestionAgain() {
        JsonNode progress = DialogueProgress.controls(input("떠나지 말라는 뜻 같아."));
        assertThatThrownBy(() -> DialogueProgress.validate(reply("explain", "제가 묻는 건 상대가 무엇을 하길 바라는지예요."), progress))
                .hasMessageStartingWith("원래 질문을 반복해 설명하지 말고");
    }

    @Test void anInvisibleHandIsExplainedNotAssessed() {
        JsonNode progress = DialogueProgress.controls(input("손동작이 영상에서 잘 보였어?", "손은 화면 밖이다."));
        assertThatThrownBy(() -> DialogueProgress.validate(reply("assess", "손이 자연스러워요."), progress))
                .hasMessageStartingWith("손동작을 물었지만 손은 관찰할 수 없다.");
        assertThatCode(() -> DialogueProgress.validate(reply("explain", "손은 영상에서 보이지 않아요."), progress))
                .doesNotThrowAnyException();
    }

    @Test void onlyRespondActionsAreChecked() {
        var lookup = StructuredJson.MAPPER.createObjectNode().put("action", "lookup").put("flow", "finish");
        assertThatCode(() -> DialogueProgress.validate(lookup, DialogueProgress.controls(input("ㅇㅇ")))).doesNotThrowAnyException();
    }

    @Test void englishReadersGetTheFixedRepliesInEnglish() {
        LocaleContextHolder.setLocale(Locale.ENGLISH);
        try {
            ObjectNode input = input("Did my hand gesture land in the video?", "손은 화면 밖이다.");
            input.set("dialogue_progress", DialogueProgress.controls(input));
            JsonNode limit = DialogueProgress.observationLimitReply(input);
            assertThat(limit.path("message").asText())
                    .isEqualTo("I can't make out your hand movements in the video, so I can't judge how well that gesture landed.");
            assertThat(limit.path("reply_link").path("evidence_refs").toString()).isEqualTo("[\"l1\"]");
            assertThat(limit.path("base_state_revision").asInt()).isEqualTo(4);
            JsonNode correction = DialogueProgress.correctionTargetReply(input("I misspoke"));
            assertThat(correction.path("message").asText())
                    .isEqualTo("Do you mean you want to correct the answer you just gave me, or that you misspoke a line in the video?");
            assertThat(correction.path("reply_link").path("move").asText()).isEqualTo("clarify");
        } finally {
            LocaleContextHolder.resetLocaleContext();
        }
    }
}
