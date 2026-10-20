package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.ConversationRepository.Loaded;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.NewNote;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.feature.report.app.PracticeNote;
import com.acttub.actingapi.feature.report.app.ReportEngine;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** practice.note: 대화가 닫힐 때 노트를 언제 만들고, 실패하면 무엇을 남기는지. */
class NoteWriterTest {
    static final Instant NOW = Instant.parse("2026-10-20T00:00:00Z");
    final ConversationRepository conversations = mock(ConversationRepository.class);
    final ReportEngine reports = mock(ReportEngine.class);
    final NoteWriter writer = new NoteWriter(conversations, reports);
    final UUID practice = UUID.randomUUID();
    final UUID conversation = UUID.randomUUID();
    final List<NewNote> saved = new ArrayList<>();

    NoteWriterTest() {
        when(conversations.saveNote(eq(conversation), any(), eq(NOW))).thenAnswer(call -> {
            saved.add(call.getArgument(1));
            return mock(ConversationRepository.NoteView.class);
        });
    }

    CoachSessionSnapshot session(String version, JsonNode pack, JsonNode state, String... actorTurns) {
        var turns = new ArrayList<CoachTurnSnapshot>();
        for (String text : actorTurns) {
            turns.add(new CoachTurnSnapshot("ai", "코치 질문"));
            turns.add(new CoachTurnSnapshot("actor", text));
        }
        return new CoachSessionSnapshot(UUID.randomUUID(), practice, UUID.randomUUID(), pack, "", "", "", 8000, "분석", "그 외", "",
                "closed", "actor_finished", turns, PriorContext.EMPTY, version, 3, state, null);
    }

    ConversationRepository.NoteView write(CoachSessionSnapshot session) {
        Loaded loaded = new Loaded(practice, conversation, "closed", session);
        return writer.write(loaded, new CoachResult(session, new CoachReply("끝", "complete", StructuredJson.MAPPER.createObjectNode())), 7, NOW);
    }

    JsonNode legacyReport(String reportType, String title) {
        return StructuredJson.MAPPER.createObjectNode().put("report_type", reportType).put("title", title);
    }

    @Test void legacySessionsNeedTwoRealAnswersBeforeANoteIsMade() {
        assertThat(write(session("legacy", null, null, "모르겠어요", "그만"))).isNull();
        verify(reports, never()).generateReport(anyString(), any(), any(), anyBoolean(), anyString(), any(), any(), any(), any());
        assertThat(saved).isEmpty();
    }

    @Test void legacyNotesKeepTheGeneratorsReportAndAnEmptyPackStandsInForMissingObservations() {
        JsonNode report = legacyReport("analysis", "말끝");
        when(reports.generateReport(eq("analysis"), any(), any(), eq(true), eq(conversation.toString()), any(), any(), eq(practice), any()))
                .thenReturn(report);
        write(session("legacy", null, null, "붙잡고 싶었어", "애원처럼 보이긴 싫어"));
        ArgumentCaptor<JsonNode> pack = ArgumentCaptor.forClass(JsonNode.class);
        verify(reports).generateReport(eq("analysis"), pack.capture(), any(), eq(true), anyString(), any(), any(), any(), any());
        assertThat(pack.getValue().toString()).isEqualTo("{\"observations\":[],\"uncertainties\":[]}");
        assertThat(saved).singleElement().satisfies(note -> {
            assertThat(note.format()).isEqualTo("legacy");
            assertThat(note.kind()).isEqualTo("analysis");
            assertThat(note.title()).isEqualTo("말끝");
            assertThat(note.sourceRevision()).isEqualTo(7);
            assertThat(note.fallback()).isFalse();
            assertThat(note.legacyReport()).isEqualTo(report);
        });
    }

    @Test void aLegacyGeneratorFailureIsRetriedOnceAndABlankTitleIsStoredAsNull() {
        JsonNode pack = StructuredJson.parse("{\"observations\":[{\"what\":\"멈춘다\"}],\"uncertainties\":[]}");
        when(reports.generateReport(anyString(), eq(pack), any(), anyBoolean(), anyString(), any(), any(), any(), any()))
                .thenThrow(new IllegalStateException("format")).thenReturn(legacyReport("analysis", " "));
        write(session("legacy", pack, null, "붙잡고 싶었어", "애원처럼 보이긴 싫어"));
        assertThat(saved).singleElement().satisfies(note -> assertThat(note.title()).isNull());
    }

    @Test void legacySessionsGetNoNoteWhenGenerationFailsTwiceOrIsBlocked() {
        when(reports.generateReport(anyString(), any(), any(), anyBoolean(), anyString(), any(), any(), any(), any()))
                .thenThrow(new IllegalStateException("format"));
        assertThat(write(session("legacy", null, null, "붙잡고 싶었어", "애원처럼 보이긴 싫어"))).isNull();
        verify(reports, times(2)).generateReport(anyString(), any(), any(), anyBoolean(), anyString(), any(), any(), any(), any());

        NoteWriterTest blocked = new NoteWriterTest();
        when(blocked.reports.generateReport(anyString(), any(), any(), anyBoolean(), anyString(), any(), any(), any(), any()))
                .thenReturn(legacyReport("blocked", "막힘"));
        assertThat(blocked.write(blocked.session("legacy", null, null, "붙잡고 싶었어", "애원처럼 보이긴 싫어"))).isNull();
        assertThat(blocked.saved).isEmpty();
    }

    @Test void aCutPracticeLoopHasNothingToSummarise() {
        ObjectNode state = StructuredJson.MAPPER.createObjectNode();
        state.putObject(DirectVideoPracticeLoop.STATE_KEY).put(DirectVideoPracticeLoop.NOT_ACTING, "뉴스 화면");
        assertThat(write(session("three_layers_v1", null, state))).isNull();
        verify(reports, never()).generatePracticeNote(any(), any(), any());
        assertThat(saved).isEmpty();
    }

    @Test void twoFailedNoteGenerationsLeaveARecordOnlyFallback() {
        when(reports.generatePracticeNote(any(), eq(practice), any())).thenThrow(new IllegalStateException("model down"));
        write(session("three_layers_v1", null, null));
        verify(reports, times(2)).generatePracticeNote(any(), eq(practice), any());
        assertThat(saved).singleElement().satisfies(note -> {
            assertThat(note.format()).isEqualTo("v2");
            assertThat(note.kind()).isEqualTo("record_only");
            assertThat(note.title()).isNull();
            assertThat(note.nextTake()).isNull();
            assertThat(note.fallback()).isTrue();
            assertThat(note.legacyReport()).isNull();
        });
    }

    ObjectNode practiceNote(String mode, String focus, String instruction) {
        ObjectNode note = StructuredJson.MAPPER.createObjectNode().put("schema_version", PracticeNote.VERSION).put("mode", mode);
        if (focus == null) note.putNull("focus"); else note.putObject("focus").put("label", focus);
        if (instruction != null) note.putObject("practice").putObject("instruction").put("text", instruction);
        return note;
    }

    @Test void anActionNoteIsTitledByItsFocusAndCarriesTheNextTake() {
        when(reports.generatePracticeNote(any(), eq(practice), any()))
                .thenReturn(new PracticeNote.Generated(practiceNote("action", "말끝", "끝을 짧게 해 본다"), true));
        write(session("three_layers_v1", null, null));
        assertThat(saved).singleElement().satisfies(note -> {
            assertThat(note.format()).isEqualTo("v2");
            assertThat(note.kind()).isEqualTo("action");
            assertThat(note.title()).isEqualTo("말끝");
            assertThat(note.nextTake()).isEqualTo("끝을 짧게 해 본다");
            assertThat(note.fallback()).isTrue();
            assertThat(note.summaryQuotes()).isEmpty();
        });
    }

    @Test void observationAndRecordOnlyNotesHaveNoInventedTitleOrTake() {
        when(reports.generatePracticeNote(any(), eq(practice), any()))
                .thenReturn(new PracticeNote.Generated(practiceNote("observation", null, null), false))
                .thenReturn(new PracticeNote.Generated(practiceNote("record_only", "남은 초점", null), false));
        write(session("three_layers_v1", null, null));
        write(session("three_layers_v1", null, null));
        assertThat(saved).extracting(NewNote::kind).containsExactly("observation", "record_only");
        assertThat(saved).extracting(NewNote::title).containsExactly(null, null);
        assertThat(saved).extracting(NewNote::nextTake).containsExactly(null, null);
    }

    @Test void aThreeLayerSessionWhoseGeneratorReturnedAnOldReportKeepsItAsLegacy() {
        when(reports.generatePracticeNote(any(), eq(practice), any()))
                .thenReturn(new PracticeNote.Generated((ObjectNode) legacyReport("coaching", "옛 형식"), false));
        write(session("three_layers_v1", null, null));
        assertThat(saved).singleElement().satisfies(note -> {
            assertThat(note.format()).isEqualTo("legacy");
            assertThat(note.kind()).isEqualTo("coaching");
            assertThat(note.title()).isEqualTo("옛 형식");
        });
    }

    @Test void summaryQuotesSkipMissingEmptyAndUnsharedSources() {
        JsonNode note = StructuredJson.parse("""
                {"copy":{"summary":{"text":"말끝이 내려간다.","source_refs":["x9","m1","e1"]}},
                 "source_catalog":[{"id":"m1","kind":"actor_message","text":""},
                                   {"id":"e1","kind":"video_observation","text":"XYZ"}]}
                """);
        assertThat(NoteWriter.summaryQuotes(note)).isEmpty();
        assertThat(NoteWriter.summaryQuotes(StructuredJson.parse("{\"copy\":{\"summary\":null}}"))).isEmpty();
    }
}
