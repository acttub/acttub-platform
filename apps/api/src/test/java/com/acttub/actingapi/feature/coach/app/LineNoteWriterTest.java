package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.List;
import java.util.Queue;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.feature.coach.app.ConversationRepository.Loaded;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.NoteView;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** Pro 「대사별로 본 것」(SOMA-900): 읽기·자르기·Pro 아닐 때 건너뛰기·닫기가 기다리지 않는지. */
class LineNoteWriterTest {
    final ConversationRepository conversations = mock(ConversationRepository.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final Queue<Runnable> queued = new ArrayDeque<>();
    final AtomicInteger modelCalls = new AtomicInteger();
    final UUID user = UUID.randomUUID();
    final UUID conversation = UUID.randomUUID();
    String modelAnswer = "{\"line_notes\":[]}";

    LineNoteWriter writer(CoachPro pro, LineNoteModel model) {
        return new LineNoteWriter(true, pro, model, conversations, failures, queued::add);
    }

    LineNoteModel model() {
        return prompt -> {
            modelCalls.incrementAndGet();
            return modelAnswer;
        };
    }

    CoachSessionSnapshot session() {
        JsonNode state = StructuredJson.MAPPER.createObjectNode().set("practice_loop",
                StructuredJson.MAPPER.createObjectNode().put("design", "버릇: 대사를 끝까지 밀어붙임\n확인된 대사: \"가지 마\""));
        var turns = List.of(new CoachTurnSnapshot("ai", "어디서 멈췄어요?"), new CoachTurnSnapshot("actor", "가지 마에서요"));
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), user, null, "", "", "", 8000, "그 외", "그 외", "",
                "closed", "", turns, PriorContext.EMPTY, "v2", 3, state, null);
    }

    NoteView note() {
        return new NoteView(UUID.randomUUID(), conversation, "v2", "action", "끝까지 밀어붙이는 버릇",
                StructuredJson.MAPPER.createArrayNode(), "한 박자 쉬고 해 보세요", StructuredJson.MAPPER.createArrayNode(),
                StructuredJson.MAPPER.createArrayNode(), StructuredJson.MAPPER.createArrayNode(), false, 3, null, Instant.now());
    }

    static String item(String line, String seen, String tryNext) {
        return "{\"line\":\"" + line + "\",\"seen\":\"" + seen + "\",\"try\":\"" + tryNext + "\"}";
    }

    @Test void parsesCapsAtThreeAndDropsBlankOrTooLongItems() {
        String raw = "```json\n{\"line_notes\":[" + String.join(",",
                item("가지 마", "목소리가 커지는 쪽으로 갔어요", "첫 마디만 낮게 해 봐요"),
                item("", "비었어요", "버려요"),
                item("둘째", "x".repeat(81), "버려요"),
                item("셋째", "숨이 짧게 들렸어요", "끝에서 한 번 쉬어 봐요"),
                item("넷째", "눈이 아래로 갔어요", "상대를 한 번 봐요"),
                item("다섯째", "넘쳐요", "넘쳐요")) + "]}\n```";
        List<LineNoteWriter.Item> items = LineNoteWriter.parse(raw, "제목", "다음");
        assertThat(items).extracting(LineNoteWriter.Item::line).containsExactly("가지 마", "셋째", "넷째");
    }

    @Test void garbageOrEmptyAnswersGiveNothing() {
        assertThat(LineNoteWriter.parse("죄송해요", "t", "n")).isEmpty();
        assertThat(LineNoteWriter.parse("{\"line_notes\":\"x\"}", "t", "n")).isEmpty();
        assertThat(LineNoteWriter.parse(null, "t", "n")).isEmpty();
    }

    @Test void dropsItemsThatRepeatTheTitleOrNextTake() {
        String raw = "[" + item("가지 마", "끝까지 밀어붙이는 버릇", "다른 걸 해요") + ","
                + item("떠나", "속도가 빨랐어요", "한 박자 쉬고 해 보세요") + "]";
        assertThat(LineNoteWriter.parse(raw, "끝까지 밀어붙이는 버릇", "한 박자 쉬고 해 보세요")).isEmpty();
    }

    @Test void schedulingReturnsBeforeTheModelRunsAndThenSavesTheItems() {
        modelAnswer = "{\"line_notes\":[" + item("가지 마", "목소리가 커졌어요", "첫 마디를 낮게 해 봐요") + "]}";
        LineNoteWriter writer = writer(id -> true, model());
        writer.schedule(session(), conversation, note());
        assertThat(modelCalls).hasValue(0);
        verify(conversations, never()).saveLineNotes(any(), any());
        assertThat(queued).hasSize(1);
        queued.poll().run();
        ArgumentCaptor<JsonNode> saved = ArgumentCaptor.forClass(JsonNode.class);
        verify(conversations).saveLineNotes(org.mockito.ArgumentMatchers.eq(conversation), saved.capture());
        assertThat(saved.getValue().get(0).get("try").asText()).isEqualTo("첫 마디를 낮게 해 봐요");
    }

    @Test void nonProNeverCallsTheModel() {
        LineNoteWriter writer = writer(CoachPro.NONE, model());
        writer.schedule(session(), conversation, note());
        queued.poll().run();
        assertThat(modelCalls).hasValue(0);
        verify(conversations, never()).saveLineNotes(any(), any());
    }

    @Test void aFailingModelIsReportedAndSwallowedAndSavesNothing() {
        LineNoteWriter writer = writer(id -> true, prompt -> { throw new IllegalStateException("model down"); });
        writer.schedule(session(), conversation, note());
        queued.poll().run();
        assertThat(failures.reports()).hasSize(1);
        verify(conversations, never()).saveLineNotes(any(), any());
    }

    @Test void nothingGroundedSavesNothing() {
        LineNoteWriter writer = writer(id -> true, model());
        writer.schedule(session(), conversation, note());
        queued.poll().run();
        assertThat(modelCalls).hasValue(1);
        verify(conversations, never()).saveLineNotes(any(), any());
    }

    @Test void aRejectedExecutorOrAlreadyFilledNoteDoesNotThrowOrRun() {
        LineNoteWriter rejecting = new LineNoteWriter(true, id -> true, model(), conversations, failures,
                task -> { throw new java.util.concurrent.RejectedExecutionException("full"); });
        rejecting.schedule(session(), conversation, note());
        assertThat(failures.reports()).hasSize(1);
        ArrayNode filled = StructuredJson.MAPPER.createArrayNode();
        filled.addObject().put("line", "a");
        NoteView n = note();
        NoteView withLines = new NoteView(n.id(), n.conversationId(), n.format(), n.kind(), n.title(), n.summaryQuotes(),
                n.nextTake(), n.actorWords(), n.corrections(), n.tags(), false, 3, null, n.createdAt(), filled);
        writer(id -> true, model()).schedule(session(), conversation, withLines);
        assertThat(queued).isEmpty();
    }

    @Test void promptCarriesDesignLinesAndConversation() {
        String prompt = writer(id -> true, model()).prompt(session(), note());
        assertThat(prompt).contains("버릇: 대사를 끝까지 밀어붙임", "가지 마", "배우: 가지 마에서요", "코치: 어디서 멈췄어요?")
                .doesNotContain("{{");
    }

    @Test void closingAConversationDoesNotWaitForLineNotes() {
        var notes = mock(NoteWriter.class);
        var coach = mock(CoachEngine.class);
        var profiles = mock(CoachProfile.class);
        var memory = mock(CoachMemory.class);
        CoachSessionSnapshot full = session();
        CoachSessionSnapshot empty = new CoachSessionSnapshot(full.sessionId(), full.practiceSessionId(), user, null, "", "", "",
                8000, "그 외", "그 외", "", "open", "", List.of(), PriorContext.EMPTY, "v2", 1, full.coachingState(), null);
        UUID practice = UUID.randomUUID();
        when(conversations.loadByPractice(user, practice)).thenReturn(new Loaded(practice, null, "conversing", empty));
        when(conversations.open(any(), any(), any())).thenReturn(conversation);
        when(conversations.loadByConversation(user, conversation)).thenReturn(new Loaded(practice, conversation, "conversing", empty));
        NoteView note = note();
        when(notes.write(any(), any(), org.mockito.ArgumentMatchers.anyLong(), any())).thenReturn(note);
        when(coach.start(any(), org.mockito.ArgumentMatchers.eq(conversation))).thenReturn(
                new CoachResult(empty, new CoachReply("오늘은 여기까지 해요", "complete", StructuredJson.MAPPER.createObjectNode())));
        modelAnswer = "{\"line_notes\":[" + item("가지 마", "목소리가 커졌어요", "첫 마디를 낮게 해 봐요") + "]}";
        LineNoteWriter lineNotes = writer(id -> true, model());
        var service = new ConversationService(conversations, coach, notes, new MutableClock(Instant.parse("2026-10-27T00:00:00Z")),
                null, profiles, memory, failures, lineNotes);
        var turn = service.start(user, practice, UUID.randomUUID());
        assertThat(turn.note()).isSameAs(note);
        assertThat(modelCalls).hasValue(0);
        assertThat(queued).hasSize(1);
    }
}
