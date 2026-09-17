package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class DialogueProgressTest {
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
        assertThatCode(() -> DialogueProgress.validate(close, progress)).doesNotThrowAnyException();
    }
    @Test void newInformationAndRequestsAreNotAcknowledgements() {
        assertThat(DialogueProgress.controls(input("ㅇㅇ 어쩌라고", "explain", "ㅇㅇ"))
                .path("consecutive_acknowledgements").asInt()).isZero();
        assertThat(DialogueProgress.controls(input("상대가 급하게 계약하려고 해서", "simplify", "무슨 말이야"))
                .path("explain_instead_of_repeating_question").asBoolean()).isFalse();
    }
}
