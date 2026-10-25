package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** SOMA-855: 실험 쪽 대화는 이미 했다는 말에 한 일을 묻고, 그다음 다르게 정리한다. 대조 쪽은 지금처럼 내려놓기다. */
class DirectVideoCoachAlreadyTest {
    static final String WRAP = "정리하기";
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");

    DirectVideoCoachAlreadyTest() {
        when(videos.find(any(), any())).thenReturn(new CoachVideoSource.Video("owned/video.mp4", "video/mp4", "etag"));
        when(storage.downloadToPath(eq("owned/video.mp4"), any())).thenAnswer(call -> {
            Path path = call.getArgument(1);
            Files.writeString(path, "original video bytes");
            return new StoredObjectMetadata(20, "video/mp4", "\"etag\"");
        });
        when(model.upload(any(), eq("video/mp4"))).thenReturn(file);
        when(model.ready(file)).thenReturn(true);
        when(model.model()).thenReturn("gemini-3-flash-preview");
    }

    DirectVideoCoach coach(int share) {
        return new DirectVideoCoach(model, videos, storage, failures, telemetry, true, CoachPersonas.NONE, null, 0,
                CoachFlows.NONE, CoachVideoCache.NONE, true).withAlreadyShare(share);
    }

    static final String WRAPPED = "할 일: 정리하기\n다음 테이크: 처음엔 다그치다가 \"하지만\"부터는 달래 봐도 좋아요.\n단계: 4";

    CoachSessionSnapshot afterWrap(String arm, String... extraStatuses) {
        var statuses = new java.util.ArrayList<>(List.of("", WRAPPED));
        statuses.addAll(List.of(extraStatuses));
        String[] turns = new String[statuses.size() * 2 - 1];
        for (int i = 0; i < turns.length; i++) turns[i] = i % 2 == 0 ? "코치 말 " + i : "배우 말 " + i;
        turns[2] = "처음엔 다그치다가 \"하지만\"부터는 달래 봐도 좋아요.";
        var session = DirectVideoCoachBranchTest.looped("버릇: 담담함", statuses, "a", turns);
        ((ObjectNode) session.coachingState().path(DirectVideoPracticeLoop.STATE_KEY)).put("already_ab", arm);
        return session;
    }

    void classifiedAs(String signals) {
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":" + signals + "}");
    }

    String lastPrompt(DirectVideoModel.Video video) {
        var prompts = ArgumentCaptor.forClass(String.class);
        verify(model, atLeastOnce()).reply(video == null ? isNull() : eq(video), anyList(), prompts.capture());
        return prompts.getValue();
    }

    static String status(CoachResult result) {
        var statuses = result.session().coachingState().path(DirectVideoPracticeLoop.STATE_KEY).path("statuses");
        return statuses.get(statuses.size() - 1).asText("");
    }

    @Test void theExperimentAsksWhatWasDoneWithoutTheVideo() {
        classifiedAs("[\"answered\",\"correction\",\"already\"]");
        when(model.reply(isNull(), anyList(), anyString())).thenReturn("네, 그렇게 했군요. \"좌절했어\"에서는 실제로 어떻게 말했어요?");
        var result = coach(50).turn(afterWrap("on"), "그렇게 한거였어", UUID.randomUUID());
        assertThat(lastPrompt(null)).contains("실제로 어떻게 말했어요").contains("다시 제안하지 않는다").doesNotContain("오늘 대화의 마지막 말이다");
        assertThat(status(result)).contains("할 일: 한 일 묻기").contains("이미 한 것: 처음엔 다그치다가").doesNotContain("다음에 닫기: 예");
        assertThat(telemetry.calls().getLast().metadata()).containsEntry("already_arm", "on").containsEntry("video_omitted", "true");
    }

    @Test void theAnswerToItWrapsDifferentlyWithTheVideo() {
        classifiedAs("[\"answered\"]");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("<다음 테이크>\"좌절했어\"에서 말을 끊어 봐도 좋아요.</다음 테이크>\n네, 낮게 말한 건 들려요. \"좌절했어\"에서 말을 끊어 봐도 좋아요. 어때요?");
        String asked = "할 일: 한 일 묻기\n이미 한 것: 처음엔 다그치다가 \"하지만\"부터는 달래 봐도 좋아요.\n단계: 4";
        var result = coach(50).turn(afterWrap("on", asked), "목소리 낮추고 혼내듯 말했어", UUID.randomUUID());
        assertThat(lastPrompt(file)).contains("다시 제안하지 않는다").contains("처음엔 다그치다가");
        assertThat(status(result)).contains("할 일: 정리하기(다르게)");
        assertThat(result.reply().message()).doesNotContain("?");
    }

    @Test void anotherAlreadyAfterTheWrapIsAcceptedWithoutANewQuestion() {
        classifiedAs("[\"answered\",\"correction\",\"already\"]");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("네, 그렇게 했군요. \"좌절했어\"는 다음 테이크에서 한 번 더 들어 봐요.");
        String asked = "할 일: 한 일 묻기\n이미 한 것: 처음엔 다그치다가 \"하지만\"부터는 달래 봐도 좋아요.\n단계: 4";
        String wrappedAgain = "할 일: 정리하기(다르게)\n다음 테이크: 말을 끊어 봐도 좋아요.\n단계: 4";
        var result = coach(50).turn(afterWrap("on", asked, wrappedAgain), "그렇게 한거라니까", UUID.randomUUID());
        assertThat(lastPrompt(file)).contains("새 행동을 제안하지 않는다");
        assertThat(status(result)).contains("할 일: 답하기").contains("이미 한 것:");
    }

    @Test void theControlStillLetsGo() {
        classifiedAs("[\"answered\",\"correction\",\"already\"]");
        when(model.reply(isNull(), anyList(), anyString())).thenReturn("아, 그럼 그때 스스로를 어떻게 바꾸고 싶었어요?");
        var result = coach(50).turn(afterWrap("off"), "그렇게 한거였어", UUID.randomUUID());
        assertThat(status(result)).contains("할 일: 내려놓기").doesNotContain("이미 한 것");
        assertThat(telemetry.calls().getLast().metadata()).containsEntry("already_arm", "off");
    }

    @Test void armsAreStoredAndAssignedOnTheFirstReply() {
        var c = coach(100);
        var fresh = new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null, "", "", "", 8000, "그 외",
                "그 외", null, "open", "", List.of(), PriorContext.EMPTY, "three_layers_v1", 0, null, null);
        assertThat(c.alreadyArm(fresh)).isEqualTo("on");
        assertThat(coach(0).alreadyArm(fresh)).isEqualTo("off");
        assertThat(c.alreadyArm(afterWrap("off"))).isEqualTo("off");
        var state = CoachingStateReducer.empty();
        DirectVideoPracticeLoop.rememberAlready(state, "on");
        DirectVideoPracticeLoop.rememberAlready(state, "off");
        assertThat(DirectVideoPracticeLoop.storedAlready(state)).isEqualTo("on");
        assertThat(DirectVideoPracticeLoop.storedAlready(null)).isEmpty();
    }
}
