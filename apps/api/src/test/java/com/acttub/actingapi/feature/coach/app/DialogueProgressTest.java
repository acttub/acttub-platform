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
    @Test void newInformationAndRequestsAreNotAcknowledgements() {
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
