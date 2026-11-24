package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
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
}
