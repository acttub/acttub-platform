package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.util.UUID;

import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Test;

class DirectVideoLimitsTest {
    private final DirectVideoModel model = mock(DirectVideoModel.class);
    private final UUID owner = UUID.randomUUID();
    private final DirectVideoModel.Video video = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");

    private DirectVideoSessions service() {
        when(model.model()).thenReturn("test");
        when(model.upload(any(), anyString())).thenReturn(video);
        when(model.ready(video)).thenReturn(true);
        when(model.reply(any(), anyList(), anyString())).thenReturn("답변");
        return new DirectVideoSessions(model, mock(FailureReporter.class), Clock.systemUTC());
    }

    private UUID start(DirectVideoSessions sessions, UUID user) throws Exception {
        Path path = Files.createTempFile("video-limits-", ".mp4");
        try { return sessions.start(user, path, "video/mp4").id(); }
        catch (RuntimeException failure) { Files.deleteIfExists(path); throw failure; }
    }

    private DirectVideoSessions.View settled(DirectVideoSessions sessions, UUID user, UUID id) throws Exception {
        long deadline = System.nanoTime() + 5_000_000_000L;
        while (System.nanoTime() < deadline) {
            var view = sessions.get(user, id);
            if (view.status().equals("ready") || view.status().equals("finished")) return view;
            Thread.sleep(10);
        }
        throw new AssertionError("reply did not settle");
    }

    @Test void missingOrForeignSessionReturns404AndPreparingSessionReturns409() throws Exception {
        try (var sessions = service()) {
            when(model.ready(video)).thenReturn(false);
            UUID id = start(sessions, owner);
            assertThatThrownBy(() -> sessions.get(owner, UUID.randomUUID()))
                    .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(404))
                    .hasMessage("direct_video_not_found");
            assertThatThrownBy(() -> sessions.get(UUID.randomUUID(), id))
                    .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(404))
                    .hasMessage("direct_video_not_found");
            assertThatThrownBy(() -> sessions.send(owner, id, "답"))
                    .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(409))
                    .hasMessage("direct_video_not_ready");
        }
    }

    @Test void perOwnerAndGlobalCapacityReturn429() throws Exception {
        try (var sessions = service()) {
            settled(sessions, owner, start(sessions, owner));
            settled(sessions, owner, start(sessions, owner));
            assertThatThrownBy(() -> start(sessions, owner))
                    .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(429))
                    .hasMessage("direct_video_session_limit");
            for (int i = 0; i < 10; i++) {
                UUID user = UUID.randomUUID();
                settled(sessions, user, start(sessions, user));
            }
            assertThatThrownBy(() -> start(sessions, UUID.randomUUID()))
                    .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(429))
                    .hasMessage("direct_video_session_limit");
        }
    }

    @Test void tenRepliesFinishAndFurtherMessagesReturnTheTurnLimitWithoutCallingGemini() throws Exception {
        try (var sessions = service()) {
            UUID id = start(sessions, owner);
            settled(sessions, owner, id);
            for (int i = 0; i < 9; i++) {
                sessions.send(owner, id, "답 " + i);
                settled(sessions, owner, id);
            }
            assertThat(sessions.get(owner, id).status()).isEqualTo("finished");
            assertThatThrownBy(() -> sessions.send(owner, id, "더"))
                    .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(409))
                    .hasMessage("direct_video_turn_limit");
            verify(model, times(10)).reply(eq(video), anyList(), anyString());
        }
    }
}
