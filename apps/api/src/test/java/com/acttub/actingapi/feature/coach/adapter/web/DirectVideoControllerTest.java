package com.acttub.actingapi.feature.coach.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.DirectVideoSessions;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockMultipartFile;

class DirectVideoControllerTest {
    private final DirectVideoSessions sessions = mock(DirectVideoSessions.class);
    private final AccessGate auth = mock(AccessGate.class);
    private final DirectVideoController controller = new DirectVideoController(sessions, auth);
    private final MockHttpServletRequest request = new MockHttpServletRequest();
    private final UUID owner = UUID.randomUUID();

    private void authorize() {
        var user = mock(AuthenticatedUser.class);
        when(user.id()).thenReturn(owner);
        when(auth.gatedUser(request)).thenReturn(user);
    }

    @Test void authAndConsentFailureCannotStartOrReadOrSendOrDelete() {
        when(auth.gatedUser(request)).thenThrow(new ApiException(403, "consent_required"));
        var file = new MockMultipartFile("video", "take.mp4", "video/mp4", new byte[]{1});
        UUID id = UUID.randomUUID();
        assertThatThrownBy(() -> controller.start(file, request)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> controller.get(id, request)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> controller.send(id, new DirectVideoController.Send("답"), request)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> controller.delete(id, request)).isInstanceOf(ApiException.class);
        verifyNoInteractions(sessions);
    }

    @Test void uploadPassesOriginalBytesAndAuthenticatedOwner() throws Exception {
        authorize();
        var expected = new DirectVideoSessions.View(UUID.randomUUID(), "preparing", "gemini-3-flash-preview", List.of(), null, Instant.now());
        when(sessions.start(eq(owner), any(), eq("video/mp4"))).thenReturn(expected);
        var file = new MockMultipartFile("video", "take.mp4", "video/mp4", new byte[]{1, 2, 3});
        assertThat(controller.start(file, request)).isEqualTo(expected);
        var path = ArgumentCaptor.forClass(Path.class);
        verify(sessions).start(eq(owner), path.capture(), eq("video/mp4"));
        try { assertThat(Files.readAllBytes(path.getValue())).containsExactly(1, 2, 3); }
        finally { Files.deleteIfExists(path.getValue()); }
    }

    @Test void rejectedSessionRemovesTheTemporaryUpload() {
        authorize();
        when(sessions.start(eq(owner), any(), eq("video/mp4"))).thenThrow(new ApiException(429, "direct_video_session_limit"));
        var file = new MockMultipartFile("video", "take.mp4", "video/mp4", new byte[]{1});
        assertThatThrownBy(() -> controller.start(file, request)).isInstanceOf(ApiException.class);
        var path = ArgumentCaptor.forClass(Path.class);
        verify(sessions).start(eq(owner), path.capture(), eq("video/mp4"));
        assertThat(path.getValue()).doesNotExist();
    }

    @Test void emptyAndUnsupportedFilesNeverStartASession() {
        authorize();
        assertThatThrownBy(() -> controller.start(new MockMultipartFile("video", "take.mp4", "video/mp4", new byte[0]), request))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(422)).hasMessage("empty_video");
        assertThatThrownBy(() -> controller.start(new MockMultipartFile("video", "take.txt", "text/plain", new byte[]{1}), request))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(415)).hasMessage("unsupported_media_type");
        verifyNoInteractions(sessions);
    }

    @Test void oversizedFileIsRejectedBeforeCopying() {
        authorize();
        var oversized = new MockMultipartFile("video", "take.mp4", "video/mp4", new byte[]{1}) {
            @Override public long getSize() { return 50L * 1024 * 1024 + 1; }
        };
        assertThatThrownBy(() -> controller.start(oversized, request))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(413))
                .hasMessage("upload_too_large");
        verifyNoInteractions(sessions);
    }
}
