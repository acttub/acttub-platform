package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTokens;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 코치 비용 줄이기(SOMA-1063): 고정 앞부분 경계와 회차 영상 예산. */
class DirectVideoCoachCostTest {
    static final String MODEL = DirectVideoCoachTokensTest.MODEL;
    static final String REPLY = "그때 뭘 하려고 했어요?";
    /** 캐시 적중 40 → 환산 60 + 4 = 64. */
    static final LlmTokens WITH_VIDEO = LlmTokens.of(100, 20, 120, 40);
    static final LlmTokens WITHOUT_VIDEO = LlmTokens.of(10, 2, 12);
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");
    final UUID practice = UUID.randomUUID();
    final UUID user = UUID.randomUUID();

    DirectVideoCoachCostTest() {
        source("etag");
        when(model.upload(any(), eq("video/mp4"))).thenReturn(file);
        when(model.ready(file)).thenReturn(true);
        when(model.model()).thenReturn(MODEL);
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenAnswer(DirectVideoCoachTokensTest.used(MODEL, WITH_VIDEO, REPLY));
        when(model.reply(isNull(), anyList(), anyString())).thenAnswer(DirectVideoCoachTokensTest.used(MODEL, WITHOUT_VIDEO, REPLY));
        when(model.replyLight(isNull(), anyList(), anyString())).thenReturn(REPLY);
    }

    /** 이 회차의 원본. etag 가 바뀌면 재촬영·새 영상이다. */
    void source(String etag) {
        when(videos.find(any(), any())).thenReturn(new CoachVideoSource.Video("owned/video.mp4", "video/mp4", etag));
        when(storage.downloadToPath(eq("owned/video.mp4"), any())).thenAnswer(call -> {
            Path path = call.getArgument(1);
            Files.writeString(path, "original video bytes");
            return new StoredObjectMetadata(20, "video/mp4", "\"" + etag + "\"");
        });
    }

    /** 배우가 적은 칸이 있는 연습 루프 회차. 첫 칸이 코치 말이다. */
    CoachSessionSnapshot session(String... turns) {
        ObjectNode state = CoachingStateReducer.empty().put("revision", 4);
        ObjectNode loop = state.putObject(DirectVideoPracticeLoop.STATE_KEY).put("design", "버릇: 말끝").put("flow", "a")
                .put("coach_model", "a");
        loop.putArray("statuses").add("");
        var list = new ArrayList<CoachTurnSnapshot>();
        for (int i = 0; i < turns.length; i++) list.add(new CoachTurnSnapshot(i % 2 == 0 ? "ai" : "actor", turns[i]));
        return new CoachSessionSnapshot(UUID.randomUUID(), practice, user, StructuredJson.MAPPER.createObjectNode(),
                "엄마와 다투는 장면", "집을 나가려는 딸", "엄마를 붙잡는다", 8000, "그 외", "그 외", null, "open", "", list,
                PriorContext.EMPTY, "three_layers_v1", 4, state, null);
    }

    DirectVideoCoach coach(CoachVideoCache cache) {
        return new DirectVideoCoach(model, videos, storage, new RecordingFailureReporter(), telemetry, true, CoachPersonas.NONE,
                null, 0, CoachFlows.NONE, cache, true);
    }

    /** 영상 기억은 끄고(답마다 올림) 예산만 센다. */
    static CoachVideoCache counting() {
        return new CoachVideoCache(null, Duration.ZERO, Clock.systemUTC(), null);
    }

    String prompt(DirectVideoCoach coach, CoachSessionSnapshot session, String actorText) {
        reset(model);
        rewire();
        var prompts = ArgumentCaptor.forClass(String.class);
        coach.turn(session, actorText, UUID.randomUUID());
        verify(model, atLeastOnce()).reply(eq(file), anyList(), prompts.capture());
        return prompts.getAllValues().getFirst();
    }

    void rewire() {
        when(model.upload(any(), eq("video/mp4"))).thenReturn(file);
        when(model.ready(file)).thenReturn(true);
        when(model.model()).thenReturn(MODEL);
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenAnswer(DirectVideoCoachTokensTest.used(MODEL, WITH_VIDEO, REPLY));
        when(model.replyLight(isNull(), anyList(), anyString())).thenReturn(REPLY);
    }

    LlmCall lastTurn() {
        return telemetry.calls().stream().filter(call -> call.step() == LlmStep.COACH_TURN).toList().getLast();
    }

    @Test void theStablePrefixOnlyInsertsTheBoundaryAndTheFixedPartIsTheSameAcrossTurns() {
        var first = session("누구를 봤어요?");
        var later = session("누구를 봤어요?", "엄마를 봤어", "그때 엄마가 뭘 했어요?");
        String on = prompt(coach(CoachVideoCache.NONE).withStablePrefix(true), first, "붙잡고 싶었어");
        String onLater = prompt(coach(CoachVideoCache.NONE).withStablePrefix(true), later, "문을 막았어");
        String off = prompt(coach(CoachVideoCache.NONE), first, "붙잡고 싶었어");
        String offExplicit = prompt(coach(CoachVideoCache.NONE).withStablePrefix(false), first, "붙잡고 싶었어");

        // 끄면 경계가 없고 지금과 같은 지시문이다. 켜면 같은 글에 경계만 끼운다(문구·순서는 그대로).
        assertThat(off).doesNotContain(DirectVideoModel.TURN_BOUNDARY).isEqualTo(offExplicit);
        assertThat(on).contains(DirectVideoModel.TURN_BOUNDARY);
        assertThat(on.replace(DirectVideoModel.TURN_BOUNDARY, "")).isEqualTo(off);

        String fixed = on.substring(0, on.indexOf(DirectVideoModel.TURN_BOUNDARY));
        String fixedLater = onLater.substring(0, onLater.indexOf(DirectVideoModel.TURN_BOUNDARY));
        assertThat(fixed).contains("엄마와 다투는 장면").isEqualTo(fixedLater);
        // 턴마다 바뀌는 단계 지시는 경계 뒤에 있다.
        String turn = on.substring(on.indexOf(DirectVideoModel.TURN_BOUNDARY));
        assertThat(turn).contains(DirectVideoPrompts.practiceLoopTurn());
        assertThat(fixed).doesNotContain(DirectVideoPrompts.practiceLoopTurn());
        // Langfuse 입력에는 경계 표시 대신 머리말이 보인다.
        LlmCall recordedOn = telemetry.calls().stream().filter(call -> call.step() == LlmStep.COACH_TURN).findFirst().orElseThrow();
        assertThat(recordedOn.input()).doesNotContain(DirectVideoModel.TURN_BOUNDARY).contains(DirectVideoModel.TURN_HEADER);
    }

    @Test void overTheSessionBudgetTheNextRepliesGoWithoutTheVideoUntilANewVideo() {
        var coach = coach(counting()).withVideoTokenBudget(100);
        var session = session("누구를 봤어요?");

        coach.turn(session, "붙잡고 싶었어", UUID.randomUUID());
        assertThat(lastTurn().metadata()).containsEntry("video_budget_omitted", "false").containsEntry("video_budget_tokens", "64");
        coach.turn(session, "붙잡고 싶었어", UUID.randomUUID());
        assertThat(lastTurn().metadata()).containsEntry("video_budget_omitted", "false").containsEntry("video_budget_tokens", "128");
        verify(model, times(2)).reply(eq(file), anyList(), anyString());

        // 128 ≥ 100: 이번 답부터 영상 없이 글만 보낸다(내려놓기와 같은 영상 생략 경로).
        coach.turn(session, "붙잡고 싶었어", UUID.randomUUID());
        assertThat(lastTurn().metadata()).containsEntry("video_budget_omitted", "true")
                .containsEntry("video_omitted", "true").containsEntry("video_budget_tokens", "138");
        verify(model).reply(isNull(), anyList(), anyString());
        verify(model, times(2)).reply(eq(file), anyList(), anyString());
        verify(model, times(2)).upload(any(), anyString());

        // 다시 찍은 영상(원본 etag 가 다름)은 0 부터 다시 센다.
        source("etag-2");
        coach.turn(session, "붙잡고 싶었어", UUID.randomUUID());
        assertThat(lastTurn().metadata()).containsEntry("video_budget_omitted", "false").containsEntry("video_budget_tokens", "64");
        verify(model, times(3)).reply(eq(file), anyList(), anyString());
    }

    @Test void aZeroBudgetNeverOmitsTheVideo() {
        var coach = coach(counting()).withVideoTokenBudget(0);
        var session = session("누구를 봤어요?");
        for (int i = 0; i < 4; i++) coach.turn(session, "붙잡고 싶었어", UUID.randomUUID());
        verify(model, never()).reply(isNull(), anyList(), anyString());
        assertThat(lastTurn().metadata()).containsEntry("video_budget_omitted", "false").containsEntry("video_budget_tokens", "256");
    }

    @Test void cachedInputCountsAsATenth() {
        assertThat(DirectVideoCoach.weightedInput(LlmTokens.of(100, 20, 120, 40))).isEqualTo(64);
        assertThat(DirectVideoCoach.weightedInput(LlmTokens.of(13_500, 20, 13_520))).isEqualTo(13_500);
        assertThat(DirectVideoCoach.weightedInput(LlmTokens.of(10_000, 0, 10_000, 10_000))).isEqualTo(1_000);
        assertThat(DirectVideoCoach.weightedInput(LlmTokens.unknown())).isZero();
    }

    @Test void theCounterRestartsOnTheFirstReplyAndOnANewSource() {
        var cache = counting();
        var key = new CoachVideoCache.Key(practice, "owned/video.mp4", "\"etag\"");
        assertThat(cache.spend(key, 500, true)).isEqualTo(500);
        assertThat(cache.spend(key, 300, false)).isEqualTo(800);
        assertThat(cache.spentTokens(key)).isEqualTo(800);
        assertThat(cache.spentTokens(new CoachVideoCache.Key(practice, "owned/video.mp4", "other"))).isZero();
        assertThat(cache.spend(key, 100, true)).isEqualTo(100);
        assertThat(cache.spend(new CoachVideoCache.Key(practice, "owned/retake.mp4", "x"), 70, false)).isEqualTo(70);
        assertThat(cache.spentTokens(key)).isZero();
    }
}
