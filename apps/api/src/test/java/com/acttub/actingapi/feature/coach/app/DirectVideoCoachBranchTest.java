package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 연습 루프 둘째 응답부터의 갈래: 깨진 답, 시간 표기 다시 쓰기, 쉽게 묻기·답 제안의 재료, 흐름 B, 스트리밍의 기본 모델 대체. */
class DirectVideoCoachBranchTest {
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");

    DirectVideoCoachBranchTest() {
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
    }

    DirectVideoCoach coach() {
        return new DirectVideoCoach(model, videos, storage, failures, telemetry, true);
    }

    static CoachSessionSnapshot looped(String design, List<String> statuses, String flow, String... turns) {
        ObjectNode state = CoachingStateReducer.empty().put("revision", 4);
        ObjectNode loop = state.putObject(DirectVideoPracticeLoop.STATE_KEY).put("design", design).put("flow", flow).put("coach_model", "a");
        ArrayNode array = loop.putArray("statuses");
        statuses.forEach(array::add);
        var list = new ArrayList<CoachTurnSnapshot>();
        for (int i = 0; i < turns.length; i++) list.add(new CoachTurnSnapshot(i % 2 == 0 ? "ai" : "actor", turns[i]));
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", 8000, "그 외", "그 외", null, "open", "", list,
                PriorContext.EMPTY, "three_layers_v1", 4, state, null);
    }

    String lastPrompt() {
        var prompts = ArgumentCaptor.forClass(String.class);
        org.mockito.Mockito.verify(model, org.mockito.Mockito.atLeastOnce()).reply(eq(file), anyList(), prompts.capture());
        return prompts.getValue();
    }

    @Test void aReplyThatStaysBrokenAfterTheRewriteFailsTheTurn() {
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("<div>깨진 출력</div>");
        assertThatThrownBy(() -> coach().turn(looped("버릇: 말끝", List.of(""), "a", "첫 질문"), "붙잡고 싶었어", UUID.randomUUID()))
                .isInstanceOf(CoachReplyUnavailable.class);
        assertThat(failures.contexts()).singleElement().asString().startsWith("DirectVideoCoach.turn");
    }

    @Test void aTimestampRewriteThatComesBackEmptyKeepsTheFirstReplyWithoutTimes() {
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("0:23에 말끝이 길어요. 누구를 봐요?", "  ");
        var result = coach().turn(looped("버릇: 말끝", List.of(""), "a", "첫 질문"), "붙잡고 싶었어", UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo("말끝이 길어요. 누구를 봐요?");
    }

    @Test void aMisunderstoodQuestionIsAskedEasilyWithWhatToFindOut() {
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"missed\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("붙잡고 싶었어요, 밀어내고 싶었어요?");
        coach().turn(looped("버릇: 말끝", List.of("", "할 일: 다시 묻기\n단계: 2"), "a", "첫 질문", "몰라", "다시 묻기"),
                "무슨 말이야", UUID.randomUUID());
        assertThat(lastPrompt()).contains("이번에 알아낼 것: " + PracticeLoopRouter.easyGoal(
                new PracticeLoopRouter.Before(3, "다시 묻기", null, new PracticeLoopRouter.Tally(0, 0, 0), List.of(), false, false, false, false, 2)));
    }

    @Test void aWantAtTheLastStepGoesStraightToWrapUpWithTheActorsWords() {
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\",\"want\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("위로받고 싶으면, 상대 손을 잡아 봐도 좋아요. 어때요?");
        coach().turn(looped("버릇: 말끝", List.of("", "할 일: 다시 묻기\n단계: 4"), "a", "첫 질문", "글쎄", "다시 묻기"),
                "위로받고 싶어", UUID.randomUUID());
        // 2026-10-22 운영(자문): 바람을 말했는데 "뭘 해 볼래요?"를 다시 물었다. 이제 다시 묻지 않고 정리에서 그 바람을 얻을 행동을 준다.
        assertThat(lastPrompt()).contains("배우가 가장 나중에 말한 바람: 위로받고 싶어", "지금 단계: 4/4 정리")
                .doesNotContain("이번 제안은 위 할 일의 모양·좋은 예보다 이 줄이 먼저다.");
    }

    @Test void flowBTellsWhatTheCoachSawWithALongerLimit() {
        String told = "말끝을 길게 끌어서 붙잡는 말이 부탁처럼 들려요. 첫 대사와 마지막 대사 모두 그래요. 그래서 마음이 약해 보여요.";
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(told);
        var result = coach().turn(looped("버릇: 말끝", List.of(""), "b", "첫 질문"), "붙잡고 싶었어", UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo(told);
        assertThat(lastPrompt()).startsWith(DirectVideoPrompts.practiceLoopTurn());
    }

    @Test void anAssignedFlowBIsStoredOnTheFirstReply() {
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(DirectVideoCoachTest.OPENING);
        var coach = new DirectVideoCoach(model, videos, storage, failures, telemetry, true, CoachPersonas.NONE, null, 0, session -> CoachFlows.B);
        var fresh = new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", 8000, "그 외", "그 외", null, "open", "", List.of(),
                PriorContext.EMPTY, "legacy", 0, null, null).withCoachingState("three_layers_v1", 0, null, "open", "");
        var result = coach.turn(fresh, null, UUID.randomUUID());
        assertThat(DirectVideoPracticeLoop.storedFlow(result.session().coachingState())).isEqualTo(CoachFlows.B);
    }

    @Test void whileStreamingAnEmptyComparedModelFallsBackToTheDefaultStream() {
        var compared = mock(DirectVideoModel.class);
        when(compared.model()).thenReturn("gemini-3.8-flash");
        when(compared.replyStream(eq(file), anyList(), anyString(), any())).thenThrow(new IllegalStateException("empty video coaching reply"));
        when(model.replyStream(eq(file), anyList(), anyString(), any())).thenAnswer(call -> {
            java.util.function.Consumer<String> onText = call.getArgument(3);
            onText.accept("그 마음이 먼저였군요. 누구를 봐요?");
            return "그 마음이 먼저였군요. 누구를 봐요?";
        });
        var coach = new DirectVideoCoach(model, videos, storage, failures, telemetry, true, CoachPersonas.NONE, compared, 100);
        var streamed = new ArrayList<String>();
        var session = looped("버릇: 말끝", List.of(""), "a", "첫 질문");
        ((ObjectNode) session.coachingState().path(DirectVideoPracticeLoop.STATE_KEY)).put("coach_model", "b");
        var result = coach.turn(session, "붙잡고 싶었어", UUID.randomUUID(), new CoachStream() {
            @Override public void begin() { }
            @Override public void delta(String text) { streamed.add(text); }
        });
        assertThat(result.reply().message()).isEqualTo("그 마음이 먼저였군요. 누구를 봐요?");
        assertThat(String.join("", streamed)).isEqualTo("그 마음이 먼저였군요. 누구를 봐요?");
    }
}
