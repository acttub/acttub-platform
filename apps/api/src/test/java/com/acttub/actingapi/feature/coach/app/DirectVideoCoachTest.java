package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
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
    final DirectVideoCoach direct = new DirectVideoCoach(model, videos, storage, failures, telemetry, false);
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
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", 8000, "그 외", "그 외", null, "open", "", List.of(), PriorContext.EMPTY, "legacy", 0, null, null).withCoachingState("three_layers_v1", 0, null, "open", "");
    }

    @Test void emptyInputClosesNormallyBeforeAnyGoogleUploadOrModelCall() {
        when(model.inspect(any())).thenReturn(new DirectVideoModel.InputInspection(false, true));
        var result = practiceLoopEngine().start(session(), UUID.randomUUID());
        assertThat(result.reply().status()).isEqualTo("complete");
        assertThat(result.reply().message()).isEqualTo(
                "이 영상에서는 연기 장면을 찾지 못했어요.\n연기한 장면이 담긴 영상을 다시 올려 주세요.");
        assertThat(result.session().closeReason()).isEqualTo("interrupted");
        assertThat(DirectVideoPracticeLoop.wasCut(result.session().coachingState())).isTrue();
        assertThat(DirectVideoPracticeLoop.note(result.session(), 1)).isNull();
        verify(model, never()).upload(any(), anyString());
        verify(model, never()).upload(any(), anyString(), any());
        verify(model, never()).ready(any());
        verify(model, never()).reply(any(), anyList(), anyString());
        verify(model, never()).classify(anyList(), anyString(), anyList());
        verify(model, never()).delete(any());
        assertThat(telemetry.calls()).isEmpty();
        assertThat(failures.reports()).isEmpty();
        assertThat(temporary).allSatisfy(path -> assertThat(path).doesNotExist());
    }

    @Test void existingButSilentAudioClosesBeforeAnyUploadAndIsNotCalledNonActing() {
        when(model.inspect(any())).thenReturn(new DirectVideoModel.InputInspection(true, null, false));
        var result = practiceLoopEngine().start(session(), UUID.randomUUID());
        assertThat(result.reply().status()).isEqualTo("complete");
        assertThat(result.reply().message()).isEqualTo("영상의 소리가 녹음되지 않았어요.\n소리가 들리는 영상으로 다시 올려 주세요.");
        assertThat(result.session().closeReason()).isEqualTo("interrupted");
        assertThat(result.session().coachingState().path("practice_loop").path("input_issue").asText())
                .isEqualTo("silent_audio");
        assertThat(result.session().coachingState().path("practice_loop").has("not_acting")).isFalse();
        assertThat(DirectVideoPracticeLoop.wasCut(result.session().coachingState())).isTrue();
        assertThat(DirectVideoPracticeLoop.note(result.session(), 1)).isNull();
        verify(model, never()).upload(any(), anyString());
        verify(model, never()).upload(any(), anyString(), any());
        verify(model, never()).ready(any());
        verify(model, never()).reply(any(), anyList(), anyString());
        verify(model, never()).classify(anyList(), anyString(), anyList());
        assertThat(telemetry.calls()).isEmpty();
        assertThat(failures.reports()).isEmpty();
        assertThat(temporary).allSatisfy(path -> assertThat(path).doesNotExist());
    }

    @Test void audioDecodeFailureBlocksTheModelWithoutSavingAFalseNonActingState() {
        when(model.inspect(any())).thenThrow(new IllegalStateException("audio signal inspection failed"));
        var initial = session();
        assertThatThrownBy(() -> practiceLoopEngine().start(initial, UUID.randomUUID()))
                .isInstanceOf(CoachReplyUnavailable.class);
        assertThat(initial.turns()).isEmpty();
        assertThat(initial.coachingState()).isNull();
        verify(model, never()).upload(any(), anyString());
        verify(model, never()).upload(any(), anyString(), any());
        verify(model, never()).reply(any(), anyList(), anyString());
        assertThat(failures.reports()).singleElement().satisfies(report -> {
            assertThat(report.kind()).isEqualTo(com.acttub.actingapi.platform.observability.FailureKind.UNEXPECTED);
            assertThat(report.context()).startsWith("DirectVideoCoach.inspect");
        });
        assertThat(temporary).allSatisfy(path -> assertThat(path).doesNotExist());
    }

    @Test void unknownInspectionDoesNotRejectAnInputAsEmpty() {
        when(model.inspect(any())).thenReturn(new DirectVideoModel.InputInspection(null, true));
        var result = practiceLoopEngine().start(session(), UUID.randomUUID());
        assertThat(result.reply().status()).isEqualTo("continue");
        verify(model).upload(any(), eq("video/mp4"));
        verify(model).reply(eq(file), anyList(), anyString());
    }

    @Test void failedFrameInspectionDoesNotTurnAFileIntoANonActingClaim() {
        when(model.inspect(any())).thenThrow(new IllegalStateException("video frame inspection failed"));
        var initial = session();
        assertThatThrownBy(() -> practiceLoopEngine().start(initial, UUID.randomUUID()))
                .isInstanceOf(CoachReplyUnavailable.class);
        assertThat(initial.turns()).isEmpty();
        assertThat(initial.coachingState()).isNull();
        verify(model, never()).upload(any(), anyString());
        verify(model, never()).upload(any(), anyString(), any());
        verify(model, never()).reply(any(), anyList(), anyString());
        assertThat(failures.reports()).singleElement().satisfies(report -> {
            assertThat(report.kind()).isEqualTo(com.acttub.actingapi.platform.observability.FailureKind.UNEXPECTED);
            assertThat(report.context()).startsWith("DirectVideoCoach.inspect");
        });
        assertThat(temporary).allSatisfy(path -> assertThat(path).doesNotExist());
    }

    @Test void silentVideoUsesServerAudioFactsAndShowsOnlyVisualEvidence() {
        var silent = new DirectVideoModel.Video("files/silent", "gemini://silent", "video/mp4", false);
        when(model.inspect(any())).thenReturn(new DirectVideoModel.InputInspection(false, false));
        when(model.upload(any(), eq("video/mp4"), any())).thenReturn(silent);
        when(model.ready(silent)).thenReturn(true);
        when(model.reply(eq(silent), anyList(), anyString())).thenReturn("""
                <설계>
                영상: 연기
                대사 확인: 확인 안 됨
                확인된 대사: 없음
                버릇: 손을 펼 때 고개를 돌려요 | 곳1: 시작 | 곳2: 끝
                </설계>
                <코치>
                손을 펼 때 고개를 돌리는 쪽으로 가요.
                인물의 선택일 수도 있어요.
                평소에도 그런 편인가요?
                </코치>
                """);
        var first = practiceLoopEngine().start(session(), UUID.randomUUID());
        assertThat(first.reply().message()).as("첫 응답은 질문만 남는다").endsWith("?").doesNotContain("대사 확인", "확인된 대사", "\"");
        assertThat(first.session().coachingState().path("practice_loop").path("design").asText())
                .contains("대사 확인: 확인 안 됨", "확인된 대사: 없음");
        verify(model).reply(eq(silent), anyList(), argThat(prompt -> prompt.contains("audio_track_present=false")));
        verify(model).delete(silent);
    }

    @Test void silentVideoCannotReturnOrStoreAnInventedQuote() {
        var silent = new DirectVideoModel.Video("files/silent", "gemini://silent", "video/mp4", false);
        when(model.upload(any(), eq("video/mp4"))).thenReturn(silent);
        when(model.ready(silent)).thenReturn(true);
        when(model.reply(eq(silent), anyList(), anyString())).thenReturn("""
                <설계>
                영상: 연기
                대사 확인: 확인 안 됨
                확인된 대사: 없음
                버릇: 손을 펴는 쪽으로 가요
                </설계>
                <코치>
                "왜요"라고 말할 때 손을 펴요.
                평소에도 그런 편인가요?
                </코치>
                """);
        var initial = session();
        assertThatThrownBy(() -> practiceLoopEngine().start(initial, UUID.randomUUID()))
                .isInstanceOf(CoachReplyUnavailable.class);
        assertThat(initial.turns()).isEmpty();
        assertThat(initial.coachingState()).isNull();
        verify(model).delete(silent);
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
        // 기록마다 실제로 보낸 과제 템플릿이 붙는다 — 앞에 붙는 배우 정보는 빠진 정적 본문이다(SOMA-585).
        assertThat(telemetry.calls()).extracting(call -> call.prompt().name())
                .containsExactly("coach.direct.opening", "coach.direct.classifier", "coach.direct.intention");
        assertThat(telemetry.calls().get(1).prompt().text()).isEqualTo(DirectVideoPrompts.classifier());
        assertThat(telemetry.calls().get(2).prompt().text())
                .isEqualTo(DirectVideoPrompts.forRoutes(List.of(DirectVideoRoute.INTENTION)));
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

    @Test void sixteenthReplyClosesAtExistingTurnBudget() {
        var turns = new ArrayList<CoachTurnSnapshot>();
        for (int i = 0; i < 15; i++) turns.add(new CoachTurnSnapshot("ai", "이전 코칭 " + i));
        var result = engine.reply(session().withTurns(turns), "알겠어", UUID.randomUUID());
        assertThat(result.session().closeReason()).isEqualTo("turn_budget");
        assertThat(result.reply().status()).isEqualTo("complete");
    }

    @Test void tenthAndFifteenthReplyStayOpenBeforeTheTurnBudget() {
        for (int existing : List.of(9, 14)) {
            var turns = new ArrayList<CoachTurnSnapshot>();
            for (int i = 0; i < existing; i++) turns.add(new CoachTurnSnapshot("ai", "이전 코칭 " + i));
            var result = engine.reply(session().withTurns(turns), "알겠어", UUID.randomUUID());
            assertThat(result.session().closeReason()).as("기존 %d번째 응답 뒤에는 열려 있어야 한다", existing + 1)
                    .isEmpty();
            assertThat(result.reply().status()).isEqualTo("continue");
        }
    }

    @Test void practiceLoopPromptUsesSixteenAsACeilingInsteadOfAFiveTurnTarget() {
        // 첫 응답 프롬프트는 첫 응답만 쓴다. 버릇을 보여 주고 원하는 것을 묻는다. 누구 탓인지 확인하는 질문은 쓰지 않는다.
        assertThat(DirectVideoPrompts.practiceLoop())
                .contains("역할:", "이번 목표:", "도움이 되는 말:", "피할 말:", "뭘 얻어 내고 싶었어요?")
                .doesNotContain("이 세션은 약 5턴이다", "이번이 응답 5번째일 때", "할 일 표", "배우의 말 보기", "마무리1", "이어보기에서",
                        "2문장: 인물이 그런 건지");
        // 상한 직전의 마무리는 이제 코드가 정한다.
        var tally = new PracticeLoopRouter.Tally(2, 0, 0);
        var fifteenth = new PracticeLoopRouter.Before(15, "이어보기", PracticeLoopRouter.Kind.ANSWER, tally, List.of(), false, false, false, false);
        var sixteenth = new PracticeLoopRouter.Before(16, "이어보기", PracticeLoopRouter.Kind.ANSWER, tally, List.of(), false, false, false, false);
        assertThat(PracticeLoopRouter.route(PracticeLoopRouter.Kind.ANSWER, fifteenth)).as("15번째는 정리하고 16번째에 닫는다")
                .isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouter.route(PracticeLoopRouter.Kind.ANSWER, sixteenth)).isEqualTo(PracticeLoopRouter.END);
    }

    @Test void practiceLoopStillClosesAtTheServerTurnBudgetEvenWhenTheModelKeepsGoing() {
        var loopEngine = practiceLoopEngine();
        var turns = new ArrayList<CoachTurnSnapshot>();
        for (int i = 0; i < 15; i++) turns.add(new CoachTurnSnapshot("ai", "이전 코칭 " + i));
        // 종료 handoff도 검증하므로 실제 세션처럼 context와 source_catalog를 포함한다.
        var loopState = CoachingStateReducer.empty();
        loopState.putObject("practice_loop").put("design", "버릇: 말이 빠른 편이에요");
        var loopSession = session().withTurns(turns).withCoachingState("three_layers_v1", 0, loopState, "open", "");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(
                "<상태>이어보기 · 응답 16번째</상태>\n그때는 어떤 마음이었어요?");
        var result = loopEngine.reply(loopSession, "알겠어", UUID.randomUUID());
        assertThat(result.session().closeReason()).as("practiceLoop=true어도 서버 상한이 강제된다")
                .isEqualTo("turn_budget");
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
            + "<코치>\n이 장면에서 인물은 상대한테서 결국 뭘 얻어 내고 싶었어요?\n</코치>";
    // 첫 응답은 장면 전체에 대한 질문 한 문장이다.
    static final String OPENING_SHOWN = "이 장면에서 인물은 상대한테서 결국 뭘 얻어 내고 싶었어요?";

    CoachEngine practiceLoopEngine() {
        return new CoachEngine(oldGenerator, failures, telemetry, true, Optional.of(
                new DirectVideoCoach(model, videos, storage, failures, telemetry, true)));
    }

    @Test void advisorPersonaIsAssignedOnceStoredAndAddedToEveryCoachPrompt() {
        var asked = new java.util.concurrent.atomic.AtomicInteger();
        var loopEngine = new CoachEngine(oldGenerator, failures, telemetry, true, Optional.of(new DirectVideoCoach(
                model, videos, storage, failures, telemetry, true, s -> { asked.incrementAndGet(); return "b1"; })));
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING, "\"가\"에서도 상대를 안 봐요. 누구한테 하는 말이에요?");
        var first = loopEngine.start(session(), UUID.randomUUID());
        var second = loopEngine.reply(first.session(), "붙잡길 바랐어요", UUID.randomUUID());
        assertThat(asked).as("성격은 첫 응답 전에 한 번만 정한다").hasValue(1);
        assertThat(second.session().coachingState().path("practice_loop").path("persona").asText()).isEqualTo("b1");
        var prompts = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(model, times(2)).reply(eq(file), anyList(), prompts.capture());
        String persona = DirectVideoPrompts.persona("b1", null);
        assertThat(persona).startsWith("[이 코치의 성격: 무뚝뚝한 현장 연출가]");
        assertThat(prompts.getAllValues().get(0)).isEqualTo(DirectVideoPrompts.practiceLoop(first.session().practiceSessionId()) + "\n\n" + persona);
        assertThat(prompts.getAllValues().get(1)).startsWith(DirectVideoPrompts.practiceLoopTurn()).endsWith(persona);
        assertThat(telemetry.calls()).filteredOn(call -> call.step() == com.acttub.actingapi.platform.observability.LlmStep.COACH_TURN)
                .allSatisfy(call -> assertThat(call.metadata()).containsEntry("persona", "b1"));
    }

    @Test void defaultPersonaIsRecordedWithoutChangingThePromptAndOthersGetNothing() {
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING);
        var advisor = new CoachEngine(oldGenerator, failures, telemetry, true, Optional.of(new DirectVideoCoach(
                model, videos, storage, failures, telemetry, true, s -> CoachPersonas.DEFAULT))).start(session(), UUID.randomUUID());
        assertThat(advisor.session().coachingState().path("practice_loop").path("persona").asText()).isEqualTo("a");
        verify(model).reply(eq(file), anyList(), eq(DirectVideoPrompts.practiceLoop(advisor.session().practiceSessionId())));
        var other = practiceLoopEngine().start(session(), UUID.randomUUID());
        assertThat(other.session().coachingState().path("practice_loop").has("persona")).isFalse();
        assertThat(DirectVideoPrompts.persona("b1", Locale.ENGLISH)).as("성격 글은 한국어 대화에만 붙는다").isEmpty();
    }

    @Test void aFailingPersonaLookupFallsBackToTheDefaultCoach() {
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING);
        var result = new CoachEngine(oldGenerator, failures, telemetry, true, Optional.of(new DirectVideoCoach(
                model, videos, storage, failures, telemetry, true, s -> { throw new IllegalStateException("db down"); })))
                .start(session(), UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo(OPENING_SHOWN);
        assertThat(result.session().coachingState().path("practice_loop").has("persona")).isFalse();
        assertThat(failures.reports()).hasSize(1);
    }

    @SuppressWarnings("unchecked")
    @Test void practiceLoopShowsOnlyCoachTextAndLetsCodeChooseEachLaterAction() {
        var loopEngine = practiceLoopEngine();
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING,
                "<상태>할 일: 마무리2</상태>\n붙잡히고 싶은 마음이 먼저였군요.\n그 마음은 어느 대사에서 가장 커요?",
                "상대를 붙잡고 싶었군요.\n\"가\"에서도 같은 마음이었어요?");
        var first = loopEngine.start(session(), UUID.randomUUID());
        assertThat(first.reply().message()).isEqualTo(OPENING_SHOWN);
        assertThat(first.session().turns()).containsExactly(new CoachTurnSnapshot("ai", OPENING_SHOWN));
        assertThat(first.session().coachingState().path("practice_loop").path("design").asText()).startsWith("인물:");

        var second = loopEngine.reply(first.session(), "붙잡길 바랐던 것 같아요", UUID.randomUUID());
        assertThat(second.reply().message()).as("모델이 따라 쓴 상태 칸은 버리고 서버의 할 일을 따른다")
                .isEqualTo("붙잡히고 싶은 마음이 먼저였군요.\n그 마음은 어느 대사에서 가장 커요?");
        assertThat(second.reply().status()).isEqualTo("continue");
        var third = loopEngine.reply(second.session(), "상대가 떠나면 안 되니까요", UUID.randomUUID());
        assertThat(third.reply().status()).isEqualTo("continue");
        assertThat(third.session().turns()).extracting(CoachTurnSnapshot::text)
                .noneMatch(text -> text.contains("<설계>") || text.contains("<상태>") || text.contains("<코치>"));
        var statuses = third.session().coachingState().path("practice_loop").path("statuses");
        assertThat(statuses.path(1).asText()).contains("배우의 말: 답", "할 일: 어긋남 보기", "분류: model", "단계: 3", "응답 2번째",
                "첫 답: 붙잡길 바랐던 것 같아요");
        assertThat(statuses.path(2).asText()).contains("할 일: 스스로 찾기", "단계: 4", "응답 3번째", "알아챈 것: 상대가 떠나면 안 되니까요");

        var histories = org.mockito.ArgumentCaptor.forClass(List.class);
        var prompts = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(model, times(3)).reply(eq(file), histories.capture(), prompts.capture());
        var classified = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(model, times(2)).classify(classified.capture(), eq(DirectVideoPrompts.practiceLoopClassifier()), eq(PracticeLoopRouter.SIGNALS));
        assertThat(classified.getAllValues().get(1)).as("분류 AI는 이 세션의 대화 전체를 받는다").containsExactly(
                new DirectVideoModel.Message("model", OPENING_SHOWN),
                new DirectVideoModel.Message("user", "붙잡길 바랐던 것 같아요"),
                new DirectVideoModel.Message("model", "붙잡히고 싶은 마음이 먼저였군요.\n그 마음은 어느 대사에서 가장 커요?"),
                new DirectVideoModel.Message("user", "상대가 떠나면 안 되니까요"));
        assertThat(prompts.getAllValues().get(0)).isEqualTo(DirectVideoPrompts.practiceLoop(first.session().practiceSessionId()));
        assertThat(prompts.getAllValues().get(1)).startsWith(DirectVideoPrompts.practiceLoopTurn())
                .contains("[이번 응답]\n지금 단계: 2/4 보여 주기와 어긋남", "재료", "- 배우가 말한 첫 답: 붙잡길 바랐던 것 같아요",
                        "- 배우가 방금 한 말: 붙잡길 바랐던 것 같아요")
                .doesNotContain("할 일:", "배우의 말:", "지금까지:", "쓰는 법:", "- 어긋남 보기:", "지금 단계: 3/4");
        assertThat(prompts.getAllValues().get(2)).contains("지금 단계: 3/4 스스로 찾기", "- 배우가 말한 첫 답: 붙잡길 바랐던 것 같아요",
                        "- 배우가 말한 알아챈 것: 상대가 떠나면 안 되니까요")
                .doesNotContain("- 스스로 찾기:", "지금 단계: 2/4");
        assertThat(histories.getAllValues().get(0)).isEmpty();
        assertThat(histories.getAllValues().get(1)).containsExactly(
                new DirectVideoModel.Message("model", OPENING),
                new DirectVideoModel.Message("user", "붙잡길 바랐던 것 같아요"));
        assertThat(histories.getAllValues().get(2)).as("지난 상태 칸은 모델에 다시 보여 주지 않는다").containsExactly(
                new DirectVideoModel.Message("model", OPENING),
                new DirectVideoModel.Message("user", "붙잡길 바랐던 것 같아요"),
                new DirectVideoModel.Message("model", "붙잡히고 싶은 마음이 먼저였군요.\n그 마음은 어느 대사에서 가장 커요?"),
                new DirectVideoModel.Message("user", "상대가 떠나면 안 되니까요"));
        assertThat(telemetry.calls()).hasSize(5);
        assertThat(telemetry.calls().get(0).prompt()).isEqualTo(new com.acttub.actingapi.platform.observability.LlmPrompt(
                "coach.practice-loop", DirectVideoPrompts.practiceLoop()));
        assertThat(telemetry.calls()).filteredOn(call -> call.step() == com.acttub.actingapi.platform.observability.LlmStep.COACH_ROUTE)
                .hasSize(2);
    }

    @Test void practiceLoopRewritesOnceWhenTheCoachPointsByVideoTimeAndStripsWhatIsLeft() {
        var loopEngine = practiceLoopEngine();
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING,
                "0:03부터 0:46까지 내내 시선이 아래로 가요.\n그때 속으로는 어땠어요?",
                "\"됐어\" 하고 돌아설 때 시선이 아래로 가요.\n그때 속으로는 어땠어요?");
        var first = loopEngine.start(session(), UUID.randomUUID());
        var second = loopEngine.reply(first.session(), "붙잡길 바랐던 것 같아요", UUID.randomUUID());
        assertThat(second.reply().message()).isEqualTo("\"됐어\" 하고 돌아설 때 시선이 아래로 가요.\n그때 속으로는 어땠어요?");
        var prompts = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(model, times(3)).reply(eq(file), anyList(), prompts.capture());
        assertThat(prompts.getAllValues().get(2)).startsWith(prompts.getAllValues().get(1)).contains("[다시 쓰기]", "영상 시간");
        assertThat(telemetry.calls().getLast().metadata()).containsEntry("timestamp_retry", "true")
                .containsEntry("timestamp_stripped", "false");

        when(model.reply(eq(file), anyList(), anyString())).thenReturn("(0:23) 말끝이 내려가요.\n00:41에도 같아요. 평소에도 그래요?");
        var third = loopEngine.reply(second.session(), "음 잘 모르겠는데 그런 것 같기도 해요", UUID.randomUUID());
        assertThat(third.reply().message()).isEqualTo("말끝이 내려가요.\n같아요. 평소에도 그래요?");
        assertThat(telemetry.calls().getLast().metadata()).containsEntry("timestamp_stripped", "true");
    }

    @Test void timestampDetectionLeavesDurationsAndQuotedLinesAlone() {
        assertThat(DirectVideoPracticeLoop.hasTimestamp("0:23에서 고개를 돌려요")).isTrue();
        assertThat(DirectVideoPracticeLoop.hasTimestamp("12초에 목소리가 커져요")).isTrue();
        assertThat(DirectVideoPracticeLoop.hasTimestamp("At 1:05 you look away")).isTrue();
        assertThat(DirectVideoPracticeLoop.hasTimestamp("2초 정도 쉬어 봐도 좋아요")).isFalse();
        assertThat(DirectVideoPracticeLoop.hasTimestamp("\"13개였어요\"에서 말이 빨라져요")).isFalse();
        assertThat(DirectVideoPracticeLoop.stripTimestamps("0:03부터 0:46까지 시선이 아래로 가요.")).isEqualTo("시선이 아래로 가요.");
        assertThat(DirectVideoPracticeLoop.stripTimestamps("At 1:05 you look away.")).isEqualTo("you look away.");
    }

    @Test void unrelatedModelOutputIsNeverShownAndIsRewrittenOnce() {
        // 2026-10-09 운영: 생각이 한도까지 차 웹페이지 HTML·게임 코드가 나왔고, 줄이기가 그걸 한국어 한 줄로 만들어 보냈다.
        assertThat(DirectVideoPracticeLoop.looksBroken("</article>\n<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0\"><title>I can't access my Google account</title>", null)).isTrue();
        assertThat(DirectVideoPracticeLoop.looksBroken("using System;\nnamespace SinkingTheShip.Player\n{ public class PlayerInputHandler", null)).isTrue();
        assertThat(DirectVideoPracticeLoop.looksBroken("ㅇㄴㄴㅇㄴㄴㅇㄴㄴㅇㄴㄴ", null)).isTrue();
        assertThat(DirectVideoPracticeLoop.looksBroken("A group discussion of the play Mamma Mia! Join the Center", null)).isTrue();
        assertThat(DirectVideoPracticeLoop.looksBroken("아, 그럼 그 장면에선 선생님한테 뭘 하려고 했어요?", null)).isFalse();
        assertThat(DirectVideoPracticeLoop.looksBroken("\"Who knows\"에서 고개가 내려가요. 그때 상대한테 뭘 받고 싶었어요?", null)).isFalse();
        assertThat(DirectVideoPracticeLoop.looksBroken("Then what did you want from her in that scene?", java.util.Locale.ENGLISH)).isFalse();
        assertThat(DirectVideoPracticeLoop.looksBroken("", null)).isFalse();

        var loopEngine = practiceLoopEngine();
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING,
                "</article>\n<footer class=\"footer\"><div class=\"container\">Solución en tecnologías de información</div></footer>",
                "그럼 장면 내내 상대한테 뭘 해 볼래요?");
        var first = loopEngine.start(session(), UUID.randomUUID());
        var second = loopEngine.reply(first.session(), "붙잡길 바랐어요", UUID.randomUUID());
        assertThat(second.reply().message()).isEqualTo("그럼 장면 내내 상대한테 뭘 해 볼래요?");
        var prompts = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(model, times(3)).reply(eq(file), anyList(), prompts.capture());
        assertThat(prompts.getAllValues().get(2)).contains("[다시 쓰기]", "상관없는 글");
        assertThat(telemetry.calls().getLast().metadata()).containsEntry("broken_retry", "true");
        verify(model, never()).reply(isNull(), anyList(), anyString());
    }

    @Test void theCoachIsNotAskedToCountCharacters() {
        // 글자 수를 세라는 지시가 있으면 생각이 끝나지 않고 출력 한도까지 차서 빈 답·엉뚱한 글이 나왔다(2026-10-10 재현).
        assertThat(DirectVideoPrompts.practiceLoopTurn()).doesNotContain("글자 수", "센다");
    }

    @Test void anEmptyCoachReplyIsRewrittenOnceInsteadOfFailingTheTurn() {
        var loopEngine = practiceLoopEngine();
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"not_yet\",\"evaluation\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING)
                .thenThrow(new IllegalStateException("empty video coaching reply"))
                .thenReturn("발성은 영상으론 알기 어려워요.\n\"잡아줘\"에서 작아진 건 일부러예요?");
        var first = loopEngine.start(session(), UUID.randomUUID());
        var second = loopEngine.reply(first.session(), "발성은 어땠어요?", UUID.randomUUID());
        assertThat(second.reply().message()).isEqualTo("발성은 영상으론 알기 어려워요.\n\"잡아줘\"에서 작아진 건 일부러예요?");
        var prompts = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(model, times(3)).reply(eq(file), anyList(), prompts.capture());
        assertThat(prompts.getAllValues().get(2)).contains("[다시 쓰기]", "배우에게 보일 코치의 말이 없었다");
        assertThat(telemetry.calls().getLast().metadata()).containsEntry("empty_retry", "true");

        // 숨은 메모만 쓴 응답도 빈 것으로 보고 다시 쓰게 한다.
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("<생각>\n내 대답: 답하기\n</생각>", "그때 상대한테 뭘 받고 싶었어요?");
        var third = loopEngine.reply(second.session(), "음 그냥 그랬어요", UUID.randomUUID());
        assertThat(third.reply().message()).isEqualTo("그때 상대한테 뭘 받고 싶었어요?");
    }

    @Test void closeReasonsSayWhyTheCoachClosed() {
        var loopEngine = practiceLoopEngine();
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING);
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"stop\"]}");
        var a = loopEngine.start(session(), UUID.randomUUID());
        assertThat(loopEngine.reply(a.session(), "이제 됐어요 감사합니다", UUID.randomUUID()).session().closeReason())
                .as("분류 AI가 그만으로 본 말").isEqualTo("actor_finished");
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}", "{\"signals\":[\"not_yet\",\"method\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING, "고개를 돌려요. 그럼 상대가 봤을까요?", "<다음 테이크>상대를 끝까지 보기</다음 테이크>\n그 마음을 살려요.\n다음엔 상대를 끝까지 봐 보세요.");
        var b = loopEngine.start(session(), UUID.randomUUID());
        var shownB = loopEngine.reply(b.session(), "붙잡길 바랐어요", UUID.randomUUID());
        var wrapped = loopEngine.reply(shownB.session(), "어떻게 하면 돼요?", UUID.randomUUID());
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}");
        assertThat(loopEngine.reply(wrapped.session(), "네", UUID.randomUUID()).session().closeReason())
                .as("정리한 뒤 닫힘(소진)").isEqualTo("interrupted");
    }

    @Test void practiceLoopNoteSummaryLeadsWithTheObservedHabitWhenTheActorLeftNoLine() throws Exception {
        var state = (com.fasterxml.jackson.databind.node.ObjectNode) StructuredJson.MAPPER.readTree("""
                {"practice_loop":{"design":"버릇: 고개를 크게 돌림 | 곳1: x\\n다음 테이크: 상대를 붙잡으려고 해 봐도 좋아요",
                 "statuses":["", "배우의 말: 짧은 답\\n할 일: 파고들기(쉬운)", "배우의 말: 답\\n할 일: 이어보기", "배우의 말: 그만\\n할 일: 끝"]}}
                """);
        var turns = List.of(new CoachTurnSnapshot("ai", "첫 말"), new CoachTurnSnapshot("user", "네"),
                new CoachTurnSnapshot("ai", "속으로는 무서웠어요, 화났어요?"), new CoachTurnSnapshot("user", "무서워할 쪽이요"),
                new CoachTurnSnapshot("ai", "그때 상대한테 뭘 받고 싶었어요?"), new CoachTurnSnapshot("user", "그만"),
                new CoachTurnSnapshot("ai", "오늘은 여기까지 해요. 새 테이크를 올리면 이어서 해요."));
        var note = DirectVideoPracticeLoop.note(session().withTurns(turns).withCoachingState("three_layers_v1", 0, state, "closed", ""), 4);
        assertThat(note.summaryQuotes()).hasSize(1);
        assertThat(note.summaryQuotes().get(0).path("quote").asText()).isEqualTo("고개를 크게 돌림");
        assertThat(note.summaryQuotes().get(0).path("kind").asText()).isEqualTo("observation");
        assertThat(note.summaryQuotes().toString()).as("쉬운 질문의 답은 요약에 올리지 않는다").doesNotContain("무서워할 쪽이요");
    }

    CoachSessionSnapshot writtenSession() {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "빚 독촉 장면", "태식. 센 척함", ".", 8000, "표현", "화술",
                " 화내는 게 다 똑같이 들려요 ", "open", "", List.of(), PriorContext.EMPTY, "legacy", 0, null, null)
                .withCoachingState("three_layers_v1", 0, null, "open", "");
    }

    @Test void practiceLoopGetsWhatTheActorWroteBeforeItsPrompt() {
        var loopEngine = practiceLoopEngine();
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING);
        var written = writtenSession();
        loopEngine.start(written, UUID.randomUUID());
        verify(model).reply(eq(file), anyList(), eq("""
                ## 배우가 적은 것
                이번 연습을 올리며 배우가 적은 것이다. 영상 근거가 아니다.
                - 상황: 빚 독촉 장면
                - 인물: 태식. 센 척함
                - 막힌 곳: 표현 · 화술
                - 막힌 곳 설명: 화내는 게 다 똑같이 들려요

                """ + DirectVideoPrompts.practiceLoop(written.practiceSessionId())));
    }

    @Test void videoOnlySessionGetsNoActorMaterialBlock() {
        assertThat(DirectVideoPracticeLoop.actorMaterial(session())).isEmpty();
    }

    @Test void practiceLoopWrapsUpThenClosesAndStopsRightAwayOnStop() {
        var loopEngine = practiceLoopEngine();
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING);
        var first = loopEngine.start(session(), UUID.randomUUID());
        clearInvocations(model, videos);
        // 문제를 보여 준 뒤(3단계)에 방법을 물으면 정리한다.
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}", "{\"signals\":[\"not_yet\",\"method\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("\"가\" 할 때 상대를 안 봐요. 그럼 상대가 잡았을까요?",
                "<다음 테이크>\"가\"에서 상대가 잡을 때까지 기다렸다 말하기</다음 테이크>\n기다리는 그 마음이 장면의 힘이에요.\n\"가\"에서 상대가 잡을 때까지 기다렸다 말해 보세요.");
        var shown = loopEngine.reply(first.session(), "붙잡아 줬으면 했어요", UUID.randomUUID());
        var wrapped = loopEngine.reply(shown.session(), "그럼 어떻게 하면 돼요?", UUID.randomUUID());
        assertThat(wrapped.reply().status()).as("정리한 응답은 아직 닫지 않는다").isEqualTo("continue");
        assertThat(wrapped.reply().message()).startsWith("기다리는 그 마음이").doesNotContain("<다음 테이크>");
        assertThat(wrapped.session().coachingState().path("practice_loop").path("statuses").path(2).asText())
                .contains("배우의 말: 방법 요청", "할 일: 정리하기", "다음 테이크: \"가\"에서 상대가 잡을 때까지 기다렸다 말하기");
        clearInvocations(model, videos);
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}");
        var done = loopEngine.reply(wrapped.session(), "네 해볼게요", UUID.randomUUID());
        assertThat(done.reply().status()).isEqualTo("complete");
        assertThat(done.reply().message()).isEqualTo("오늘은 여기까지 해요. 새 테이크를 올리면 이어서 해요.");
        StructuredJson.validate("coach_handoff_v2", done.reply().handoff());
        verify(model, never()).reply(any(), anyList(), anyString());
        verify(model, never()).upload(any(), anyString());

        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING);
        var opened = loopEngine.start(session(), UUID.randomUUID());
        clearInvocations(model, videos);
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"stop\"]}");
        var stopped = loopEngine.reply(opened.session(), "그만", UUID.randomUUID());
        assertThat(stopped.session().closeReason()).isEqualTo("actor_finished");
        assertThat(stopped.reply().message()).isEqualTo("오늘은 여기까지 해요. 새 테이크를 올리면 이어서 해요.");
        assertThat(stopped.session().coachingState().path("practice_loop").path("statuses").path(1).asText())
                .contains("배우의 말: 그만", "할 일: 끝", "분류: model");
        verify(model).classify(anyList(), anyString(), anyList());
        verify(model, never()).reply(any(), anyList(), anyString());
        verify(model, never()).upload(any(), anyString());
        verifyNoInteractions(videos);
    }

    @Test void practiceLoopNoteKeepsTheDesignNextTakeWhenTheActorLeftNoLine() throws Exception {
        var state = (com.fasterxml.jackson.databind.node.ObjectNode) StructuredJson.MAPPER.readTree("""
                {"practice_loop":{"design":"버릇: 고개를 크게 돌림 | 곳1: x\\n다음 테이크: \\"잡아줘\\"에서 상대를 붙잡으려고 해 봐도 좋아요",
                 "statuses":["", "배우의 말: 답\\n할 일: 파고들기", "배우의 말: 그만\\n할 일: 끝"]}}
                """);
        var turns = List.of(new CoachTurnSnapshot("ai", "첫 말"), new CoachTurnSnapshot("user", "음 잘 모르겠어요 그냥 했어요"),
                new CoachTurnSnapshot("ai", "그때 상대한테 뭘 받고 싶었어요?"), new CoachTurnSnapshot("user", "그만"),
                new CoachTurnSnapshot("ai", "오늘은 여기까지 해요. 새 테이크를 올리면 이어서 해요."));
        var note = DirectVideoPracticeLoop.note(session().withTurns(turns).withCoachingState("three_layers_v1", 0, state, "closed", ""), 3);
        assertThat(note).isNotNull();
        assertThat(note.title()).isEqualTo("고개를 크게 돌림");
        assertThat(note.nextTake()).isEqualTo("\"잡아줘\"에서 상대를 붙잡으려고 해 봐도 좋아요");
    }

    @Test void thinkingNotesAndLongRepliesAreKeptOffTheActorsScreen() {
        var loopEngine = practiceLoopEngine();
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}");
        String longReply = "차분한 톤과 담담한 표정이 잘 어울려요. \"다 뒤져 있더라\"에서 목소리가 잦아드는 것도 좋고요. 위를 본 건 인물의 습관일까요?";
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING,
                "<생각>\n배우가 한 말: 붙잡고 싶었다\n끝 질문: 무엇을\n</생각>\n" + longReply);
        when(model.reply(isNull(), anyList(), anyString())).thenReturn("\"다 뒤져 있더라\"에서 목소리가 잦아들어요.\n위를 본 건 습관인가요?");
        var first = loopEngine.start(session(), UUID.randomUUID());
        var second = loopEngine.reply(first.session(), "붙잡길 바랐던 것 같아요", UUID.randomUUID());
        assertThat(DirectVideoPracticeLoop.displayLength(longReply)).isGreaterThan(DirectVideoPracticeLoop.LONG_REPLY);
        assertThat(second.reply().message()).isEqualTo("\"다 뒤져 있더라\"에서 목소리가 잦아들어요.\n위를 본 건 습관인가요?");
        assertThat(second.session().turns()).extracting(CoachTurnSnapshot::text).noneMatch(text -> text.contains("생각"));
        var shortenCalls = org.mockito.ArgumentCaptor.forClass(List.class);
        // 첫 응답(질문 한 문장)은 짧아서 그대로, 둘째 응답만 줄이기를 거친다.
        verify(model, times(1)).reply(isNull(), shortenCalls.capture(), eq(DirectVideoPrompts.practiceLoopShorten(null)));
        assertThat(shortenCalls.getAllValues().get(0)).containsExactly(new DirectVideoModel.Message("user", longReply));
        assertThat(telemetry.calls().getLast().metadata()).containsEntry("shorten_calls", "1");
        assertThat(DirectVideoPracticeLoop.parse("<생각>\n배우가 한 말: x\n글자 수: 30\n괜찮아요. 왜요?").message())
                .as("닫는 태그를 빠뜨려도 메모 줄은 걷어낸다").isEqualTo("괜찮아요. 왜요?");
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

    @Test void practiceLoopReadsTheActionFromTheMultiLineStatus() {
        var closing = DirectVideoPracticeLoop.parse("""
                <상태>
                배우의 말: 자기 한 줄
                지금까지: 같은 버릇 질문 3번 · 짚어주기 1번 · 응답 6번째
                피할 것: 없음
                할 일: 마무리2
                물을 것: 없음
                </상태>
                그대로 적어 둘게요.""");
        assertThat(DirectVideoPracticeLoop.finished(closing)).isTrue();
        assertThat(closing.message()).isEqualTo("그대로 적어 둘게요.");
        assertThat(DirectVideoPracticeLoop.finished(DirectVideoPracticeLoop.parse(
                "<상태>\n배우의 말: 그만\n할 일: [끝]\n물을 것: 없음\n</상태>\n오늘은 여기까지 해요."))).isTrue();
        // 지금까지 줄의 "짚어주기 1번"이나 배우의 말이 아니라 할 일 줄만 본다.
        assertThat(DirectVideoPracticeLoop.finished(DirectVideoPracticeLoop.parse("""
                <상태>
                배우의 말: 반박
                지금까지: 같은 버릇 질문 3번 · 짚어주기 0번 · 응답 5번째
                피할 것: 말 빠르기
                할 일: 짚어주기(다른 쪽)
                물을 것: 이 장점을 어느 대사에서 더 쓰고 싶어요?
                </상태>
                이 장점을 어느 대사에서 더 쓰고 싶어요?"""))).isFalse();
    }

    @Test void practiceLoopNoteKeepsASelfLineTheActorOfferedBeforeBeingAsked() throws Exception {
        var state = (com.fasterxml.jackson.databind.node.ObjectNode) StructuredJson.MAPPER.readTree("""
                {"revision":4,"practice_loop":{"design":"버릇: 말이 내내 같은 속도로 빨라요 | 곳1: x\\n다음 테이크: 문장 사이에 한 번씩 쉬기",
                "statuses":["",
                "배우의 말: 답\\n지금까지: 같은 버릇 질문 2번 · 짚어주기 0번 · 응답 2번째\\n피할 것: 없음\\n할 일: 파고들기\\n물을 것: 속으로는 어땠어요?",
                "배우의 말: 답\\n지금까지: 같은 버릇 질문 3번 · 짚어주기 0번 · 응답 3번째\\n피할 것: 없음\\n할 일: 이어보기\\n물을 것: 인물에게 맞을까요?",
                "배우의 말: 자기 한 줄\\n지금까지: 같은 버릇 질문 3번 · 짚어주기 0번 · 응답 4번째\\n피할 것: 없음\\n할 일: 마무리2\\n물을 것: 없음"]}}
                """);
        var turns = List.of(new CoachTurnSnapshot("ai", "말이 내내 빨라요."), new CoachTurnSnapshot("actor", "원래 빨라서 지적을 받아요"),
                new CoachTurnSnapshot("ai", "속으로는 어땠어요?"), new CoachTurnSnapshot("actor", "사이가 비면 연기가 끊긴 것 같아서요"),
                new CoachTurnSnapshot("ai", "인물에게 맞을까요?"), new CoachTurnSnapshot("actor", "빈틈이 무서워서 말로 채우는 배우"),
                new CoachTurnSnapshot("ai", "그대로 적어 둘게요."));
        var closed = session().withTurns(turns).withCoachingState("three_layers_v1", 4, state, "closed", "interrupted");
        var note = DirectVideoPracticeLoop.note(closed, 4);
        assertThat(note.summaryQuotes()).hasSize(2);
        assertThat(note.summaryQuotes().get(0).path("quote").asText()).isEqualTo("빈틈이 무서워서 말로 채우는 배우");
        assertThat(note.summaryQuotes().get(0).path("source_ref").asText()).isEqualTo(StructuredCoachEngine.turnId(closed, 5));
        assertThat(note.summaryQuotes().get(1).path("quote").asText()).isEqualTo("사이가 비면 연기가 끊긴 것 같아서요");
        assertThat(note.nextTake()).isEqualTo("문장 사이에 한 번씩 쉬기");
    }

    /** SOMA-601: 한 줄을 청한 자리에서 배우가 평가를 청하면 그 말은 배우의 한 줄이 아니다(운영 5670f93d). */
    @Test void practiceLoopNoteSkipsAnEvaluationRequestGivenWhereTheSelfLineWasAsked() throws Exception {
        var state = (com.fasterxml.jackson.databind.node.ObjectNode) StructuredJson.MAPPER.readTree("""
                {"revision":4,"practice_loop":{"design":"버릇: 눈을 천천히 깜빡임 | 곳1: x\\n다음 테이크: 상대를 끝까지 보기",
                "statuses":["",
                "배우의 말: 답\\n할 일: 마무리1",
                "배우의 말: 평가 요청\\n할 일: 짚어주기",
                "배우의 말: 그만\\n할 일: 끝"]}}
                """);
        var turns = List.of(new CoachTurnSnapshot("ai", "눈을 천천히 깜빡여요."), new CoachTurnSnapshot("actor", "상대가 있다고 생각했어요"),
                new CoachTurnSnapshot("ai", "한 줄로 적는다면 뭐라고 쓸래요?"),
                new CoachTurnSnapshot("actor", "모르겠습니다,,,,그리고 제 연기 전체적으로 어떤지 평가받고 싶어요"),
                new CoachTurnSnapshot("ai", "제일 아쉬운 건 깜빡임이에요."), new CoachTurnSnapshot("actor", "그만"),
                new CoachTurnSnapshot("ai", "오늘은 여기까지 해요."));
        var closed = session().withTurns(turns).withCoachingState("three_layers_v1", 4, state, "closed", "interrupted");
        var note = DirectVideoPracticeLoop.note(closed, 4);
        assertThat(note.summaryQuotes()).extracting(q -> q.path("quote").asText())
                .doesNotContain("모르겠습니다,,,,그리고 제 연기 전체적으로 어떤지 평가받고 싶어요");
    }

    /** SOMA-601: 한 줄을 청한 뒤 딱릴 이야기가 오고, 나중에 자기 한 줄이 따로 오면 나중 것이 한 줄이다(운영 3803ca80). */
    @Test void practiceLoopNotePrefersALaterSelfLineOverAnOffTopicAnswerToTheAsk() throws Exception {
        var state = (com.fasterxml.jackson.databind.node.ObjectNode) StructuredJson.MAPPER.readTree("""
                {"revision":4,"practice_loop":{"design":"버릇: 고개를 크게 움직임 | 곳1: x\\n다음 테이크: 엄마를 끝까지 보기",
                "statuses":["",
                "배우의 말: 답\\n할 일: 마무리1",
                "배우의 말: 답\\n할 일: 이어보기",
                "배우의 말: 자기 한 줄\\n할 일: 마무리2"]}}
                """);
        var turns = List.of(new CoachTurnSnapshot("ai", "고개를 크게 움직여요."), new CoachTurnSnapshot("actor", "마주하기 어려워서요"),
                new CoachTurnSnapshot("ai", "한 줄로 적는다면 뭐라고 쓸래요?"),
                new CoachTurnSnapshot("actor", "오늘 대학교 시험을 봤는데, 뭔가 집중을 잘 못한거 같아"),
                new CoachTurnSnapshot("ai", "집중하기 어려웠군요."),
                new CoachTurnSnapshot("actor", "아직 인물에 맞는 행동들이 자연스럽게 나오지 않는거 같다"),
                new CoachTurnSnapshot("ai", "그대로 적어 둘게요."));
        var closed = session().withTurns(turns).withCoachingState("three_layers_v1", 4, state, "closed", "interrupted");
        var note = DirectVideoPracticeLoop.note(closed, 4);
        assertThat(note.summaryQuotes().get(0).path("quote").asText()).isEqualTo("아직 인물에 맞는 행동들이 자연스럽게 나오지 않는거 같다");
    }

    /** SOMA-601: 배우의 말 분류가 없던 옛 한 줄 상태에서도 장단점을 묻는 말은 한 줄이 아니다(운영 d72194af). */
    @Test void practiceLoopNoteSkipsARequestInOldOneLineStatuses() throws Exception {
        var state = (com.fasterxml.jackson.databind.node.ObjectNode) StructuredJson.MAPPER.readTree("""
                {"revision":3,"practice_loop":{"design":"버릇: 말이 내내 빨라요 | 곳1: x\\n다음 테이크: 문장 사이 쉬기",
                "statuses":["", "마무리1 · 응답 2번째", "끝 · 응답 3번째"]}}
                """);
        var turns = List.of(new CoachTurnSnapshot("ai", "말이 빨라요."), new CoachTurnSnapshot("actor", "원래 빨라요"),
                new CoachTurnSnapshot("ai", "한 줄로 적는다면?"),
                new CoachTurnSnapshot("actor", "저의 연기적 장점과 단점은 무엇일까요?"),
                new CoachTurnSnapshot("ai", "오늘은 여기까지 해요."));
        var closed = session().withTurns(turns).withCoachingState("three_layers_v1", 3, state, "closed", "interrupted");
        var note = DirectVideoPracticeLoop.note(closed, 3);
        assertThat(note.summaryQuotes()).extracting(q -> q.path("quote").asText())
                .doesNotContain("저의 연기적 장점과 단점은 무엇일까요?");
    }

    /** SOMA-602: 세션.md — 이번 목표, 선택 설명을 우선한 이유, 배우가 아니라고 한 것이 노트와 다음 회차 줄에 남는다. */
    @Test void practiceLoopRoundKeepsGoalChoiceReasonAndCorrections() throws Exception {
        var state = (com.fasterxml.jackson.databind.node.ObjectNode) StructuredJson.MAPPER.readTree("""
                {"revision":5,"practice_loop":{"design":"이번 목표: 한 문장 끝에 엄마를 끝까지 보기\\n버릇: 고개를 양옆으로 크게 움직임 | 곳1: x\\n다음 테이크: 손을 꽉 쥐고 엄마를 노려보기",
                "statuses":["",
                "배우의 말: 정정\\n피할 것: 시선\\n이번 목표: 한 문장 끝에 엄마를 끝까지 보기\\n할 일: 내려놓기",
                "배우의 말: 선택 설명\\n피할 것: 시선\\n할 일: 파고들기",
                "배우의 말: 짧은 답\\n피할 것: 시선\\n할 일: 마무리1",
                "배우의 말: 자기 한 줄\\n할 일: 마무리2"]}}
                """);
        var turns = List.of(new CoachTurnSnapshot("ai", "지난번엔 엄마를 끝까지 보기로 했어요."), new CoachTurnSnapshot("actor", "렌즈 본 거예요"),
                new CoachTurnSnapshot("ai", "그러면 제가 잘못 봤어요."), new CoachTurnSnapshot("actor", "트라우마 때문에 마주하기 어려워서 일부러 돌렸어"),
                new CoachTurnSnapshot("ai", "언제 고개가 돌아가요?"), new CoachTurnSnapshot("actor", "그렇지"),
                new CoachTurnSnapshot("ai", "한 줄로 적는다면요?"), new CoachTurnSnapshot("actor", "아직 행동이 자연스럽게 안 나온다"),
                new CoachTurnSnapshot("ai", "그대로 적어 둘게요."));
        var closed = session().withTurns(turns).withCoachingState("three_layers_v1", 5, state, "closed", "interrupted");
        var note = DirectVideoPracticeLoop.note(closed, 5);
        assertThat(note.summaryQuotes()).extracting(q -> q.path("quote").asText())
                .containsExactly("아직 행동이 자연스럽게 안 나온다", "트라우마 때문에 마주하기 어려워서 일부러 돌렸어");
        assertThat(note.corrections()).extracting(com.fasterxml.jackson.databind.JsonNode::asText).containsExactly("시선: \"렌즈 본 거예요\"");
        var line = PracticeLoopRound.line(2, note.title(), note.nextTake(), state,
                turns.stream().map(t -> new PracticeLoopRound.Turn(t.role(), t.text())).toList());
        assertThat(line).isEqualTo("2차: 목표 한 문장 끝에 엄마를 끝까지 보기 — 버릇 고개를 양옆으로 크게 움직임"
                + " (이유: \"트라우마 때문에 마주하기 어려워서 일부러 돌렸어\") — 아니라고 한 것: 시선: \"렌즈 본 거예요\""
                + " — 제안: 손을 꽉 쥐고 엄마를 노려보기");
    }

    /** SOMA-603: 기억 갱신 재료 — 배우 말에 코치가 붙인 분류, 다시 말하지 않을 것에 쌓일 정정. */
    @Test void practiceLoopRoundLabelsActorWordsAndListsCorrections() throws Exception {
        var state = StructuredJson.MAPPER.readTree("""
                {"practice_loop":{"design":"버릇: 고개를 크게 돌림 | 곳1: x",
                 "statuses":["","배우의 말: 정정\\n피할 것: 시선\\n할 일: 내려놓기","배우의 말: 평가 요청(장점)\\n할 일: 짚어주기"]}}
                """);
        var turns = List.of(new PracticeLoopRound.Turn("ai", "a"), new PracticeLoopRound.Turn("actor", "렌즈 본 거예요"),
                new PracticeLoopRound.Turn("ai", "b"), new PracticeLoopRound.Turn("actor", "평가해 주세요"),
                new PracticeLoopRound.Turn("ai", "c"));
        assertThat(PracticeLoopRound.classifiedActorWords(state, turns))
                .containsExactly("(정정) 렌즈 본 거예요", "(평가 요청) 평가해 주세요");
        assertThat(PracticeLoopRound.corrections(state, turns)).containsExactly("시선: \"렌즈 본 거예요\"");
        assertThat(PracticeLoopRound.classifiedActorWords(StructuredJson.MAPPER.readTree("{}"), turns))
                .containsExactly("렌즈 본 거예요", "평가해 주세요");
    }

    /** 연습 루프 상태가 없으면 예전 줄을 쓰도록 null 이다. */
    @Test void practiceLoopRoundIsNullWithoutLoopState() throws Exception {
        assertThat(PracticeLoopRound.line(1, "제목", "제안", StructuredJson.MAPPER.readTree("{}"), List.of())).isNull();
    }

    /** 연습 루프의 기억 머리말은 지난 기록을 목표 후보로 쓰게 한다. 다른 경로는 그대로다. */
    @Test void priorContextHeaderTurnsIntoGoalCandidatesOnlyForThePracticeLoop() {
        var prior = new PriorContext(java.util.Map.of("goal", "입시"), null, false, List.of(), List.of("1차: 버릇 — 제안: x"));
        assertThat(CoachPrompt.priorContextBlock(prior, true, true)).contains("이번 연습의 목표 후보를 고르는 데 쓴다")
                .doesNotContain("지난 기록을 이번 장면의 목표·의도로 확정하지 않는다");
        assertThat(CoachPrompt.priorContextBlock(prior, true)).contains("지난 기록을 이번 장면의 목표·의도로 확정하지 않는다");
    }

    @Test void practiceLoopShufflesTheFourHabitLinesPerPractice() {
        var practice = UUID.fromString("00000000-0000-0000-0000-000000000001");
        assertThat(DirectVideoPrompts.practiceLoop(practice)).isEqualTo(DirectVideoPrompts.practiceLoop(practice));
        assertThat(DirectVideoPrompts.practiceLoop(null)).isEqualTo(DirectVideoPrompts.practiceLoop());
        var names = List.of("감정의 변화: [", "상대와 주고받기: [", "원하는 것과 행동: [", "몸·시선·표정: [");
        var orders = new java.util.HashSet<String>();
        for (long i = 1; i <= 24; i++) {
            String prompt = DirectVideoPrompts.practiceLoop(new UUID(i, i * 31));
            int stuck = prompt.indexOf("막힌 곳: [");
            for (String name : names) {
                assertThat(prompt.indexOf(name)).as(name).isPositive().isLessThan(stuck);
                assertThat(prompt.indexOf(name)).isEqualTo(prompt.lastIndexOf(name));
            }
            orders.add(names.stream().sorted(java.util.Comparator.comparingInt(prompt::indexOf))
                    .collect(java.util.stream.Collectors.joining()));
        }
        assertThat(orders).hasSizeGreaterThan(3);
    }

    @Test void practiceLoopPicksThePromptByTheClassifiedLanguage() {
        var englishMemo = new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "In a garden with crush", "A young girl 17 out to clear her head", "",
                8000, "그 외", "그 외", null, "open", "", List.of(), PriorContext.EMPTY, "legacy", 0, null, null)
                .withCoachingState("three_layers_v1", 0, null, "open", "");
        assertThat(DirectVideoPracticeLoop.replyLanguage(session(), null)).as("메모·답 없음").isNull();
        assertThat(DirectVideoPracticeLoop.replyLanguage(writtenSession(), "네 그런 편이에요")).isNull();
        assertThat(DirectVideoPracticeLoop.replyLanguage(englishMemo, null)).as("영어 메모만 있어도 첫 질문부터").isEqualTo(Locale.ENGLISH);
        assertThat(DirectVideoPracticeLoop.replyLanguage(englishMemo, "그만")).as("종료 말은 건너뛴다").isEqualTo(Locale.ENGLISH);
        assertThat(DirectVideoPracticeLoop.replyLanguage(englishMemo, "한국어로 해 주세요")).isNull();
        assertThat(DirectVideoPracticeLoop.replyLanguage(session(), "i want help making it flow better")).isEqualTo(Locale.ENGLISH);
        assertThat(DirectVideoPracticeLoop.replyLanguage(session(), "もっと自然にしたいです")).isEqualTo(Locale.JAPANESE);
        assertThat(DirectVideoPracticeLoop.replyLanguage(session(), "\"peaceful\" 부분이 어려워요")).isNull();
        org.springframework.context.i18n.LocaleContextHolder.setLocale(Locale.ENGLISH);
        try {
            assertThat(DirectVideoPracticeLoop.replyLanguage(writtenSession(), null)).as("앱이 영어면 앱 언어").isEqualTo(Locale.ENGLISH);
        } finally {
            org.springframework.context.i18n.LocaleContextHolder.resetLocaleContext();
        }

        var id = UUID.randomUUID();
        assertThat(DirectVideoPrompts.practiceLoop(id, null)).as("한국어는 한국어판 그대로").isEqualTo(DirectVideoPrompts.practiceLoop(id));
        assertThat(DirectVideoPrompts.practiceLoop(id, Locale.KOREAN)).isEqualTo(DirectVideoPrompts.practiceLoop(id));
        String english = DirectVideoPrompts.practiceLoop(id, Locale.ENGLISH);
        assertThat(english).contains("Every word the actor reads is in natural", "at most 16 coach replies")
                .doesNotContain("[Output language]");
        assertThat(DirectVideoPrompts.practiceLoop(id, Locale.JAPANESE)).contains("Every word the actor reads", "[Output language]", "Japanese");
        // 서버가 읽는 숨은 칸 이름은 영어판에도 한국어로 있다. 할 일 표·상태 칸은 이제 프롬프트에 없다.
        assertThat(english).contains("<설계>", "버릇: [", "다음 테이크: [").doesNotContain("<상태>", "Action table", "배우의 말: [");
        assertThat(DirectVideoPrompts.practiceLoopTurn(Locale.ENGLISH)).isEqualTo(DirectVideoPrompts.practiceLoopTurnEnglish())
                .contains("[This reply]", "Never write Korean to the actor");
        assertThat(DirectVideoPrompts.practiceLoopTurn(Locale.JAPANESE)).contains("[Output language]", "Japanese");
        assertThat(DirectVideoPrompts.practiceLoopTurn(null)).isEqualTo(DirectVideoPrompts.practiceLoopTurn());
        assertThat(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.WRAP_UP, Locale.ENGLISH)).contains("<다음 테이크>");
        for (String name : List.of("감정의 변화: [", "상대와 주고받기: [", "원하는 것과 행동: [", "몸·시선·표정: [")) {
            assertThat(english.indexOf(name)).as(name).isEqualTo(english.lastIndexOf(name)).isPositive();
        }
    }

    CoachSessionSnapshot sessionWithDuration(int durationMs) {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", durationMs, "그 외", "그 외", null, "open", "", List.of(),
                PriorContext.EMPTY, "legacy", 0, null, null).withCoachingState("three_layers_v1", 0, null, "open", "");
    }

    @Test void practiceLoopCutsAVideoTooShortToHoldActingWithoutCallingTheModel() {
        var loopEngine = practiceLoopEngine();
        var result = loopEngine.start(sessionWithDuration(1300), UUID.randomUUID());
        assertThat(result.reply().message()).startsWith("이 영상에서는 연기 장면을 찾지 못했어요.");
        assertThat(result.session().closeReason()).isEqualTo("interrupted");
        assertThat(DirectVideoPracticeLoop.wasCut(result.session().coachingState())).isTrue();
        assertThat(DirectVideoPracticeLoop.note(result.session(), 1)).as("끊은 세션은 노트가 없다").isNull();
        verify(model, never()).reply(any(), anyList(), anyString());
        assertThat(DirectVideoPracticeLoop.tooShort(sessionWithDuration(0))).as("길이를 모르면 모델에 맡긴다").isFalse();
        assertThat(DirectVideoPracticeLoop.tooShort(sessionWithDuration(3000))).isFalse();
    }

    @Test void practiceLoopCutsWhenTheModelSaysItIsNotAnActingVideo() {
        var loopEngine = practiceLoopEngine();
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(
                "<설계>\n영상: 연기 아님: 화면이 검고 음악과 잡음만 들린다\n</설계>\n<코치>\n없음\n</코치>");
        var result = loopEngine.start(sessionWithDuration(6600), UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo("이 영상에서는 연기 장면을 찾지 못했어요.\n연기한 장면이 담긴 영상을 다시 올려 주세요.");
        assertThat(result.reply().status()).isEqualTo("complete");
        assertThat(result.session().closeReason()).isEqualTo("interrupted");
        assertThat(result.session().turns()).extracting(CoachTurnSnapshot::text).noneMatch(text -> text.contains("없음"));
        assertThat(DirectVideoPracticeLoop.note(result.session(), 1)).isNull();

        when(model.reply(eq(file), anyList(), anyString())).thenReturn(
                "<설계>\n영상: 연기\n버릇: 손이 자주 가슴으로 가요 | 곳1: x | 곳2: y\n다음 테이크: 손 내리기\n</설계>\n<코치>\n손이 자주 가슴으로 가요.\n인물이라 그럴 수도 있어요.\n평소에도 그런 편이에요?\n</코치>");
        var acting = loopEngine.start(sessionWithDuration(6600), UUID.randomUUID());
        assertThat(acting.reply().status()).as("짧아도 연기면 코칭한다").isEqualTo("continue");
        assertThat(DirectVideoPracticeLoop.wasCut(acting.session().coachingState())).isFalse();
        assertThat(DirectVideoPrompts.practiceLoop()).contains("영상: [연기 / 연기 아님", "애매하면 연기로 본다");
        assertThat(DirectVideoPrompts.practiceLoopEnglish()).contains("영상: [연기 / 연기 아님", "If unsure, treat it as acting");
    }

    @Test void audioOnlyActingCanContinueCloseAndCreateAnAudioGroundedNote() {
        var voice = new DirectVideoModel.Video("files/voice", "gemini://voice", "video/mp4", true);
        when(model.inspect(any())).thenReturn(new DirectVideoModel.InputInspection(true, null));
        when(model.upload(any(), eq("video/mp4"), any())).thenReturn(voice);
        when(model.upload(any(), eq("video/mp4"))).thenReturn(voice);
        when(model.ready(voice)).thenReturn(true);
        when(model.reply(eq(voice), anyList(), anyString())).thenReturn("""
                <설계>
                영상: 연기: 화면은 검지만 독백 연기가 들린다
                관찰 근거: 음성만
                대사 확인: 확인됨
                확인된 대사: 제발 / 한 번만
                감정의 변화: 두 부탁에서 애원하는 감정이 들린다 · 뚜렷함 2
                상대와 주고받기: 없음(화면 확인 안 됨) · 뚜렷함 0
                원하는 것과 행동: 머물러 주기를 바라며 두 번 애원한다 · 뚜렷함 3
                몸·시선·표정: 없음(화면 확인 안 됨) · 뚜렷함 0
                버릇: 부탁이 거절될 때 더 애원해요 | 곳1: 제발 | 곳2: 한 번만
                다음 테이크: 같은 부탁을 달래듯 말해 보기
                </설계>
                <코치>
                두 부탁에서 더 애원하는 쪽으로 들려요.
                이 인물의 선택일 수도 있어요.
                평소에도 그런 편이에요?
                </코치>
                """, """
                <다음 테이크>같은 부탁을 달래듯 말해 보기</다음 테이크>
                나는 부탁이 거절되면 더 애원하는 배우다라고 적어 둘게요.
                다음 테이크에서는 달래듯 말해 봐도 좋아요.
                오늘은 여기까지 해요. 새 테이크를 올리면 이어서 해요.
                """);
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}", "{\"signals\":[\"not_yet\",\"method\"]}", "{\"signals\":[\"not_yet\"]}");
        var loopEngine = practiceLoopEngine();
        var first = loopEngine.start(session(), UUID.randomUUID());
        assertThat(first.reply().status()).isEqualTo("continue");
        assertThat(DirectVideoPracticeLoop.wasCut(first.session().coachingState())).isFalse();
        assertThat(first.session().coachingState().path("practice_loop").path("design").asText())
                .contains("관찰 근거: 음성만", "없음(화면 확인 안 됨)");
        assertThat(first.reply().message()).endsWith("?").doesNotContain("<설계>", "표정", "시선", "고개");
        var shownA = loopEngine.reply(first.session(), "머물러 주길 바랐어요", UUID.randomUUID());
        var wrapped = loopEngine.reply(shownA.session(), "나는 부탁이 거절되면 더 애원하는 배우다", UUID.randomUUID());
        assertThat(wrapped.reply().status()).isEqualTo("continue");
        var done = loopEngine.reply(wrapped.session(), "네", UUID.randomUUID());
        assertThat(done.reply().status()).isEqualTo("complete");
        assertThat(done.session().coachingState().path("practice_loop").path("statuses").toString())
                .contains("관찰 근거: 음성만");
        var note = DirectVideoPracticeLoop.note(done.session(), 2);
        assertThat(note).isNotNull();
        assertThat(note.nextTake()).isEqualTo("같은 부탁을 달래듯 말해 보기");
        assertThat(note.toString()).doesNotContain("표정", "시선", "고개");
        verify(model, times(3)).classify(anyList(), anyString(), anyList());
    }

    @Test void audibleNonActingStillCutsCoachingAndDoesNotCreateANote() {
        var voice = new DirectVideoModel.Video("files/chat", "gemini://chat", "video/mp4", true);
        when(model.upload(any(), eq("video/mp4"))).thenReturn(voice);
        when(model.ready(voice)).thenReturn(true);
        when(model.reply(eq(voice), anyList(), anyString())).thenReturn(
                "<설계>영상: 연기 아님: 인물 연기 없이 사용법을 설명하는 강의</설계><코치>없음</코치>");
        var result = practiceLoopEngine().start(session(), UUID.randomUUID());
        assertThat(result.reply().status()).isEqualTo("complete");
        assertThat(DirectVideoPracticeLoop.wasCut(result.session().coachingState())).isTrue();
        assertThat(DirectVideoPracticeLoop.note(result.session(), 1)).isNull();
        assertThat(result.reply().message()).startsWith("이 영상에서는 연기 장면을 찾지 못했어요.");
    }

    @Test void bothPromptsSeparateScreenVisibilityFromActingAndLimitAudioOnlyObservations() {
        String korean = DirectVideoPrompts.practiceLoop();
        assertThat(korean).contains("화면 유무와 연기 여부는 별개다", "목소리가 있다는 이유만으로 모두 연기는 아니다",
                "일상 잡담·정보 설명·뉴스·강의", "배경 음악·잡음만", "애매하면 연기로 본다",
                "없음(화면 확인 안 됨) · 뚜렷함 0", "표정, 시선, 자세, 몸동작", "감정의 변화와 원하는 것과 행동",
                "숨은 설계, 후속 평가, 반박과 노트용 다음 테이크");
        String english = DirectVideoPrompts.practiceLoopEnglish();
        assertThat(english).contains("Screen visibility and acting eligibility are separate",
                "A voice alone does not prove acting", "everyday chat, informational explanation, news or a lecture",
                "only background music/noise", "If unsure, treat it as acting", "Never invent face, gaze, posture, movement",
                "follow-up evaluation, pushback, closing and the next-take field used for notes");
        for (String prompt : List.of(korean, english, DirectVideoPrompts.practiceLoop(UUID.randomUUID()))) {
            assertThat(prompt).contains("관찰 근거: [", "음성만", "없음(화면 확인 안 됨)");
            assertThat(prompt.indexOf("관찰 근거: [")).isLessThan(prompt.indexOf("감정의 변화: ["));
        }
        assertThat(DirectVideoPrompts.practiceLoopTurn()).contains("대사 확인", "확인 안 됨", "소리만 있는 영상");
        assertThat(DirectVideoPrompts.practiceLoopTurnEnglish()).contains("관찰 근거", "대사 확인", "음성만", "확인 안 됨");
        assertThat(korean).doesNotContain("아래는 연기가 아니다: 화면이 검거나");
        assertThat(english).doesNotContain("These are not acting: a black screen");
        assertThat(DirectVideoPrompts.common()).contains("음성 연기는 연기로 다룬다", "관찰할 수 없다고 두며");
    }

    @Test void practiceLoopPromptLooksBeyondTempo() {
        assertThat(DirectVideoPrompts.practiceLoop())
                .contains("감정의 변화: [", "상대와 주고받기: [", "원하는 것과 행동: [", "몸·시선·표정: [",
                        "소리와 템포는 보지 않는다")
                .doesNotContain("소리 빠르기: [", "소리 쉬는 곳: [");
    }

    @Test void practiceLoopNoteUsesTheNextTakeTheCoachSettledOnWhenClosing() throws Exception {
        var statuses = (com.fasterxml.jackson.databind.node.ArrayNode) StructuredJson.MAPPER.readTree("""
                ["", "배우의 말: 답\\n할 일: 파고들기\\n다음 테이크: 없음",
                 "배우의 말: 자기 한 줄\\n할 일: 마무리2\\n다음 테이크: 지키며: 침묵은 그대로 두고 상대를 끝까지 보기"]
                """);
        assertThat(DirectVideoPracticeLoop.closingNextTake(statuses)).isEqualTo("침묵은 그대로 두고 상대를 끝까지 보기");
        assertThat(DirectVideoPracticeLoop.closingNextTake(StructuredJson.MAPPER.readTree("[\"파고들기 · 응답 2번째\"]"))).isEmpty();
    }

    @Test void habitTitleFallsBackToTheDescriptionWhenTheModelWritesACategoryName() {
        String design = "소리 빠르기: 처음부터 끝까지 일정하고 빠른 편이에요. \"손도 막 떨더라고요\"도요.\n소리 말끝: 없음\n"
                + "버릇: 소리 빠르기 | 곳1: \"손도\" | 곳2: \"살아야\"\n다음 테이크: 문장 사이 쉬기";
        assertThat(DirectVideoPracticeLoop.habit(design)).isEqualTo("처음부터 끝까지 일정하고 빠른 편이에요");
        assertThat(DirectVideoPracticeLoop.habit("버릇: 말끝을 툭 떨어뜨려요 | 곳1: x")).isEqualTo("말끝을 툭 떨어뜨려요");
        assertThat(DirectVideoPracticeLoop.habit("소리 크기: 없음\n버릇: 소리 크기 | 곳1: x")).isEqualTo("소리 크기");
        assertThat(DirectVideoPracticeLoop.habit("소리 강조: 모든 말에 힘을 줘요. \"x\"\n버릇: 소리 강조 | 곳1: x")).isEqualTo("모든 말에 힘을 줘요");
    }

    @Test void markdownReplyIsStoredAndReturnedAsPlainText() {
        when(model.reply(eq(file), anyList(), anyString()))
                .thenReturn("**전체 인상**\n- 말끝을 끝까지 전달해요.\n## 다음 촬영\n1. \"우리 그만하자\" 앞에서 사이를 두세요.");
        var first = engine.start(session(), UUID.randomUUID());
        String expected = "전체 인상\n말끝을 끝까지 전달해요.\n다음 촬영\n\"우리 그만하자\" 앞에서 사이를 두세요.";
        assertThat(first.reply().message()).isEqualTo(expected);
        assertThat(first.session().turns()).containsExactly(new CoachTurnSnapshot("ai", expected));
        var end = engine.reply(first.session(), "그만", UUID.randomUUID());
        assertThat(end.reply().handoff().path("conversation").toString()).doesNotContain("**", "#", "- ");
        assertThat(end.session().turns()).allSatisfy(turn -> assertThat(turn.text()).doesNotContain("**", "#")
                .satisfies(text -> assertThat(text.lines()).noneMatch(line -> line.startsWith("- "))));
    }

    @Test void markupOnlyReplyIsUnavailableWithoutMutatingHistory() {
        var initial = session();
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("**\n#\n- ");
        assertThatThrownBy(() -> engine.start(initial, UUID.randomUUID())).isInstanceOf(CoachReplyUnavailable.class);
        assertThat(initial.turns()).isEmpty();
        verify(model).delete(file);
    }
}
