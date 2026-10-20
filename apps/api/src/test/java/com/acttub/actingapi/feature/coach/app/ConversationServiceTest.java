package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.ConversationRepository.Loaded;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.Saved;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/** practice.coach: 시작·답·재전송·충돌·종료 사유를 저장소와 엔진 사이에서 어떻게 다루는지. */
class ConversationServiceTest {
    final ConversationRepository conversations = mock(ConversationRepository.class);
    final CoachEngine coach = mock(CoachEngine.class);
    final NoteWriter notes = mock(NoteWriter.class);
    final CoachProfile profiles = mock(CoachProfile.class);
    final CoachMemory memory = mock(CoachMemory.class);
    final ConversationClosedListener listener = mock(ConversationClosedListener.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final MutableClock clock = new MutableClock(Instant.parse("2026-10-20T00:00:00Z"));
    final UUID user = UUID.randomUUID();
    final UUID practice = UUID.randomUUID();
    final UUID conversation = UUID.randomUUID();
    final List<String> streamed = new ArrayList<>();
    final CoachStream stream = new CoachStream() {
        @Override public void begin() { streamed.add("begin"); }
        @Override public void delta(String text) { streamed.add(text); }
    };

    ConversationService service(ConversationClosedListener closed) {
        return new ConversationService(conversations, coach, notes, clock, closed, profiles, memory, failures);
    }

    CoachSessionSnapshot session(String status, String version, JsonNode state, String... turns) {
        var list = new ArrayList<CoachTurnSnapshot>();
        for (int i = 0; i < turns.length; i++) list.add(new CoachTurnSnapshot(i % 2 == 0 ? "ai" : "actor", turns[i]));
        return new CoachSessionSnapshot(UUID.randomUUID(), practice, user, null, "", "", "", 8000, "그 외", "그 외", "",
                status, "", list, PriorContext.EMPTY, version, 2, state, null);
    }

    CoachResult result(CoachSessionSnapshot session, String message, String status, ObjectNode handoff) {
        return new CoachResult(session, new CoachReply(message, status, handoff));
    }

    @Test void aStartThatRacedWithAnIdenticalRequestReturnsTheSavedOpening() {
        when(conversations.loadByPractice(user, practice)).thenReturn(new Loaded(practice, null, "conversing", session("open", "legacy", null)));
        when(conversations.open(eq(practice), any(), any())).thenReturn(conversation);
        when(conversations.loadByConversation(user, conversation))
                .thenReturn(new Loaded(practice, conversation, "conversing", session("open", "legacy", null, "먼저 저장된 첫 질문")));
        var turn = service(listener).start(user, practice, UUID.randomUUID());
        assertThat(turn.coachMessage()).isEqualTo("먼저 저장된 첫 질문");
        assertThat(turn.coachReplyCount()).isEqualTo(1);
        verify(coach, never()).start(any(), any());
    }

    @Test void aStreamedStartBeginsTheStreamAndAClosingOpeningWithoutListenerStillWritesTheNote() {
        CoachSessionSnapshot empty = session("open", "legacy", null);
        when(conversations.loadByPractice(user, practice)).thenReturn(new Loaded(practice, null, "conversing", empty));
        when(conversations.open(eq(practice), any(), any())).thenReturn(conversation);
        when(conversations.loadByConversation(user, conversation))
                .thenReturn(new Loaded(practice, conversation, "conversing", empty))
                .thenReturn(new Loaded(practice, conversation, "conversing", session("closed", "legacy", null, "오늘은 여기까지 할게요")));
        ObjectNode handoff = StructuredJson.MAPPER.createObjectNode().put("end_reason", "turn_budget");
        when(coach.start(any(), eq(conversation), eq(stream))).thenReturn(result(empty, "오늘은 여기까지 할게요", "complete", handoff));
        var turn = service(null).start(user, practice, UUID.randomUUID(), stream);
        assertThat(streamed).containsExactly("begin");
        verify(conversations).saveOpening(eq(conversation), eq("오늘은 여기까지 할게요"), any(), eq("limit"), any());
        verify(notes).write(any(), any(), anyLong(), any());
        assertThat(turn.status()).isEqualTo("closed");
    }

    Loaded openConversation(CoachSessionSnapshot session) {
        Loaded loaded = new Loaded(practice, conversation, "conversing", session);
        when(conversations.loadByConversation(user, conversation)).thenReturn(loaded);
        return loaded;
    }

    @Test void aReplySavedAfterAnotherDeviceMovedTheRevisionIsAConflict() {
        CoachSessionSnapshot open = session("open", "legacy", null, "첫 질문");
        openConversation(open);
        when(coach.reply(any(), eq("붙잡고 싶었어"), eq(conversation))).thenReturn(result(open, "그 마음이군요.", "open", null));
        when(conversations.appendTurn(any(), anyLong(), any(), anyString(), anyString(), anyString(), any(), anyString(), any(), any()))
                .thenReturn(null);
        assertThatThrownBy(() -> service(listener).reply(user, conversation, UUID.randomUUID(), "붙잡고 싶었어", 2L))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(409))
                .hasMessage("conversation_conflict");
        verify(notes, never()).write(any(), any(), anyLong(), any());
    }

    @Test void aStreamedClosingReplyFallsBackToTheSessionsCloseReason() {
        CoachSessionSnapshot open = session("open", "legacy", null, "첫 질문");
        openConversation(open);
        CoachSessionSnapshot after = new CoachSessionSnapshot(open.sessionId(), practice, user, null, "", "", "", 8000, "그 외",
                "그 외", "", "closed", "actor_finished", open.turns(), PriorContext.EMPTY, "legacy", 3, null, null);
        when(coach.reply(any(), eq("그만할게"), eq(conversation), eq(stream))).thenReturn(result(after, "고마워요.", "complete", null));
        when(conversations.appendTurn(any(), anyLong(), any(), anyString(), anyString(), anyString(), any(), anyString(), any(), any()))
                .thenReturn(new Saved(3, "closed", "user_ended", 2));
        var turn = service(null).reply(user, conversation, UUID.randomUUID(), "그만할게", null, stream);
        assertThat(streamed).containsExactly("begin");
        verify(conversations).appendTurn(eq(conversation), eq(2L), any(), anyString(), eq("그만할게"), eq("고마워요."), any(),
                eq("closed"), eq("user_ended"), any());
        assertThat(turn.closeReason()).isEqualTo("user_ended");
        assertThat(turn.replyLimit()).isEqualTo(ConversationService.LEGACY_REPLY_LIMIT);
    }

    @Test void unknownOrMissingEndReasonsCountAsExhausted() {
        CoachSessionSnapshot open = session("open", "legacy", null, "첫 질문");
        openConversation(open);
        ObjectNode handoff = StructuredJson.MAPPER.createObjectNode().put("end_reason", "  ");
        when(coach.reply(any(), anyString(), eq(conversation))).thenReturn(result(open, "정리할게요.", "complete", handoff));
        when(conversations.appendTurn(any(), anyLong(), any(), anyString(), anyString(), anyString(), any(), anyString(), any(), any()))
                .thenReturn(new Saved(3, "closed", "exhausted", 2));
        service(listener).reply(user, conversation, UUID.randomUUID(), "정리해줘", 2L);
        verify(conversations).appendTurn(any(), anyLong(), any(), anyString(), anyString(), anyString(), any(), eq("closed"), eq("exhausted"), any());
        verify(listener).onConversationClosed(user, practice);
    }

    @Test void theDisplayedLimitDropsToTheNextReplyOnlyWhileAnOpenLoopIsAboutToClose() {
        ObjectNode closingState = StructuredJson.MAPPER.createObjectNode();
        closingState.putObject(DirectVideoPracticeLoop.STATE_KEY).putArray("statuses").add("다음에 닫기: 예");
        assertThat(ConversationService.displayLimit(session("open", "three_layers_v1", closingState), 5)).isEqualTo(6);
        assertThat(ConversationService.displayLimit(session("closed", "three_layers_v1", closingState), 5))
                .isEqualTo(ConversationService.THREE_LAYERS_REPLY_LIMIT);
        assertThat(ConversationService.displayLimit(session("open", "three_layers_v1", null), 5))
                .isEqualTo(ConversationService.THREE_LAYERS_REPLY_LIMIT);
        ObjectNode noStatuses = StructuredJson.MAPPER.createObjectNode();
        noStatuses.putObject(DirectVideoPracticeLoop.STATE_KEY).putArray("statuses");
        assertThat(ConversationService.displayLimit(session("open", "three_layers_v1", noStatuses), 5))
                .isEqualTo(ConversationService.THREE_LAYERS_REPLY_LIMIT);
        ObjectNode continuing = StructuredJson.MAPPER.createObjectNode();
        continuing.putObject(DirectVideoPracticeLoop.STATE_KEY).putArray("statuses").add("다음에 닫기: 아니오");
        assertThat(ConversationService.displayLimit(session("open", "three_layers_v1", continuing), 5))
                .isEqualTo(ConversationService.THREE_LAYERS_REPLY_LIMIT);
    }

    @Test void readingAMissingConversationOrNoteIsNotFound() {
        assertThatThrownBy(() -> service(listener).conversation(user, conversation)).hasMessage("conversation_not_found");
        assertThatThrownBy(() -> service(listener).note(user, practice)).hasMessage("note_not_found");
        assertThatThrownBy(() -> service(listener).start(user, practice, UUID.randomUUID())).hasMessage("practice_not_found");
    }
}
