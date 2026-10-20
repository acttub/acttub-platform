package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 영상 직접 코치의 갈래: 이어서 찍은 회차, 영상 처리 대기·재사용, 비교 모델 대체, 줄이기, 마지막 말, 배정 실패. */
class DirectVideoCoachPathsTest {
    static final String OPENING = DirectVideoCoachTest.OPENING;
    static final String CONTINUED = "<설계>\n인물: 혼자 선 척 붙잡히길 바란다\n</설계>\n<코치>\n지난번엔 끝을 늦춰 보기로 했죠. 이번엔 어땠어요?\n</코치>";
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");

    DirectVideoCoachPathsTest() {
        when(videos.find(any(), any())).thenReturn(new CoachVideoSource.Video("owned/video.mp4", "video/mp4", "etag"));
        when(storage.downloadToPath(eq("owned/video.mp4"), any())).thenAnswer(call -> {
            Path path = call.getArgument(1);
            Files.writeString(path, "original video bytes");
            return new StoredObjectMetadata(20, "video/mp4", "\"etag\"");
        });
        when(model.upload(any(), eq("video/mp4"))).thenReturn(file);
        when(model.ready(file)).thenReturn(true);
        when(model.model()).thenReturn("gemini-3-flash-preview");
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(OPENING);
    }

    DirectVideoCoach coach() {
        return new DirectVideoCoach(model, videos, storage, failures, telemetry, true);
    }

    CoachSessionSnapshot fresh() {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", 8000, "그 외", "그 외", null, "open", "", List.of(),
                PriorContext.EMPTY, "legacy", 0, null, null).withCoachingState("three_layers_v1", 0, null, "open", "");
    }

    /** 이미 몇 번 주고받은 연습 루프 세션. statuses 는 코치 턴마다 하나다. */
    CoachSessionSnapshot looped(String design, List<String> statuses, String... turns) {
        ObjectNode state = CoachingStateReducer.empty().put("revision", 4);
        ObjectNode loop = state.putObject(DirectVideoPracticeLoop.STATE_KEY).put("design", design).put("flow", "a").put("coach_model", "a");
        ArrayNode array = loop.putArray("statuses");
        statuses.forEach(array::add);
        var list = new ArrayList<CoachTurnSnapshot>();
        for (int i = 0; i < turns.length; i++) list.add(new CoachTurnSnapshot(i % 2 == 0 ? "ai" : "actor", turns[i]));
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", 8000, "그 외", "그 외", null, "open", "", list,
                PriorContext.EMPTY, "three_layers_v1", 4, state, null);
    }

    LlmCall coachCall() {
        return telemetry.calls().stream().filter(call -> call.step() == LlmStep.COACH_TURN).reduce((a, b) -> b).orElseThrow();
    }

    String lastCoachPrompt() {
        var prompts = ArgumentCaptor.forClass(String.class);
        verify(model, org.mockito.Mockito.atLeastOnce()).reply(eq(file), anyList(), prompts.capture());
        return prompts.getValue();
    }

    PriorContext previousRound() {
        return new PriorContext(Map.of(), "배우: 끝을 늦춰 볼게\n코치: 좋아요", true, List.of(),
                List.of("1차: 말끝 — 제안: 끝을 늦춘다"), List.of("포기할래요"));
    }

    @Test void aContinuedTakeOfTheSameSceneOpensFromTheLastAttempt() {
        when(model.reply(eq(file), eq(List.of()), eq(ContinuedTake.heardLinesPrompt()))).thenReturn("1. 이제 포기할래요");
        when(model.reply(eq(file), anyList(), argThat(prompt -> prompt.contains("### 지난 회차 요약")))).thenReturn(CONTINUED);
        var result = coach().turn(fresh().withPrior(previousRound()), null, UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo("지난번엔 끝을 늦춰 보기로 했죠. 이번엔 어땠어요?");
        assertThat(ContinuedTake.linesFromState(result.session().coachingState().toString())).containsExactly("이제 포기할래요");
    }

    @Test void aContinuedTakeOfAnotherSceneStartsOver() {
        when(model.reply(eq(file), eq(List.of()), eq(ContinuedTake.heardLinesPrompt()))).thenReturn("1. 아빠가 뭘 알아?");
        when(model.reply(eq(file), anyList(), argThat(prompt -> prompt.contains("### 지난 회차 요약")))).thenReturn(CONTINUED);
        var result = coach().turn(fresh().withPrior(previousRound()), null, UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo(DirectVideoCoachTest.OPENING_SHOWN);
        assertThat(ContinuedTake.linesFromState(result.session().coachingState().toString())).containsExactly("아빠가 뭘 알아?");
    }

    @Test void aFailedTranscriptionKeepsTheOrdinaryOpening() {
        when(model.reply(eq(file), eq(List.of()), eq(ContinuedTake.heardLinesPrompt()))).thenThrow(new IllegalStateException("quota"));
        when(model.reply(eq(file), anyList(), argThat(prompt -> prompt.contains("### 지난 회차 요약"))))
                .thenThrow(new IllegalStateException("quota"));
        var result = coach().turn(fresh().withPrior(previousRound()), null, UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo(DirectVideoCoachTest.OPENING_SHOWN);
        assertThat(failures.reports()).isEmpty();
    }

    @Test void theCoachWaitsUntilTheUploadedVideoIsProcessed() {
        when(model.ready(file)).thenReturn(false, true);
        var result = coach().turn(fresh(), null, UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo(DirectVideoCoachTest.OPENING_SHOWN);
        verify(model, times(2)).ready(file);
    }

    @Test void anOriginalWithoutAnEtagIsNotComparedAfterDownload() {
        when(videos.find(any(), any())).thenReturn(new CoachVideoSource.Video("owned/video.mp4", "video/mp4", null),
                new CoachVideoSource.Video("owned/video.mp4", "video/mp4", " "));
        assertThat(coach().turn(fresh(), null, UUID.randomUUID()).reply().message()).isEqualTo(DirectVideoCoachTest.OPENING_SHOWN);
        assertThat(coach().turn(fresh(), null, UUID.randomUUID()).reply().message()).isEqualTo(DirectVideoCoachTest.OPENING_SHOWN);
        assertThat(failures.reports()).isEmpty();
    }

    @Test void aRememberedVideoThatIsGoneOrNotReadyIsUploadedAgain() {
        var second = new DirectVideoModel.Video("files/second", "gemini://second", "video/mp4");
        var third = new DirectVideoModel.Video("files/third", "gemini://third", "video/mp4");
        when(model.upload(any(), eq("video/mp4"))).thenReturn(file, second, third);
        when(model.ready(file)).thenReturn(true, false);
        when(model.ready(second)).thenReturn(true).thenThrow(new IllegalStateException("404"));
        when(model.ready(third)).thenReturn(true);
        when(model.reply(any(), anyList(), anyString())).thenReturn(OPENING, "그 마음이 먼저였군요. 어디서 커요?", "그 장면에서 누구를 봐요?");
        var cache = new CoachVideoCache(model, Duration.ofMinutes(10), new MutableClock(Instant.parse("2026-10-20T00:00:00Z")), failures);
        var coach = new DirectVideoCoach(model, videos, storage, failures, telemetry, true, CoachPersonas.NONE, null, 0, CoachFlows.NONE, cache);
        var first = coach.turn(fresh(), null, UUID.randomUUID());
        var answered = coach.turn(first.session(), "붙잡길 바랐어요", UUID.randomUUID());
        assertThat(coachCall().metadata()).containsEntry("video_reused", "false");
        verify(model).delete(file);
        coach.turn(answered.session(), "상대를 보며 말했어요", UUID.randomUUID());
        assertThat(coachCall().metadata()).containsEntry("video_reused", "false");
        verify(model).delete(second);
        verify(model, times(3)).upload(any(), eq("video/mp4"));
        cache.close();
    }

    @Test void whenTheComparedModelStaysEmptyTheDefaultModelWritesTheReply() {
        var compared = mock(DirectVideoModel.class);
        when(compared.model()).thenReturn("gemini-3.8-flash");
        when(compared.reply(eq(file), anyList(), anyString())).thenReturn(null, " ");
        var coach = new DirectVideoCoach(model, videos, storage, failures, telemetry, true, CoachPersonas.NONE, compared, 100);
        var result = coach.turn(fresh(), null, UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo(DirectVideoCoachTest.OPENING_SHOWN);
        verify(compared, times(2)).reply(eq(file), anyList(), anyString());
        assertThat(coachCall().metadata()).containsEntry("model_fallback", "true").containsEntry("empty_retry", "true");
    }

    @Test void aBrokenDefaultFallbackIsAFailureNotAReply() {
        var compared = mock(DirectVideoModel.class);
        when(compared.model()).thenReturn("gemini-3.8-flash");
        when(compared.reply(eq(file), anyList(), anyString())).thenReturn(null);
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("<div>깨진 출력</div>");
        var coach = new DirectVideoCoach(model, videos, storage, failures, telemetry, true, CoachPersonas.NONE, compared, 100);
        assertThatThrownBy(() -> coach.turn(fresh(), null, UUID.randomUUID())).isInstanceOf(CoachReplyUnavailable.class);
        assertThat(failures.contexts()).singleElement().asString().startsWith("DirectVideoCoach.turn ");
        verify(model).delete(file);
    }

    @Test void aModelErrorThatIsNotAnEmptyReplyFailsTheTurn() {
        when(model.reply(eq(file), anyList(), anyString())).thenThrow(new IllegalStateException("quota exceeded"));
        assertThatThrownBy(() -> coach().turn(fresh(), null, UUID.randomUUID())).isInstanceOf(CoachReplyUnavailable.class);
        assertThat(failures.reports()).singleElement().satisfies(report -> assertThat(report.failure()).hasMessage("quota exceeded"));
    }

    @Test void failedAssignmentsFallBackToTheDefaultFlowAndNoPersona() {
        var coach = new DirectVideoCoach(model, videos, storage, failures, telemetry, true, session -> null, null, 0,
                session -> { throw new IllegalStateException("assignment table down"); });
        var result = coach.turn(fresh(), null, UUID.randomUUID());
        assertThat(DirectVideoPracticeLoop.storedFlow(result.session().coachingState())).isEqualTo("a");
        assertThat(DirectVideoPracticeLoop.storedPersona(result.session().coachingState())).isEmpty();
        assertThat(failures.contexts()).singleElement().asString().startsWith("DirectVideoCoach.flow ");
    }

    @Test void anEnglishActorWhoStopsGetsTheEnglishClosingWithoutAModelCall() {
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"stop\"]}");
        var session = looped("버릇: 말끝", List.of(""), "Opening question?");
        var result = coach().turn(session, "Okay that is enough practice for me today", UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo("That's it for today. Upload a new take and we'll pick up from here.");
        verify(model, never()).reply(any(), anyList(), anyString());
    }

    @Test void anEnglishOpeningUsesTheEnglishLoopPrompt() {
        var english = new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "In a garden with my crush", "", "", 8000, "그 외", "그 외", null, "open", "",
                List.of(), PriorContext.EMPTY, "legacy", 0, null, null).withCoachingState("three_layers_v1", 0, null, "open", "");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(
                "<설계>\n인물: wants to be held\n</설계>\n<코치>\nWhat did she want from him in this scene?\n</코치>");
        var result = coach().turn(english, null, UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo("What did she want from him in this scene?");
        assertThat(lastCoachPrompt()).contains(DirectVideoPrompts.practiceLoop(english.practiceSessionId(), java.util.Locale.ENGLISH));
        assertThat(coachCall().prompt().name()).isEqualTo("coach.practice-loop.en");
    }

    static final String WRAPPED = "버릇: 말끝이 길다\n확인할 대사: 가지 마\n근본 문제: 2";

    @Test void afterTheWrapUpAnEnglishQuestionGetsTheEnglishLastWordInstruction() {
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"not_yet\",\"question\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("You could try ending it shorter. Check it next take.");
        var session = looped(WRAPPED, List.of("", "할 일: 정리하기\n단계: 4"), "Opening question?", "I want her to stay", "Wrap up.");
        coach().turn(session, "How should I end the line though", UUID.randomUUID());
        assertThat(lastCoachPrompt()).contains("this is the last thing you say today. Answer in one or two sentences")
                .contains("If the actor only asked something, just answer");
    }

    @Test void afterTheWrapUpADisagreementIsFollowedInKorean() {
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\",\"pushback\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("<다음 테이크>소리 지르며 따져 봐도 좋아요</다음 테이크>\n그 해석이면 소리 지르며 따져 봐도 좋아요.");
        var session = looped(WRAPPED, List.of("", "할 일: 정리하기\n단계: 4"), "첫 질문", "붙잡고 싶었어", "정리 말");
        var result = coach().turn(session, "저는 화를 내는 인물이라고 봤어요", UUID.randomUUID());
        assertThat(lastCoachPrompt()).contains("이번이 오늘 대화의 마지막 말이다. 물은 것에 한두 문장으로 답만 하고")
                .contains(" 배우가 정리에 다른 해석을 냈다.");
        assertThat(result.reply().message()).isEqualTo("그 해석이면 소리 지르며 따져 봐도 좋아요.");
        String status = result.session().coachingState().path(DirectVideoPracticeLoop.STATE_KEY).path("statuses").get(2).asText();
        assertThat(DirectVideoPracticeLoop.statusField(status, "다음 테이크")).isEqualTo("소리 지르며 따져 봐도 좋아요");
    }

    @Test void theTurnInstructionCarriesWhatTheActorAskedAndWanted() {
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\",\"evaluation\",\"want\",\"line_fix\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("조금 어색해요. 끝이 길어서요. 누구를 봐요?");
        var session = looped(WRAPPED + "\n인물: 떠나는 사람을 붙잡는다\n말 거는 대상: 떠나는 연인", List.of(""), "첫 질문");
        coach().turn(session, "위로받고 싶었어 이거 괜찮아?", UUID.randomUUID());
        assertThat(lastCoachPrompt())
                .contains("배우가 답하면서 코치의 판단도 물었다.")
                .contains("배우가 코치가 짚은 대사를 다른 장면이라고 바로잡았다.")
                .contains("배우가 가장 나중에 말한 바람: 위로받고 싶었어 이거 괜찮아?")
                .contains("인물: 떠나는 사람을 붙잡는다")
                .contains("말 거는 대상: 떠나는 연인")
                .doesNotContain("정리에서 확인할 대사");
    }

    @Test void questionsAndMethodRequestsAddTheirOwnFirstSentenceRule() {
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\",\"question\"]}", "{\"signals\":[\"answered\",\"method\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("이유는 끝이 길어서예요. 누구를 봐요?");
        var session = looped(WRAPPED, List.of(""), "첫 질문");
        coach().turn(session, "붙잡고 싶었어 근데 왜 그래?", UUID.randomUUID());
        assertThat(lastCoachPrompt()).contains("배우가 답하면서 물은 것이 있다. 첫 문장에서 쉬운 말로 바로 답하고");
        coach().turn(looped(WRAPPED, List.of(""), "첫 질문"), "붙잡고 싶었어 어떻게 해?", UUID.randomUUID());
        assertThat(lastCoachPrompt()).contains("배우가 답하면서 방법도 물었다.");
    }

    @Test void aLongReplyIsKeptWhenShorteningFailsOrDoesNotHelp() {
        String longReply = "말끝을 길게 끄는 버릇이 상대를 붙잡는 마음을 가려요. 그래서 붙잡는 말이 부탁처럼 들리고 힘이 빠져요. 어디서 가장 붙잡고 싶었어요?";
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(longReply);
        when(model.reply(isNull(), anyList(), anyString()))
                .thenReturn(" ")
                .thenThrow(new IllegalStateException("blocked"))
                .thenThrow(new RuntimeException("network"))
                .thenReturn(longReply + " 더 길게")
                .thenReturn("0:23에 끝이 길어요. 어디서 붙잡고 싶었어요?");
        var coach = coach();
        for (int i = 0; i < 4; i++) {
            assertThat(coach.turn(looped(WRAPPED, List.of(""), "첫 질문"), "붙잡고 싶었어", UUID.randomUUID()).reply().message())
                    .isEqualTo(longReply);
        }
        assertThat(failures.contexts()).singleElement().asString().startsWith("DirectVideoCoach.shorten ");
        var shortened = coach.turn(looped(WRAPPED, List.of(""), "첫 질문"), "붙잡고 싶었어", UUID.randomUUID());
        assertThat(shortened.reply().message()).isEqualTo("끝이 길어요. 어디서 붙잡고 싶었어요?");
    }
}
