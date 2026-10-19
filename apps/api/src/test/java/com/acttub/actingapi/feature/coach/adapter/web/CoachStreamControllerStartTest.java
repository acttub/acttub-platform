package com.acttub.actingapi.feature.coach.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.CoachStream;
import com.acttub.actingapi.feature.coach.app.ConversationService;
import com.acttub.actingapi.platform.schema.UserStatus;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.WriteListener;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** 첫 코치 말 스트리밍과, 스트림을 연 뒤의 예기치 못한 실패·끊긴 연결. */
class CoachStreamControllerStartTest {
    final ConversationService service = mock(ConversationService.class);
    final AccessGate auth = mock(AccessGate.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final CoachStreamController controller = new CoachStreamController(service, auth, new ObjectMapper(), failures);
    final MockHttpServletRequest request = new MockHttpServletRequest();
    final MockHttpServletResponse response = new MockHttpServletResponse();
    final UUID user = UUID.randomUUID();
    final UUID practice = UUID.randomUUID();
    final UUID requestId = UUID.randomUUID();
    final UUID conversation = UUID.randomUUID();

    CoachStreamControllerStartTest() {
        when(auth.gatedUser(request)).thenReturn(new AuthenticatedUser(user, "a@b.c", UserStatus.ACTIVE, false));
    }

    ConversationService.Turn turn(String message) {
        return new ConversationService.Turn(conversation, "open", null, 1, message, 1, 24, List.of(), null);
    }

    @Test void theOpeningStreamsItsWordsAndEndsWithTheSavedTurn() throws Exception {
        when(service.start(eq(user), eq(practice), eq(requestId), any())).thenAnswer(call -> {
            CoachStream stream = call.getArgument(3);
            stream.begin();
            stream.delta("");
            stream.delta(null);
            stream.delta("무엇을 바랐어요?");
            return turn("무엇을 바랐어요?");
        });
        controller.start(new ConversationDtos.StartRequest(practice, requestId), request, response);
        String sent = response.getContentAsString(StandardCharsets.UTF_8);
        assertThat(sent).startsWith(": open\n\nevent: delta\ndata: {\"text\":\"무엇을 바랐어요?\"}\n\nevent: done\ndata: ");
        assertThat(sent.split("event: delta", -1)).hasSize(2);
    }

    @Test void anUnexpectedFailureBeforeTheStreamOpensIsAnOrdinaryError() {
        when(service.start(any(), any(), any(), any())).thenThrow(new IllegalStateException("db down"));
        assertThatThrownBy(() -> controller.start(new ConversationDtos.StartRequest(practice, requestId), request, response))
                .isInstanceOf(IllegalStateException.class).hasMessage("db down");
        assertThat(failures.reports()).isEmpty();
    }

    @Test void anUnexpectedFailureAfterTheStreamOpensBecomesA500ErrorEvent() throws Exception {
        when(service.start(any(), any(), any(), any())).thenAnswer(call -> {
            ((CoachStream) call.getArgument(3)).begin();
            throw new IllegalStateException("bug");
        });
        controller.start(new ConversationDtos.StartRequest(practice, requestId), request, response);
        assertThat(response.getContentAsString(StandardCharsets.UTF_8))
                .endsWith("event: error\ndata: {\"status\":500,\"detail\":\"internal_server_error\"}\n\n");
        assertThat(failures.contexts()).containsExactly("CoachStreamController");
    }

    @Test void aDisconnectedActorStillGetsTheTurnSaved() throws Exception {
        MockHttpServletResponse closed = new MockHttpServletResponse() {
            @Override public ServletOutputStream getOutputStream() {
                return new ServletOutputStream() {
                    @Override public boolean isReady() { return true; }
                    @Override public void setWriteListener(WriteListener listener) { }
                    @Override public void write(int b) throws IOException { throw new IOException("client gone"); }
                };
            }
        };
        when(service.start(any(), any(), any(), any())).thenAnswer(call -> {
            CoachStream stream = call.getArgument(3);
            stream.begin();
            stream.delta("무엇을 바랐어요?");
            return turn("무엇을 바랐어요?");
        });
        controller.start(new ConversationDtos.StartRequest(practice, requestId), request, closed);
        assertThat(closed.getStatus()).isEqualTo(200);
        assertThat(failures.reports()).isEmpty();

        var unavailable = new jakarta.servlet.http.HttpServletResponseWrapper(new MockHttpServletResponse()) {
            @Override public ServletOutputStream getOutputStream() throws IOException { throw new IOException("closed"); }
        };
        controller.start(new ConversationDtos.StartRequest(practice, requestId), request, unavailable);
        assertThat(failures.reports()).isEmpty();
    }
}
