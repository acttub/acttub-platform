package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

/** 영상 직접 실험 세션: 지우기·만료·원격 정리 실패와, 두 번째 답이 실패해도 앞 대화는 남는 것. */
class DirectVideoSessionsLifecycleTest {
    final UUID owner = UUID.randomUUID();
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final MutableClock clock = new MutableClock(Instant.parse("2026-10-20T00:00:00Z"));
    final DirectVideoModel.Video video = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");

    DirectVideoSessions sessions() {
        when(model.model()).thenReturn("test-gemini");
        when(model.upload(any(), anyString())).thenReturn(video);
        when(model.ready(video)).thenReturn(true);
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"intention\"]}");
        return new DirectVideoSessions(model, failures, clock);
    }

    UUID start(DirectVideoSessions sessions) throws Exception {
        return sessions.start(owner, Files.createTempFile("direct-video-test-", ".mp4"), "video/mp4").id();
    }

    DirectVideoSessions.View settled(DirectVideoSessions sessions, UUID id) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (System.nanoTime() < deadline) {
            var view = sessions.get(owner, id);
            if (List.of("ready", "failed", "finished").contains(view.status())) return view;
            Thread.sleep(10);
        }
        throw new AssertionError("session did not settle");
    }

    void notFound(DirectVideoSessions sessions, UUID id) {
        assertThatThrownBy(() -> sessions.get(owner, id))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(404))
                .hasMessage("direct_video_not_found");
    }

    @Test void deletingASessionHidesItAndRemovesTheUploadedVideo() throws Exception {
        try (var sessions = sessions()) {
            when(model.reply(any(), anyList(), anyString())).thenReturn("왜 이 말을 건네나요?");
            UUID id = start(sessions);
            settled(sessions, id);
            sessions.delete(owner, id);
            notFound(sessions, id);
            verify(model, timeout(3000)).delete(video);
        }
    }

    @Test void anExpiredSessionIsGoneAndSweptAndARemoteCleanupFailureIsReported() throws Exception {
        try (var sessions = sessions()) {
            when(model.reply(any(), anyList(), anyString())).thenReturn("왜 이 말을 건네나요?");
            doThrow(new IllegalStateException("gemini 500")).when(model).delete(video);
            UUID id = start(sessions);
            settled(sessions, id);
            clock.set(clock.instant().plus(Duration.ofMinutes(31)));
            notFound(sessions, id);
            sessions.expire();
            verify(model, timeout(3000)).delete(video);
            long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
            while (failures.reports().isEmpty() && System.nanoTime() < deadline) Thread.sleep(10);
            assertThat(failures.contexts()).singleElement().asString().startsWith("DirectVideoSessions.remoteCleanup");
        }
    }

    @Test void aFailedLaterReplyKeepsTheConversationReadyWithAnError() throws Exception {
        try (var sessions = sessions()) {
            when(model.reply(any(), anyList(), anyString())).thenReturn("왜 이 말을 건네나요?").thenReturn("");
            UUID id = start(sessions);
            settled(sessions, id);
            sessions.send(owner, id, "안심시키려 했어요.");
            long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
            DirectVideoSessions.View view = sessions.get(owner, id);
            while (view.error() == null && System.nanoTime() < deadline) {
                Thread.sleep(10);
                view = sessions.get(owner, id);
            }
            assertThat(view.status()).isEqualTo("ready");
            assertThat(view.error()).isEqualTo("direct_video_generation_failed");
            assertThat(view.messages()).extracting(DirectVideoModel.Message::text).containsExactly("왜 이 말을 건네나요?");
            assertThat(failures.contexts()).singleElement().asString().startsWith("DirectVideoSessions.generate");
        }
    }
}
