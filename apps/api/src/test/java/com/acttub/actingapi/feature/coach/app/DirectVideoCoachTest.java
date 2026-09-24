package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;

class DirectVideoCoachTest {
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final TextGenerator oldGenerator = mock(TextGenerator.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");
    final List<Path> temporary = new ArrayList<>();
    final DirectVideoCoach direct = new DirectVideoCoach(model, videos, storage, failures, telemetry);
    final CoachEngine engine = new CoachEngine(oldGenerator, failures, telemetry, true, Optional.of(direct));

    DirectVideoCoachTest() {
        when(videos.find(any(), any())).thenReturn(new CoachVideoSource.Video("owned/video.mp4", "video/mp4", "etag"));
        when(storage.downloadToPath(eq("owned/video.mp4"), any())).thenAnswer(call -> {
            Path path = call.getArgument(1);
            temporary.add(path);
            Files.writeString(path, "original video bytes");
            return new StoredObjectMetadata(20, "video/mp4", "\"etag\"");
        });
        when(model.upload(any(), eq("video/mp4"))).thenAnswer(call -> {
            assertThat(Files.readString(call.getArgument(0))).isEqualTo("original video bytes");
            return file;
        });
        when(model.ready(file)).thenReturn(true);
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"intention\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("말끝을 가볍게 던진 선택이 보여요. 장난스럽게 겁주려는 건가요?");
    }

    CoachSessionSnapshot session() {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", 8000, "그 외", "그 외", null,
                List.of(), "", null, "open", "", List.of()).withCoachingState("three_layers_v1", 0, null, "open", "");
    }

    @Test void existingEngineRoutesActualConversationAndPassesOnlySelectedPrompts() {
        var initial = session();
        var first = engine.start(initial, UUID.randomUUID());
        verify(videos).find(initial.userId(), initial.practiceSessionId());
        verify(model).reply(file, List.of(), DirectVideoPrompts.forRoutes(List.of(DirectVideoRoute.OPENING)));
        assertThat(first.session().turns()).containsExactly(new CoachTurnSnapshot("ai", first.reply().message()));
        assertThat(first.session().stateRevision()).isEqualTo(1);
        var second = engine.reply(first.session(), "장난스럽게 겁주려는 거야", UUID.randomUUID());
        verify(model).reply(file, List.of(new DirectVideoModel.Message("model", first.reply().message()),
                new DirectVideoModel.Message("user", "장난스럽게 겁주려는 거야")), DirectVideoPrompts.forRoutes(List.of(DirectVideoRoute.INTENTION)));
        assertThat(second.session().stateRevision()).isEqualTo(2);
        assertThat(second.session().turns()).hasSize(3);
        assertThat(second.session().coachingState().path("context").path("direction").isNull()).isTrue();
        verifyNoInteractions(oldGenerator);
        verify(model).classify(List.of(new DirectVideoModel.Message("model", first.reply().message()),
                new DirectVideoModel.Message("user", "장난스럽게 겁주려는 거야")),
                DirectVideoPrompts.classifier(), DirectVideoRouting.CATEGORIES);
        verify(model, times(2)).delete(file);
        assertThat(temporary).allSatisfy(path -> assertThat(path).doesNotExist());
        assertThat(telemetry.calls()).hasSize(3);
    }

    @Test void explicitEndPreservesExistingHandoffAndNoteContract() {
        var first = engine.start(session(), UUID.randomUUID());
        var end = engine.reply(first.session(), "그만", UUID.randomUUID());
        assertThat(end.reply().status()).isEqualTo("complete");
        verify(model, never()).classify(anyList(), anyString(), anyList());
        verify(model).reply(eq(file), anyList(), eq(DirectVideoPrompts.forRoutes(List.of(DirectVideoRoute.CLOSING))));
        assertThat(end.session().closeReason()).isEqualTo("actor_finished");
        StructuredJson.validate("coach_handoff_v2", end.reply().handoff());
        assertThat(end.reply().handoff().path("record_ref").isNull()).isTrue();
        assertThat(end.reply().handoff().path("conversation")).hasSize(3);
        var reports = new com.acttub.actingapi.feature.report.app.ReportEngine(
                (prompt, input) -> { throw new IllegalStateException("note generation unavailable"); },
                StructuredJson.MAPPER, telemetry);
        var note = reports.generateReport("coaching", end.session().observationPack(), end.reply().handoff(),
                false, UUID.randomUUID().toString(), null, null);
        assertThat(note.path("schema_version").asText()).isEqualTo("acttub.practice_note.v1");
    }

    @Test void tenthReplyClosesAtExistingTurnBudget() {
        var turns = new ArrayList<CoachTurnSnapshot>();
        for (int i = 0; i < 9; i++) turns.add(new CoachTurnSnapshot("ai", "이전 코칭 " + i));
        var result = engine.reply(session().withTurns(turns), "알겠어", UUID.randomUUID());
        assertThat(result.session().closeReason()).isEqualTo("turn_budget");
        assertThat(result.reply().status()).isEqualTo("complete");
    }

    @Test void unavailableReplyDoesNotMutateHistoryAndCleansMedia() {
        var initial = session();
        when(model.reply(any(), anyList(), anyString())).thenThrow(new IllegalStateException("provider failed"));
        assertThatThrownBy(() -> engine.reply(initial, "겁주려는 거야", UUID.randomUUID()))
                .isInstanceOf(CoachReplyUnavailable.class);
        assertThat(initial.turns()).isEmpty();
        assertThat(initial.stateRevision()).isZero();
        verify(model).delete(file);
        assertThat(temporary).allSatisfy(path -> assertThat(path).doesNotExist());
        assertThat(failures.contexts()).anyMatch(context -> context.startsWith("DirectVideoCoach.turn"));
    }

    @Test void changedOrUnavailableOwnedMediaNeverReachesGemini() {
        when(storage.downloadToPath(anyString(), any())).thenReturn(new StoredObjectMetadata(20, "video/mp4", "changed"));
        assertThatThrownBy(() -> engine.start(session(), UUID.randomUUID())).isInstanceOf(CoachReplyUnavailable.class);
        when(videos.find(any(), any())).thenReturn(null);
        assertThatThrownBy(() -> engine.start(session(), UUID.randomUUID())).isInstanceOf(CoachReplyUnavailable.class);
        verify(model, never()).upload(any(), anyString());
    }

    @Test void failedProcessingAndCleanupAreReportedWithoutLosingSuccessfulReply() {
        when(model.ready(file)).thenThrow(new IllegalStateException("processing failed"));
        assertThatThrownBy(() -> engine.start(session(), UUID.randomUUID())).isInstanceOf(CoachReplyUnavailable.class);
        verify(model).delete(file);
        doReturn(true).when(model).ready(file);
        doThrow(new IllegalStateException("delete failed")).when(model).delete(file);
        assertThat(engine.start(session(), UUID.randomUUID()).reply().message()).isNotBlank();
        assertThat(failures.contexts()).anyMatch(context -> context.startsWith("DirectVideoCoach.turn"))
                .anyMatch(context -> context.startsWith("DirectVideoCoach.delete"));
    }

    @Test void acknowledgementDoesNotCloseAndClassificationFailureStillAnswers() {
        var first = engine.start(session(), UUID.randomUUID());
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"acknowledgement\"]}");
        var acknowledged = engine.reply(first.session(), "알겠어", UUID.randomUUID());
        assertThat(acknowledged.reply().status()).isNotEqualTo("complete");
        verify(model).reply(eq(file), anyList(), eq(DirectVideoPrompts.forRoutes(List.of(DirectVideoRoute.ACKNOWLEDGEMENT))));
        when(model.classify(anyList(), anyString(), anyList())).thenThrow(new IllegalStateException("classifier unavailable"));
        var fallback = engine.reply(acknowledged.session(), "그런데 왜 그렇게 보였어?", UUID.randomUUID());
        assertThat(fallback.session().turns()).hasSize(5);
        verify(model).reply(eq(file), anyList(), eq(DirectVideoPrompts.forRoutes(List.of(DirectVideoRoute.GENERAL))));
        assertThat(failures.contexts()).anyMatch(context -> context.startsWith("DirectVideoRouting.classify"));
    }

    static final String OPENING = "<설계>\n인물: 혼자 선 척 붙잡히길 바란다\n순간1: \"됐어\" | 보이는: 상대가 물러나게 | 없는: 상대가 붙잡게\n</설계>\n"
            + "<코치>\n\"됐어\"에서 고개를 돌려서, 상대에게 \"가\"라는 말로 들려요.\n이 순간 인물은 상대가 물러나길 바랄까요, 붙잡길 바랄까요?\n</코치>";
    static final String OPENING_SHOWN = "\"됐어\"에서 고개를 돌려서, 상대에게 \"가\"라는 말로 들려요.\n"
            + "이 순간 인물은 상대가 물러나길 바랄까요, 붙잡길 바랄까요?";

    CoachEngine practiceLoopEngine() {
        return new CoachEngine(oldGenerator, failures, telemetry, true, Optional.of(
                new DirectVideoCoach(model, videos, storage, failures, telemetry, true)));
    }

    @SuppressWarnings("unchecked")
    @Test void practiceLoopShowsOnlyCoachTextAndReplaysHiddenDesignAndStatus() {
        var loopEngine = practiceLoopEngine();
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING,
                "<상태>순간1 · 과제 · 누적 0줄 0번 · 응답 2번째</상태>\n붙잡게 두 번, 물러나게 한 번 해 보세요.",
                "<상태>순간1 · 달라진 점 · 누적 1줄 3번 · 응답 3번째</상태>\n무엇이 달랐나요?");
        var first = loopEngine.start(session(), UUID.randomUUID());
        assertThat(first.reply().message()).isEqualTo(OPENING_SHOWN);
        assertThat(first.session().turns()).containsExactly(new CoachTurnSnapshot("ai", OPENING_SHOWN));
        assertThat(first.session().coachingState().path("practice_loop").path("design").asText()).startsWith("인물:");

        var second = loopEngine.reply(first.session(), "붙잡길", UUID.randomUUID());
        assertThat(second.reply().message()).isEqualTo("붙잡게 두 번, 물러나게 한 번 해 보세요.");
        var third = loopEngine.reply(second.session(), "해봤어요", UUID.randomUUID());
        assertThat(third.reply().status()).isEqualTo("continue");
        assertThat(third.session().turns()).extracting(CoachTurnSnapshot::text)
                .noneMatch(text -> text.contains("<설계>") || text.contains("<상태>") || text.contains("<코치>"));

        var histories = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(model, times(3)).reply(eq(file), histories.capture(), eq(DirectVideoPrompts.practiceLoop()));
        verify(model, never()).classify(anyList(), anyString(), anyList());
        assertThat(histories.getAllValues().get(0)).isEmpty();
        assertThat(histories.getAllValues().get(1)).containsExactly(
                new DirectVideoModel.Message("model", OPENING),
                new DirectVideoModel.Message("user", "붙잡길"));
        assertThat(histories.getAllValues().get(2)).containsExactly(
                new DirectVideoModel.Message("model", OPENING),
                new DirectVideoModel.Message("user", "붙잡길"),
                new DirectVideoModel.Message("model",
                        "<상태>순간1 · 과제 · 누적 0줄 0번 · 응답 2번째</상태>\n붙잡게 두 번, 물러나게 한 번 해 보세요."),
                new DirectVideoModel.Message("user", "해봤어요"));
        assertThat(telemetry.calls()).hasSize(3);
    }

    @Test void practiceLoopClosesWhenCoachFinishesOrActorStops() {
        var loopEngine = practiceLoopEngine();
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING,
                "<상태>순간2 · 마무리2 · 누적 2줄 6번 · 응답 9번째</상태>\n\"잡아주길 기다리는 사람\"으로 오늘 노트를 마칠게요.");
        var first = loopEngine.start(session(), UUID.randomUUID());
        var done = loopEngine.reply(first.session(), "잡아주길 기다리는 사람", UUID.randomUUID());
        assertThat(done.reply().status()).isEqualTo("complete");
        assertThat(done.reply().message()).doesNotContain("<상태>");
        StructuredJson.validate("coach_handoff_v2", done.reply().handoff());

        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING,
                "<상태>순간1 · 끝 · 누적 0줄 0번 · 응답 2번째</상태>\n오늘은 여기까지 해요. 새 테이크를 올리면 이어서 해요.");
        var opened = loopEngine.start(session(), UUID.randomUUID());
        var stopped = loopEngine.reply(opened.session(), "그만", UUID.randomUUID());
        assertThat(stopped.session().closeReason()).isEqualTo("actor_finished");
        assertThat(stopped.reply().message()).isEqualTo("오늘은 여기까지 해요. 새 테이크를 올리면 이어서 해요.");
        verify(model, never()).classify(anyList(), anyString(), anyList());
        verify(model, never()).reply(eq(file), anyList(), eq(DirectVideoPrompts.forRoutes(List.of(DirectVideoRoute.CLOSING))));
    }

    @Test void sessionsOpenedBeforeThePracticeLoopKeepRouting() {
        var turns = List.of(new CoachTurnSnapshot("ai", "기존 첫 피드백이에요."));
        var result = practiceLoopEngine().reply(session().withTurns(turns), "겠주려는 거야", UUID.randomUUID());
        verify(model).classify(anyList(), anyString(), anyList());
        verify(model).reply(eq(file), anyList(), eq(DirectVideoPrompts.forRoutes(List.of(DirectVideoRoute.INTENTION))));
        assertThat(result.session().coachingState().has("practice_loop")).isFalse();
    }

    @Test void practiceLoopParsingToleratesMissingTags() {
        var plain = DirectVideoPracticeLoop.parse("태그 없이 온 답이에요.");
        assertThat(plain.message()).isEqualTo("태그 없이 온 답이에요.");
        assertThat(plain.status()).isEmpty();
        assertThat(DirectVideoPracticeLoop.finished(plain)).isFalse();
        var unclosed = DirectVideoPracticeLoop.parse("<설계>\n인물: x\n</설계>\n<코치>\n닫는 태그가 없어요.");
        assertThat(unclosed.message()).isEqualTo("닫는 태그가 없어요.");
        assertThat(unclosed.design()).isEqualTo("인물: x");
    }

    @Test void practiceLoopNoteUsesTheHabitTheActorsOwnLineAndTheNextTake() throws Exception {
        var state = (com.fasterxml.jackson.databind.node.ObjectNode) StructuredJson.MAPPER.readTree("""
                {"revision":5,"practice_loop":{"design":"소리 빠르기: 없음\\n버릇: 문장 사이 쉼 없이 몰아쳐요 | 곳1: \\"장난하냐\\" | 곳2: \\"구해 와\\"\\n다음 테이크: 문장마다 한 번씩 쉬어 보기\\n인물: 돈을 받아내려 한다",
                "statuses":["","파고들기 · 응답 2번째","파고들기 · 응답 3번째","이어보기 · 응답 4번째","마무리1 · 응답 5번째","마무리2 · 응답 6번째"]}}
                """);
        var turns = List.of(new CoachTurnSnapshot("ai", "첨 말"), new CoachTurnSnapshot("actor", "네 좀 그래요"),
                new CoachTurnSnapshot("ai", "왜 그럴까요?"), new CoachTurnSnapshot("actor", "몰라요"),
                new CoachTurnSnapshot("ai", "더 쉬운 질문"), new CoachTurnSnapshot("actor", "틈을 주면 밀릴 것 같아서요"),
                new CoachTurnSnapshot("ai", "인물에게 맞나요?"), new CoachTurnSnapshot("actor", "인물은 여유 있게 눌러야 무서워요"),
                new CoachTurnSnapshot("ai", "한 줄로 적는다면요?"), new CoachTurnSnapshot("actor", "나는 틈을 주면 밀릴까 봐 몰아치는 배우다"),
                new CoachTurnSnapshot("ai", "적어 둘게요."));
        var closed = session().withTurns(turns).withCoachingState("three_layers_v1", 6, state, "closed", "interrupted");
        var note = DirectVideoPracticeLoop.note(closed, 6);
        assertThat(note.format()).isEqualTo("v2");
        assertThat(note.kind()).isEqualTo("action");
        assertThat(note.title()).isEqualTo("문장 사이 쉼 없이 몰아쳐요");
        assertThat(note.nextTake()).isEqualTo("문장마다 한 번씩 쉬어 보기");
        assertThat(note.summaryQuotes()).hasSize(2);
        assertThat(note.summaryQuotes().get(0).path("quote").asText()).isEqualTo("나는 틈을 주면 밀릴까 봐 몰아치는 배우다");
        assertThat(note.summaryQuotes().get(0).path("kind").asText()).isEqualTo("actor");
        assertThat(note.summaryQuotes().get(0).path("source_ref").asText()).isEqualTo(StructuredCoachEngine.turnId(closed, 9));
        assertThat(note.summaryQuotes().get(1).path("quote").asText()).isEqualTo("틈을 주면 밀릴 것 같아서요");
        assertThat(note.legacyReport()).isNull();
        assertThat(DirectVideoPracticeLoop.note(session().withTurns(turns), 1)).isNull();
    }

    @Test void practiceLoopReadsTheActionWhereverItSitsAndDropsStrayJamo() {
        var closing = DirectVideoPracticeLoop.parse("<상태>마무리2 · 응답 6번째</상태>\n한 줄을 적어 둘게요.");
        assertThat(DirectVideoPracticeLoop.finished(closing)).isTrue();
        assertThat(DirectVideoPracticeLoop.finished(DirectVideoPracticeLoop.parse(
                "<상태>끝 · 응답 3번째</상태>\n오늘은 여기까지 해요."))).isTrue();
        assertThat(DirectVideoPracticeLoop.finished(DirectVideoPracticeLoop.parse(
                "<상태>파고들기 · 응답 2번째</상태>\n속으로 어땠어요?"))).isFalse();
        var stray = DirectVideoPracticeLoop.parse("<상태>파고들기 · 응답 2번째</상태>\n그랬군요.ㄴ\n속으로는 어땠어요?ㄴ ");
        assertThat(stray.message()).isEqualTo("그랬군요.\n속으로는 어땠어요?");
        assertThat(DirectVideoPracticeLoop.parse("ㅋㅋ\n그랬군요").message()).isEqualTo("ㅋㅋ\n그랬군요");
    }

    @Test void habitTitleFallsBackToTheDescriptionWhenTheModelWritesACategoryName() {
        String design = "소리 빠르기: 처음부터 끝까지 일정하고 빠른 편이에요. \"손도 막 떨더라고요\"도요.\n소리 말끝: 없음\n"
                + "버릇: 소리 빠르기 | 곳1: \"손도\" | 곳2: \"살아야\"\n다음 테이크: 문장 사이 쉬기";
        assertThat(DirectVideoPracticeLoop.habit(design)).isEqualTo("처음부터 끝까지 일정하고 빠른 편이에요");
        assertThat(DirectVideoPracticeLoop.habit("버릇: 말끝을 툭 떨어뜨려요 | 곳1: x")).isEqualTo("말끝을 툭 떨어뜨려요");
        assertThat(DirectVideoPracticeLoop.habit("소리 크기: 없음\n버릇: 소리 크기 | 곳1: x")).isEqualTo("소리 크기");
    }
}
