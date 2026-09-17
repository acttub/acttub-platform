package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class DialogueProgressTest {
    @Test void aCorrectionCanBeFollowedByAnExplicitClosingSentence() {
        assertThat(DialogueProgress.actorFinished("실제 경험은 아니야. 여기까지 정리해줘")).isTrue();
        assertThat(DialogueProgress.actorFinished("알겠어. 오늘은 여기까지.")).isTrue();
        assertThat(DialogueProgress.actorFinished("ㅇㅇ")).isFalse();
        assertThat(DialogueProgress.actorFinished("‘여기까지 정리해줘’라는 대사야")).isFalse();
        assertThat(DialogueProgress.actorFinished("여기까지 정리하지 마")).isFalse();
    }
    private ObjectNode input(String latest, String lastMove, String previousActor) {
        ObjectNode input = StructuredJson.MAPPER.createObjectNode();
        input.putObject("user_message").put("text", latest);
        input.putObject("coaching_state").putObject("last_reply").put("move", lastMove);
        var messages = input.putArray("recent_messages");
        messages.addObject().put("role", "actor").put("text", previousActor);
        messages.addObject().put("role", "ai").put("text", "알겠어요.");
        return input;
    }
    private ObjectNode reply(String move, boolean question) {
        var reply = StructuredJson.MAPPER.createObjectNode().put("action", "respond").put("flow", "continue");
        var selection = reply.putObject("reply_link").put("move", move).putObject("selection");
        if (question) selection.putObject("question").put("missing_information", "말하는 이유");
        else selection.putNull("question");
        return reply;
    }
    @Test void anotherConfusedAnswerAfterRepairMustReceiveExplanationInsteadOfTheSameQuestion() {
        var progress = DialogueProgress.controls(input("무슨 질문이야 이게", "simplify", "무슨 말이야"));
        assertThatThrownBy(() -> DialogueProgress.validate(reply("simplify", true), progress))
                .hasMessageContaining("혼란");
        assertThatCode(() -> DialogueProgress.validate(reply("explain", false), progress)).doesNotThrowAnyException();
    }
    @Test void firstConfusionReceivesSceneExplanationWithoutRequiringAnotherAnswer() {
        var progress = DialogueProgress.controls(input("질문이 무슨 말이야?", "open", ""));
        var rephrasing = reply("simplify", true).put("message", "그 말을 해서 무엇을 원하나요?");
        assertThatThrownBy(() -> DialogueProgress.validate(rephrasing, progress)).hasMessageContaining("혼란");
        assertThatCode(() -> DialogueProgress.validate(reply("explain", false), progress)).doesNotThrowAnyException();
    }
    @Test void consecutiveAcknowledgementsMustNotProduceAnotherAcknowledgement() {
        var progress = DialogueProgress.controls(input("ㅇㅇ", "acknowledge", "ㅇㅇ"));
        assertThat(progress.path("consecutive_acknowledgements").asInt()).isEqualTo(2);
        assertThatThrownBy(() -> DialogueProgress.validate(reply("acknowledge", false), progress))
                .hasMessageContaining("다음 도움");
        assertThatCode(() -> DialogueProgress.validate(reply("explain", false), progress)).doesNotThrowAnyException();
        var close = reply("close", false).put("flow", "finish");
        assertThatThrownBy(() -> DialogueProgress.validate(close, progress)).hasMessageContaining("종료 요청이 아니다");
        progress.put("allow_finish", true);
        assertThatCode(() -> DialogueProgress.validate(close, progress)).doesNotThrowAnyException();
    }
    @Test void agreeingToAMethodDoesNotTriggerAnotherMethodPrescription() {
        var progress = DialogueProgress.controls(input("ㅇㅇ", "suggest", "조건을 확인하게 하고 싶어"));
        assertThatThrownBy(() -> DialogueProgress.validate(reply("suggest", false), progress)).hasMessageContaining("이미 방법");
        assertThatCode(() -> DialogueProgress.validate(reply("clarify", true), progress)).doesNotThrowAnyException();
    }
    @Test void anInvisibleHandIsNotAssessedUsingOtherBodyParts() {
        var input = input("내 손으로 붙잡는 연기는 잘 전달됐어?", "open", "");
        input.putObject("record_view").putArray("source_catalog").addObject()
                .put("kind", "record_limitation").put("text", "손과 하체가 화면 밖이므로 확인할 수 없다.");
        var progress = DialogueProgress.controls(input);
        assertThatThrownBy(() -> DialogueProgress.validate(reply("assess", false), progress)).hasMessageContaining("손동작");
        assertThatCode(() -> DialogueProgress.validate(reply("explain", false), progress)).doesNotThrowAnyException();
        ((ObjectNode) input.path("user_message")).put("text", "손해 본 걸 말하는 연기는 어때?");
        assertThat(DialogueProgress.controls(input).path("unobservable_hand_requested").asBoolean()).isFalse();
        ((ObjectNode) input.path("user_message")).put("text", "손 말고 목소리를 봐줘");
        assertThat(DialogueProgress.controls(input).path("unobservable_hand_requested").asBoolean()).isFalse();
    }
    @Test void newInformationAndRequestsAreNotAcknowledgements() {
        assertThat(DialogueProgress.controls(input("인물이 왜 이러는지 모르겠어", "clarify", ""))
                .path("explain_instead_of_repeating_question").asBoolean()).isFalse();
        assertThat(DialogueProgress.controls(input("ㅇㅇ 어쩌라고", "explain", "ㅇㅇ"))
                .path("consecutive_acknowledgements").asInt()).isZero();
        assertThat(DialogueProgress.controls(input("상대가 급하게 계약하려고 해서", "simplify", "무슨 말이야"))
                .path("explain_instead_of_repeating_question").asBoolean()).isFalse();
    }
    @Test void answeredOrUnresolvedObjectiveIsNotAskedAgainWithTheSameWording() {
        var input = input("상대가 급하게 계약하려고 해서", "clarify", "모르겠어");
        ((ObjectNode) input.path("recent_messages").get(1)).put("text", "그때 상대가 어떻게 하길 바랐나요?");
        var progress = DialogueProgress.controls(input);
        var repeated = reply("clarify", true).put("message", "그 이야기를 듣고 상대가 어떻게 하길 바라나요?");
        assertThatThrownBy(() -> DialogueProgress.validate(repeated, progress)).hasMessageContaining("이미 물었다");
        var different = reply("clarify", true).put("message", "마지막 대사는 무엇에 대한 오해를 푸는 말인가요?");
        assertThatCode(() -> DialogueProgress.validate(different, progress)).doesNotThrowAnyException();
    }
}
