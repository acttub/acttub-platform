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

    @Test void anAnswerWithCharactersOutsideTheAllowedRangeIsRejected() {
        // 10/27 운영: 글자마다 결합 기호를 쌓은 글. 저장도, 코치 호출도 하지 않는다.
        assertThatThrownBy(() -> service(listener).reply(user, conversation, UUID.randomUUID(), "Z\u0325\u031c\u0318algo", 2L))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(400))
                .hasMessage("unreadable_text");
    }

    @Test void readingAMissingConversationOrNoteIsNotFound() {
        assertThatThrownBy(() -> service(listener).conversation(user, conversation)).hasMessage("conversation_not_found");
        assertThatThrownBy(() -> service(listener).note(user, practice)).hasMessage("note_not_found");
        assertThatThrownBy(() -> service(listener).start(user, practice, UUID.randomUUID())).hasMessage("practice_not_found");
    }

    // --- SOMA-780: 첫 질문 미리 쓰기 ---

    @Test void thePrewriteOpensTheConversationAndTheAppsStartReceivesTheSavedQuestion() {
        CoachSessionSnapshot empty = session("open", "legacy", null);
        CoachSessionSnapshot saved = session("open", "legacy", null, "미리 쓴 첫 질문");
        when(conversations.loadByPractice(user, practice))
                .thenReturn(new Loaded(practice, null, "conversing", empty))
                .thenReturn(new Loaded(practice, null, "conversing", empty))
                .thenReturn(new Loaded(practice, conversation, "conversing", saved));
        when(conversations.open(eq(practice), eq(ConversationService.prewriteRequest(practice)), any())).thenReturn(conversation);
        when(conversations.loadByConversation(user, conversation))
                .thenReturn(new Loaded(practice, conversation, "conversing", empty))
                .thenReturn(new Loaded(practice, conversation, "conversing", saved));
        when(coach.start(any(), eq(conversation))).thenReturn(result(empty, "미리 쓴 첫 질문", "open", null));
        var service = service(listener);

        service.prewriteStart(user, practice);
        var turn = service.start(user, practice, UUID.randomUUID(), stream);

        assertThat(turn.coachMessage()).isEqualTo("미리 쓴 첫 질문");
        verify(coach, org.mockito.Mockito.times(1)).start(any(), eq(conversation));
        verify(conversations).saveOpening(eq(conversation), eq("미리 쓴 첫 질문"), any(), org.mockito.ArgumentMatchers.isNull(), any());
        assertThat(streamed).as("저장된 첫 질문은 조각 없이 끝에 한 번에 간다").isEmpty();
        assertThat(ConversationService.prewriteRequest(practice)).isEqualTo(ConversationService.prewriteRequest(practice));
    }

    @Test void anAppStartWhileThePrewriteIsWritingWaitsForItInsteadOfWritingAgain() throws Exception {
        CoachSessionSnapshot empty = session("open", "legacy", null);
        CoachSessionSnapshot saved = session("open", "legacy", null, "미리 쓴 첫 질문");
        var writing = new java.util.concurrent.CountDownLatch(1);
        var release = new java.util.concurrent.CountDownLatch(1);
        var savedYet = new java.util.concurrent.atomic.AtomicBoolean(false);
        when(conversations.loadByPractice(user, practice)).thenAnswer(call -> savedYet.get()
                ? new Loaded(practice, conversation, "conversing", saved) : new Loaded(practice, null, "conversing", empty));
        when(conversations.open(eq(practice), any(), any())).thenReturn(conversation);
        when(conversations.loadByConversation(user, conversation)).thenAnswer(call -> savedYet.get()
                ? new Loaded(practice, conversation, "conversing", saved) : new Loaded(practice, conversation, "conversing", empty));
        when(coach.start(any(), eq(conversation))).thenAnswer(call -> {
            writing.countDown();
            assertThat(release.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            return result(empty, "미리 쓴 첫 질문", "open", null);
        });
        org.mockito.Mockito.doAnswer(call -> {
            savedYet.set(true);
            return null;
        }).when(conversations).saveOpening(any(), any(), any(), any(), any());
        var service = service(listener);

        var prewrite = java.util.concurrent.CompletableFuture.runAsync(() -> service.prewriteStart(user, practice));
        assertThat(writing.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        var app = java.util.concurrent.CompletableFuture.supplyAsync(() -> service.start(user, practice, UUID.randomUUID(), stream));
        Thread.sleep(200);
        assertThat(app).as("앱의 시작은 미리 쓰기가 끝나길 기다린다").isNotDone();
        release.countDown();

        assertThat(app.get(5, java.util.concurrent.TimeUnit.SECONDS).coachMessage()).isEqualTo("미리 쓴 첫 질문");
        prewrite.get(5, java.util.concurrent.TimeUnit.SECONDS);
        verify(coach, org.mockito.Mockito.times(1)).start(any(), eq(conversation));
        assertThat(streamed).as("기다리는 동안 연결을 먼저 연다").containsExactly("begin");
    }

    @Test void anAppStartStopsWaitingForAStuckPrewriteAndWritesItself() throws Exception {
        CoachSessionSnapshot empty = session("open", "legacy", null);
        var release = new java.util.concurrent.CountDownLatch(1);
        var writing = new java.util.concurrent.CountDownLatch(1);
        when(conversations.loadByPractice(user, practice))
                .thenReturn(new Loaded(practice, null, "conversing", empty))
                .thenReturn(new Loaded(practice, null, "conversing", empty))
                .thenReturn(new Loaded(practice, conversation, "conversing", empty));
        when(conversations.open(eq(practice), any(), any())).thenReturn(conversation);
        when(conversations.loadByConversation(user, conversation)).thenReturn(new Loaded(practice, conversation, "conversing", empty));
        when(coach.start(any(), eq(conversation)))
                .thenAnswer(call -> {
                    writing.countDown();
                    release.await(5, java.util.concurrent.TimeUnit.SECONDS);
                    throw new CoachReplyUnavailable();
                })
                .thenReturn(result(empty, "앱이 쓴 첫 질문", "open", null));
        var service = service(listener).withStartWait(java.time.Duration.ofMillis(100));

        var prewrite = java.util.concurrent.CompletableFuture.runAsync(() -> service.prewriteStart(user, practice));
        assertThat(writing.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        service.start(user, practice, UUID.randomUUID());
        release.countDown();
        prewrite.get(5, java.util.concurrent.TimeUnit.SECONDS);

        verify(conversations).saveOpening(eq(conversation), eq("앱이 쓴 첫 질문"), any(), any(), any());
        assertThat(failures.reports()).as("코치 쪽이 이미 기록한 실패는 다시 기록하지 않는다").isEmpty();
    }

    @Test void anAppStartWritesTheFirstQuestionIntoAnEmptyConversationLeftByAFailedPrewrite() {
        CoachSessionSnapshot empty = session("open", "legacy", null);
        when(conversations.loadByPractice(user, practice)).thenReturn(new Loaded(practice, conversation, "conversing", empty));
        when(conversations.open(eq(practice), any(), any())).thenReturn(conversation);
        when(conversations.loadByConversation(user, conversation))
                .thenReturn(new Loaded(practice, conversation, "conversing", empty))
                .thenReturn(new Loaded(practice, conversation, "conversing", session("open", "legacy", null, "새로 쓴 첫 질문")));
        when(coach.start(any(), eq(conversation), eq(stream))).thenReturn(result(empty, "새로 쓴 첫 질문", "open", null));

        var turn = service(listener).start(user, practice, UUID.randomUUID(), stream);

        assertThat(turn.coachMessage()).isEqualTo("새로 쓴 첫 질문");
        verify(coach, org.mockito.Mockito.times(1)).start(any(), eq(conversation), eq(stream));
        verify(conversations).saveOpening(eq(conversation), eq("새로 쓴 첫 질문"), any(), any(), any());
    }

    @Test void anAppStartOnAClosedConversationIsRefusedAndNeverWritesAgain() {
        CoachSessionSnapshot closed = session("closed", "legacy", null, "첫 질문");
        when(conversations.loadByPractice(user, practice)).thenReturn(new Loaded(practice, conversation, "closed", closed));
        assertThatThrownBy(() -> service(listener).start(user, practice, UUID.randomUUID()))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(409));
        verify(coach, never()).start(any(), any());
    }

    @Test void thePrewriteDoesNothingWhenTheAppAlreadyStartedOrAnalysisIsNotDone() {
        var service = service(listener);
        when(conversations.loadByPractice(user, practice))
                .thenReturn(new Loaded(practice, conversation, "conversing", session("open", "legacy", null)))
                .thenReturn(new Loaded(practice, null, "analyzing", session("open", "legacy", null)))
                .thenReturn(null);
        service.prewriteStart(user, practice);
        service.prewriteStart(user, practice);
        service.prewriteStart(user, practice);
        service.prewriteStart(null, practice);
        service.prewriteStart(user, null);
        verify(conversations, never()).open(any(), any(), any());
        verify(coach, never()).start(any(), any());
    }

    @Test void anUnexpectedPrewriteErrorIsReportedAndLeftToTheApp() {
        when(conversations.loadByPractice(user, practice)).thenThrow(new IllegalStateException("db down"));
        service(listener).prewriteStart(user, practice);
        assertThat(failures.reports()).singleElement()
                .satisfies(report -> assertThat(report.context()).isEqualTo("ConversationService.prewriteStart"));
    }

    // SOMA-782 대화 이어하기: 닫힌 대화를 같은 대화로 다시 연다.
    private void closedConversation(String version, ObjectNode state, String... turns) {
        CoachSessionSnapshot closed = session("closed", version, state, turns);
        when(conversations.loadByConversation(user, conversation)).thenReturn(new Loaded(practice, conversation, "closed", closed));
    }

    private static ObjectNode loopState(String... statuses) {
        ObjectNode state = StructuredJson.MAPPER.createObjectNode().put("revision", 2);
        var array = state.putObject("practice_loop").putArray("statuses");
        for (String status : statuses) array.add(status);
        return state;
    }

    @Test void resumingAClosedConversationReopensTheSameOneAndMarksWhereItWasResumed() {
        closedConversation("three_layers_v1", loopState("비추기", "답하기", "끝"), "첫", "답", "둘째", "답2", "정리");
        when(conversations.reopen(eq(conversation), eq(2L), any(), any())).thenReturn(new Saved(3, "open", null, 3));
        var turn = service(listener).resume(user, conversation, 2L);
        var captured = org.mockito.ArgumentCaptor.forClass(JsonNode.class);
        verify(conversations).reopen(eq(conversation), eq(2L), captured.capture(), any());
        assertThat(captured.getValue().path("revision").asLong()).isEqualTo(3);
        assertThat(captured.getValue().path("practice_loop").path("resumed_at").asInt()).isEqualTo(3);
        assertThat(captured.getValue().path("practice_loop").path("statuses")).hasSize(3);
        verify(conversations, never()).open(any(), any(), any());
        verify(listener, never()).onConversationClosed(any(), any());
        assertThat(turn.conversationId()).isEqualTo(conversation);
    }

    @Test void resumingAnOpenConversationJustReturnsIt() {
        openConversation(session("open", "three_layers_v1", loopState("비추기"), "첫 질문"));
        var turn = service(listener).resume(user, conversation, null);
        assertThat(turn.status()).isEqualTo("open");
        verify(conversations, never()).reopen(any(), anyLong(), any(), any());
    }

    @Test void resumingRefusesStaleRevisionLegacyAndNearlyFullConversations() {
        closedConversation("three_layers_v1", loopState("비추기"), "첫", "답", "정리");
        assertThatThrownBy(() -> service(listener).resume(user, conversation, 1L))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(409))
                .hasMessage("conversation_conflict");
        closedConversation("legacy", null, "첫", "답", "정리");
        assertThatThrownBy(() -> service(listener).resume(user, conversation, null)).hasMessage("conversation_not_resumable");
        String[] many = new String[ConversationService.THREE_LAYERS_REPLY_LIMIT * 2];
        java.util.Arrays.fill(many, "말");
        closedConversation("three_layers_v1", loopState("비추기"), many);
        assertThatThrownBy(() -> service(listener).resume(user, conversation, null)).hasMessage("conversation_limit_reached");
        verify(conversations, never()).reopen(any(), anyLong(), any(), any());
    }

    @Test void aReopenThatLostTheRaceIsAConflict() {
        closedConversation("three_layers_v1", loopState("비추기"), "첫", "답", "정리");
        when(conversations.reopen(any(), anyLong(), any(), any())).thenReturn(null);
        assertThatThrownBy(() -> service(listener).resume(user, conversation, null)).hasMessage("conversation_conflict");
    }

    @Test void aResumedConversationThatClosesAgainRefreshesTheNoteAndDoesNotScheduleMemoryAgain() {
        ObjectNode state = loopState("비추기", "답하기", "끝");
        ((ObjectNode) state.get("practice_loop")).put("resumed_at", 3);
        CoachSessionSnapshot open = session("open", "three_layers_v1", state, "첫", "답", "정리");
        openConversation(open);
        when(coach.reply(any(), eq("그만할게"), eq(conversation))).thenReturn(result(open, "여기까지.", "complete", null));
        when(conversations.appendTurn(any(), anyLong(), any(), anyString(), anyString(), anyString(), any(), anyString(), any(), any()))
                .thenReturn(new Saved(4, "closed", "user_ended", 4));
        when(conversations.note(user, practice)).thenReturn(null);
        service(listener).reply(user, conversation, UUID.randomUUID(), "그만할게", 2L);
        verify(notes).write(any(), any(), anyLong(), any(), eq(true));
        verify(notes, never()).write(any(), any(), anyLong(), any());
        verify(listener, never()).onConversationClosed(any(), any());
    }
}
