package com.acttub.actingapi.feature.coach.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.DirectVideoSessions;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockMultipartFile;

/** 영상 직접 실험: 읽기·답 보내기·지우기는 게이트를 지난 그 사람의 세션에만 닿고, 형식이 없는 파일은 받지 않는다. */
class DirectVideoControllerOwnerTest {
    final DirectVideoSessions sessions = mock(DirectVideoSessions.class);
    final AccessGate auth = mock(AccessGate.class);
    final DirectVideoController controller = new DirectVideoController(sessions, auth);
    final MockHttpServletRequest request = new MockHttpServletRequest();
    final UUID owner = UUID.randomUUID();
    final UUID id = UUID.randomUUID();

    DirectVideoControllerOwnerTest() {
        var user = mock(AuthenticatedUser.class);
        when(user.id()).thenReturn(owner);
        when(auth.gatedUser(request)).thenReturn(user);
    }

    @Test void readSendAndDeleteActForTheGatedOwner() {
        var view = new DirectVideoSessions.View(id, "ready", "gemini-3-flash-preview", List.of(), null, Instant.parse("2026-10-20T00:30:00Z"));
        when(sessions.get(owner, id)).thenReturn(view);
        when(sessions.send(owner, id, "붙잡고 싶었어")).thenReturn(view);
        assertThat(controller.get(id, request)).isEqualTo(view);
        assertThat(controller.send(id, new DirectVideoController.Send("붙잡고 싶었어"), request)).isEqualTo(view);
        controller.delete(id, request);
        verify(sessions).delete(owner, id);
    }

    @Test void aFileWithoutAContentTypeIsUnsupported() {
        assertThatThrownBy(() -> controller.start(new MockMultipartFile("video", "take", null, new byte[]{1}), request))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(415))
                .hasMessage("unsupported_media_type");
    }
}
