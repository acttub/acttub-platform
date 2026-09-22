package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class DirectVideoSessionsTest {
    private final UUID owner = UUID.randomUUID();
    private final DirectVideoModel model = mock(DirectVideoModel.class);
    private final FailureReporter failures = mock(FailureReporter.class);
    private final DirectVideoModel.Video video = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");

    private DirectVideoSessions service(Clock clock) {
        when(model.model()).thenReturn("test-gemini");
        when(model.upload(any(), anyString())).thenReturn(video);
        when(model.ready(video)).thenReturn(true);
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"intention\"]}");
        return new DirectVideoSessions(model, failures, clock);
    }

    private UUID start(DirectVideoSessions sessions) throws Exception {
        Path path = Files.createTempFile("direct-video-test-", ".mp4");
        return sessions.start(owner, path, "video/mp4").id();
    }

    private DirectVideoSessions.View settled(DirectVideoSessions sessions, UUID id) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
        while (System.nanoTime() < deadline) {
            var view = sessions.get(owner, id);
            if (java.util.List.of("ready", "failed", "finished").contains(view.status())) return view;
            Thread.sleep(10);
        }
        throw new AssertionError("experiment did not settle");
    }

    @Test
    void carriesTheSameVideoAndFullConversationWithoutAnAnalysisRecord() throws Exception {
        try (var sessions = service(Clock.systemUTC())) {
            when(model.reply(any(), anyList(), anyString()))
                    .thenReturn("왜 이 말을 건네나요?", "상대를 안심시키려는 말이군요.");
            UUID id = start(sessions);
            assertThat(settled(sessions, id).messages()).hasSize(1);
            sessions.send(owner, id, "안심시키려 했어요.");
            var result = settled(sessions, id);
            assertThat(result.messages()).extracting(DirectVideoModel.Message::text)
                    .containsExactly("왜 이 말을 건네나요?", "안심시키려 했어요.", "상대를 안심시키려는 말이군요.");
            var history = ArgumentCaptor.forClass(java.util.List.class);
            verify(model, times(2)).reply(eq(video), history.capture(), anyString());
            verify(model).reply(eq(video), anyList(), eq(DirectVideoPrompts.forRoutes(java.util.List.of(DirectVideoRoute.OPENING))));
            verify(model).reply(eq(video), anyList(), eq(DirectVideoPrompts.forRoutes(java.util.List.of(DirectVideoRoute.INTENTION))));
            assertThat(history.getAllValues().get(0)).isEmpty();
            assertThat(history.getAllValues().get(1)).hasSize(2);
            verify(model, times(1)).upload(any(), eq("video/mp4"));
            verify(model).classify(anyList(), eq(DirectVideoPrompts.classifier()), eq(DirectVideoRouting.CATEGORIES));
        }
    }

    @Test
    void rejectsOtherOwnersAndConcurrentMessages() throws Exception {
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (var sessions = service(Clock.systemUTC())) {
            when(model.reply(any(), anyList(), anyString())).thenAnswer(call -> {
                entered.countDown(); release.await(2, TimeUnit.SECONDS); return "질문입니다.";
            });
            UUID id = start(sessions);
            assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> sessions.get(UUID.randomUUID(), id)).isInstanceOf(ApiException.class)
                    .hasMessage("direct_video_not_found");
            assertThatThrownBy(() -> sessions.send(owner, id, "답변")).isInstanceOf(ApiException.class)
                    .hasMessage("direct_video_not_ready");
            release.countDown();
            settled(sessions, id);
        } finally { release.countDown(); }
    }

    @Test
    void failedReplyDoesNotCommitUnansweredUserMessageAndCanRetry() throws Exception {
        try (var sessions = service(Clock.systemUTC())) {
            when(model.reply(any(), anyList(), anyString())).thenReturn("첫 질문")
                    .thenThrow(new IllegalStateException("unavailable"))
                    .thenReturn("정정한 내용을 반영했어요.");
            UUID id = start(sessions);
            settled(sessions, id);
            sessions.send(owner, id, "그런 뜻이 아니에요.");
            var failed = settled(sessions, id);
            assertThat(failed.messages()).hasSize(1);
            assertThat(failed.error()).isEqualTo("direct_video_generation_failed");
            sessions.send(owner, id, "그런 뜻이 아니에요.");
            assertThat(settled(sessions, id).messages()).hasSize(3);
        }
    }

    @Test
    void rejectsExpiredSessionsAndDeletesTheGeminiFile() throws Exception {
        Clock clock = mock(Clock.class);
        Instant start = Instant.parse("2026-09-21T00:00:00Z");
        when(clock.instant()).thenReturn(start);
        try (var sessions = service(clock)) {
            when(model.reply(any(), anyList(), anyString())).thenReturn("첫 질문");
            UUID id = start(sessions);
            settled(sessions, id);
            when(clock.instant()).thenReturn(start.plus(Duration.ofMinutes(31)));
            assertThatThrownBy(() -> sessions.get(owner, id)).hasMessage("direct_video_not_found");
            sessions.expire();
            verify(model, timeout(2000)).delete(video);
        }
    }

    @Test
    void explicitFinishUsesClosingPromptAndStopsTheDisposableSession() throws Exception {
        try (var sessions = service(Clock.systemUTC())) {
            when(model.reply(any(), anyList(), anyString())).thenReturn("답변입니다.");
            UUID id = start(sessions);
            settled(sessions, id);
            sessions.send(owner, id, "그만");
            assertThat(settled(sessions, id).status()).isEqualTo("finished");
            assertThatThrownBy(() -> sessions.send(owner, id, "조금 더 이야기해볼게요"))
                    .hasMessage("direct_video_not_ready");
            verify(model, never()).classify(anyList(), anyString(), anyList());
            verify(model).reply(eq(video), anyList(), eq(DirectVideoPrompts.forRoutes(java.util.List.of(DirectVideoRoute.CLOSING))));
        }
    }
}
