package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import org.junit.jupiter.api.Test;

class DialogueProgressTest {
    @Test void aCorrectionCanBeFollowedByAnExplicitClosingSentence() {
        assertThat(DialogueProgress.actorFinished("실제 경험은 아니야. 여기까지 정리해줘")).isTrue();
        assertThat(DialogueProgress.actorFinished("알겠어. 오늘은 여기까지.")).isTrue();
        assertThat(DialogueProgress.actorFinished("ㅇㅇ")).isFalse();
        assertThat(DialogueProgress.actorFinished("‘여기까지 정리해줘’라는 대사야")).isFalse();
        assertThat(DialogueProgress.actorFinished("여기까지 정리하지 마")).isFalse();
    }
}
