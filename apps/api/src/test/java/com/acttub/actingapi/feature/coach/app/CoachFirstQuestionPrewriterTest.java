package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

/** 분석이 끝나면 첫 질문을 미리 쓴다(SOMA-780). */
class CoachFirstQuestionPrewriterTest {
    final UUID user = UUID.randomUUID();
    final UUID practice = UUID.randomUUID();

    @Test void itPrewritesInTheBackgroundOnlyWhenTheOwnerIsKnown() throws Exception {
        var calls = new LinkedBlockingQueue<List<UUID>>();
        var prewriter = new CoachFirstQuestionPrewriter((owner, session) -> calls.add(List.of(owner, session)),
                Executors.newSingleThreadExecutor());
        prewriter.onAnalysisComplete(practice);
        prewriter.onAnalysisComplete(practice, null);
        prewriter.onAnalysisComplete(null, user);
        prewriter.onAnalysisComplete(practice, user);

        assertThat(calls.poll(2, TimeUnit.SECONDS)).containsExactly(user, practice);
        prewriter.close();
        assertThat(calls).isEmpty();
    }

    @Test void itAsksTheConversationServiceToWriteTheFirstQuestion() {
        ConversationService conversations = mock(ConversationService.class);
        try (var prewriter = new CoachFirstQuestionPrewriter(conversations)) {
            prewriter.onAnalysisComplete(practice, user);
            verify(conversations, timeout(2000)).prewriteStart(user, practice);
        }
    }
}
