package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.observation.ReplyTrace;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTokens;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;
import org.mockito.stubbing.Answer;

/** 코치 기록의 토큰은 그 기록이 묶은 모델 호출의 합이다. 다른 모델의 토큰은 값을 섞지 않고 따로 적는다. */
class DirectVideoCoachTokensTest {
    static final String MODEL = "gemini-3-flash-preview";
    static final String LONG_REPLY = "그 장면에서 아빠의 눈을 피한 뒤에 다시 천천히 올려다보던 순간에 정말로 하려고 했던 것은 무엇이었는지 말해 줄 수 있을까요?";
    static final String SHORT_REPLY = "그때 뭘 하려고 했어요?";
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");

    DirectVideoCoachTokensTest() {
        when(videos.find(any(), any())).thenReturn(new CoachVideoSource.Video("owned/video.mp4", "video/mp4", "etag"));
        when(storage.downloadToPath(eq("owned/video.mp4"), any())).thenAnswer(call -> {
            Path path = call.getArgument(1);
            Files.writeString(path, "original video bytes");
            return new StoredObjectMetadata(20, "video/mp4", "\"etag\"");
        });
        when(model.upload(any(), eq("video/mp4"))).thenReturn(file);
        when(model.ready(file)).thenReturn(true);
        when(model.model()).thenReturn(MODEL);
        when(model.classify(anyList(), anyString(), anyList())).thenAnswer(used(MODEL, LlmTokens.of(3, 1, 4), "{\"signals\":[\"answered\"]}"));
        when(model.reply(eq(file), anyList(), anyString())).thenAnswer(used(MODEL, LlmTokens.of(100, 20, 120), LONG_REPLY));
        when(model.replyLight(isNull(), anyList(), anyString())).thenAnswer(used(MODEL, LlmTokens.of(10, 5, 15), SHORT_REPLY));
    }

    /** 실제 모델처럼 지금 턴에 토큰을 알린다. */
    static Answer<String> used(String name, LlmTokens tokens, String reply) {
        return call -> {
            if (ReplyTrace.current() != null) ReplyTrace.current().add(name, tokens);
            return reply;
        };
    }

    void turn(DirectVideoCoach coach) {
        coach.turn(DirectVideoCoachBranchTest.looped("버릇: 말끝", List.of(""), "a", "첫 질문"), "붙잡고 싶었어", UUID.randomUUID());
    }

    LlmCall recorded(LlmStep step) {
        return telemetry.calls().stream().filter(call -> call.step() == step).findFirst().orElseThrow();
    }

    DirectVideoCoach coach() {
        return new DirectVideoCoach(model, videos, storage, new RecordingFailureReporter(), telemetry, true, CoachPersonas.NONE, null, 0);
    }

    @Test void aTurnSumsItsReplyAndShortenCallsAndTheRouteKeepsItsOwn() {
        turn(coach());
        LlmCall coachTurn = recorded(LlmStep.COACH_TURN);
        int shortened = Integer.parseInt(coachTurn.metadata().get("shorten_calls"));
        assertThat(shortened).isPositive();
        assertThat(coachTurn.tokens()).isEqualTo(LlmTokens.of(100 + 10 * shortened, 20 + 5 * shortened, 120 + 15 * shortened));
        assertThat(coachTurn.metadata()).doesNotContainKey("other_model_tokens");
        assertThat(recorded(LlmStep.COACH_ROUTE).tokens()).isEqualTo(LlmTokens.of(3, 1, 4));
    }

    @Test void aRetryAfterAnEmptyReplyIsAddedToTheSameTurn() {
        when(model.reply(eq(file), anyList(), anyString()))
                .thenAnswer(call -> {
                    ReplyTrace.current().add(MODEL, LlmTokens.of(100, 20, 120));
                    throw new IllegalStateException("empty video coaching reply");
                })
                .thenAnswer(used(MODEL, LlmTokens.of(90, 10, 100), SHORT_REPLY));
        turn(coach());
        assertThat(recorded(LlmStep.COACH_TURN).tokens()).isEqualTo(LlmTokens.of(190, 30, 220));
    }

    @Test void callsOnAnotherModelStayOutOfThePricedTokens() {
        DirectVideoModel alternate = mock(DirectVideoModel.class);
        when(alternate.model()).thenReturn("gemini-3.8-flash");
        when(alternate.reply(eq(file), anyList(), anyString())).thenAnswer(used("gemini-3.8-flash", LlmTokens.of(200, 40, 240), LONG_REPLY));
        // 이 대화는 비교 모델 쪽이다. 줄이기는 기본 모델이 맡는다.
        var session = DirectVideoCoachBranchTest.looped("버릇: 말끝", List.of(""), "a", "첫 질문");
        ((com.fasterxml.jackson.databind.node.ObjectNode) session.coachingState().path(DirectVideoPracticeLoop.STATE_KEY)).put("coach_model", "b");
        new DirectVideoCoach(model, videos, storage, new RecordingFailureReporter(), telemetry, true, CoachPersonas.NONE, alternate, 100)
                .turn(session, "붙잡고 싶었어", UUID.randomUUID());
        LlmCall coachTurn = recorded(LlmStep.COACH_TURN);
        assertThat(coachTurn.model()).isEqualTo("gemini-3.8-flash");
        assertThat(coachTurn.tokens()).isEqualTo(LlmTokens.of(200, 40, 240));
        int shortened = Integer.parseInt(coachTurn.metadata().get("shorten_calls"));
        assertThat(shortened).isPositive();
        assertThat(coachTurn.metadata()).containsEntry("other_model_tokens",
                MODEL + ":" + 10 * shortened + "/" + 5 * shortened + "/" + 15 * shortened);
    }

    @Test void aTurnThatGotNoAnswerStaysUnknown() {
        when(model.reply(eq(file), anyList(), anyString())).thenThrow(new RuntimeException("down"));
        try {
            turn(coach());
        } catch (RuntimeException expected) {
            // 코치 답을 못 받은 턴이다.
        }
        assertThat(recorded(LlmStep.COACH_TURN).tokens()).isEqualTo(LlmTokens.unknown());
    }
}
