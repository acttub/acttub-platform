package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * 영어로 쓰는 배우의 뜻도 같은 판정에 닿는지 본다 (SOMA-544).
 *
 * <p>한국어 판정과 같은 기준이다 — <b>오탐이 미탐보다 비싸다.</b> 마치자는 말로 잘못 보면
 * 대화가 도중에 끊기고, 못 알아보면 한 번 더 말하면 된다. 그래서 설명하는 문장은 잡지 않는다.
 */
class DialogueProgressEnglishTest {

    @ParameterizedTest
    @ValueSource(strings = {
        "That's it", "that's all", "Let's stop", "let's wrap up", "Wrap it up",
        "I'm done", "we're done", "Sum it up", "summarize what we talked about",
        "Okay, that's enough", "Let's call it for today", "That's all for now.",
    })
    @DisplayName("영어로 마치자고 하면 대화를 마칠 때가 된 것으로 본다")
    void finishesOnEnglishClosing(String text) {
        assertThat(DialogueProgress.actorFinished(text)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "I'm done with the first half but the ending still feels off",
        "That's the line where I stopped breathing",
        "I want to wrap up the scene with more energy next time",
        "She says that's all she can take, and then leaves",
        "I don't know what to do with my hands",
    })
    @DisplayName("설명하는 문장은 마치자는 말로 보지 않는다")
    void keepsTalkingOnExplanation(String text) {
        assertThat(DialogueProgress.actorFinished(text)).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "What do you mean?", "I don't understand", "i dont get the question",
        "Not sure what you're asking", "huh?", "???",
    })
    @DisplayName("영어로 질문을 못 알아들었다고 하면 쉬운 말로 풀어줄 때로 본다")
    void marksConfusion(String text) {
        assertThat(controlsFor(text).path("explain_instead_of_repeating_question").asBoolean()
                || controlsFor(text).path("confusion").asBoolean())
                .as("confusion 신호가 잡혀야 한다: %s", text)
                .isTrue();
    }

    private static ObjectNode controlsFor(String text) {
        ObjectNode input = StructuredJson.MAPPER.createObjectNode();
        input.putObject("user_message").put("text", text).put("id", "m1");
        input.putArray("recent_messages");
        input.putObject("coaching_state").put("revision", 0);
        input.putObject("record_view").putArray("source_catalog");
        return DialogueProgress.controls(input);
    }
}
