package com.acttub.actingapi.feature.coach.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.feature.coach.app.CoachStream;
import com.acttub.actingapi.feature.coach.app.ConversationService;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.schema.UserStatus;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.web.ApiException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class CoachStreamControllerTest {
    private final ConversationService service = mock(ConversationService.class);
    private final AccessGate auth = mock(AccessGate.class);
    private final FailureReporter failures = mock(FailureReporter.class);
    private final CoachStreamController controller = new CoachStreamController(service, auth, new ObjectMapper(), failures);
    private final MockHttpServletRequest request = new MockHttpServletRequest();
    private final MockHttpServletResponse response = new MockHttpServletResponse();
    private final UUID user = UUID.randomUUID();
    private final UUID conversation = UUID.randomUUID();
    private final UUID requestId = UUID.randomUUID();

    private ConversationDtos.ReplyRequest body() {
        return new ConversationDtos.ReplyRequest(conversation, requestId, "붙잡고 싶었어요", 3L);
    }

    private String sent() throws Exception {
        return response.getContentAsString(StandardCharsets.UTF_8);
    }

    @Test void sendsDeltasThenTheSavedTurn() throws Exception {
        when(auth.gatedUser(request)).thenReturn(new AuthenticatedUser(user, "a@b.c", UserStatus.ACTIVE, false));
        when(service.reply(eq(user), eq(conversation), eq(requestId), eq("붙잡고 싶었어요"), eq(3L), any())).thenAnswer(call -> {
            CoachStream stream = call.getArgument(5);
            stream.begin();
            stream.delta("그때 ");
            stream.delta("속으로는\n어땠어요?");
            return new ConversationService.Turn(conversation, "open", null, 4, "그때 속으로는\n어땠어요?", 2, 24, List.of(), null);
        });
        controller.reply(body(), request, response);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentType()).startsWith("text/event-stream");
        assertThat(response.getHeader("Cache-Control")).contains("no-transform");
        String text = sent();
        assertThat(text).contains("event: delta\ndata: {\"text\":\"그때 \"}\n\n",
                "event: delta\ndata: {\"text\":\"속으로는\\n어땠어요?\"}\n\n");
        int done = text.indexOf("event: done\ndata: ");
        assertThat(done).isGreaterThan(text.indexOf("event: delta"));
        String doneJson = text.substring(done + "event: done\ndata: ".length()).strip();
        assertThat(new ObjectMapper().readTree(doneJson).path("message").asText()).isEqualTo("그때 속으로는\n어땠어요?");
    }

    @Test void rejectionsBeforeTheModelCallStayOrdinaryHttpErrors() {
        when(auth.gatedUser(request)).thenReturn(new AuthenticatedUser(user, "a@b.c", UserStatus.ACTIVE, false));
        when(service.reply(any(), any(), any(), any(), any(), any())).thenThrow(new ApiException(409, "conversation_conflict"));
        assertThatThrownBy(() -> controller.reply(body(), request, response))
                .isInstanceOf(ApiException.class).hasMessage("conversation_conflict");
        assertThat(response.isCommitted()).isFalse();
    }

    @Test void failuresAfterTheStreamOpenedArriveAsAnErrorEvent() throws Exception {
        when(auth.gatedUser(request)).thenReturn(new AuthenticatedUser(user, "a@b.c", UserStatus.ACTIVE, false));
        when(service.reply(any(), any(), any(), any(), any(), any())).thenAnswer(call -> {
            ((CoachStream) call.getArgument(5)).begin();
            throw ApiException.external(502, "coach_response_unavailable", new IllegalStateException("empty"));
        });
        controller.reply(body(), request, response);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(sent()).contains("event: error\ndata: {\"status\":502,\"detail\":\"coach_response_unavailable\"}\n\n")
                .doesNotContain("event: done");
        verify(failures).report(any(IllegalStateException.class), any(), any());
    }
}
