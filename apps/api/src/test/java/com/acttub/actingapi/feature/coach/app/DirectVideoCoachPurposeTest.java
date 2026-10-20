package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
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
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 목적별 코칭(SOMA-719)이 실제 턴에서 타는 길: 첫 답의 버튼·대사, 버튼 누르기, 정리에서 닫기, 평가 결과 카드. */
class DirectVideoCoachPurposeTest {
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");

    static final String STUCK_OPENING = """
            <설계>
            영상: 연기
            관찰 근거: 화면·음성
            대사 확인: 확인됨
            확인된 대사: "가르쳐 줘"
            대사 시간: 0:03 "가르쳐 줘" / 0:12 "취소해"
            장면: 헤어지자는 말을 들은 밤 | 헬레네 | 상대
            막혔을 법한 곳: 0:12 "취소해" 화내는 쪽 / 0:03 "가르쳐 줘"
            버릇: "취소해"에서 화내는 사람처럼 들려요
            확인할 대사: 취소해
            다음 테이크: "취소해"에서 붙잡듯 말해 봐도 좋아요
            </설계>
            <코치>
            어떤 게 막혔어요?
            </코치>
            <보기>
            감정이 안 따라와요
            대사가 입에 안 붙어요
            뭘 원하는지 모르겠어요
            </보기>""";

    DirectVideoCoachPurposeTest() {
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

    static CoachSessionSnapshot fresh(String purpose) {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", 8000, "그 외", "그 외", null, "open", "", List.of(),
                PriorContext.EMPTY, "legacy", 0, null, null).withCoachingState("three_layers_v1", 0, null, "open", "")
                .withSessionPurpose(purpose);
    }

    /** 첫 답을 한 번 돌린 세션에 배우 말과 코치 말을 이어 붙인다. */
    static CoachSessionSnapshot after(CoachResult result) {
        return result.session();
    }

    String lastPrompt() {
        var prompts = ArgumentCaptor.forClass(String.class);
        verify(model, org.mockito.Mockito.atLeastOnce()).reply(eq(file), anyList(), prompts.capture());
        return prompts.getValue();
    }

    @Test void aStuckOpeningAsksOneQuestionAndKeepsButtonsAndHeardLinesForTheScreen() {
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(STUCK_OPENING);
        var result = coach().turn(fresh("stuck"), null, UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo("어떤 게 막혔어요?");
        assertThat(lastPrompt()).contains("[이번 첫 응답: 막힌 곳 풀기]", "[답 버튼]");
        var view = PurposeView.from("stuck", result.session().coachingState());
        assertThat(view.step()).isEqualTo("reason");
        assertThat(view.choices()).extracting(PurposeView.Choice::label)
                .containsExactly("감정이 안 따라와요", "대사가 입에 안 붙어요", "뭘 원하는지 모르겠어요", "잘 모르겠어요");
        assertThat(view.lines()).extracting(PurposeView.Line::at).containsExactly(3, 12);
        assertThat(view.scene().situation()).isEqualTo("헤어지자는 말을 들은 밤");
        assertThat(DirectVideoPracticeLoop.storedFlow(result.session().coachingState())).as("흐름 A/B에 넣지 않는다").isEmpty();
        assertThat(DirectVideoPracticeLoop.storedCoachModel(result.session().coachingState())).as("모델 A/B에 넣지 않는다").isEmpty();
    }

    @Test void pressingAButtonSkipsTheClassifierAndAsksWhichLine() {
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(STUCK_OPENING,
                "어느 대사에서 그랬어요?\n<보기>\n0:12 \"취소해\"\n0:03 \"가르쳐 줘\"\n처음부터 끝까지요\n</보기>");
        var opened = coach().turn(fresh("stuck"), null, UUID.randomUUID());
        var result = coach().turn(after(opened), "감정이 안 따라와요", UUID.randomUUID());
        verify(model, never()).classify(anyList(), anyString(), anyList());
        assertThat(result.reply().message()).isEqualTo("어느 대사에서 그랬어요?");
        assertThat(lastPrompt()).contains("이번 응답이 하는 단계: 어느 대사인지", "할 일: 어느 대사인지 묻기",
                "배우가 「어떻게 막혔는지」 질문에 한 답: 감정이 안 따라와요");
        var view = PurposeView.from("stuck", result.session().coachingState());
        assertThat(view.step()).isEqualTo("line");
        assertThat(view.choices().getFirst()).isEqualTo(new PurposeView.Choice("\"취소해\"", 12));
        assertThat(result.reply().status()).isNotEqualTo("complete");
    }

    @Test void theWrapClosesTheConversationWithoutAQuestionAndKeepsTheNextTake() {
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(STUCK_OPENING);
        var session = coach().turn(fresh("stuck"), null, UUID.randomUUID()).session();
        ObjectNode loop = (ObjectNode) session.coachingState().path(PurposeLoop.STATE_KEY);
        loop.put("step", 3);
        loop.putArray("choices").addObject().put("label", "매달리듯 붙잡기").putNull("at");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(
                "\"취소해\"에서 매달리듯 붙잡아 봐도 좋아요. 어때요?\n<다음 테이크>\"취소해\"에서 매달리듯 붙잡아 봐도 좋아요</다음 테이크>");
        var result = coach().turn(session, "매달리듯 붙잡기", UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo("\"취소해\"에서 매달리듯 붙잡아 봐도 좋아요.");
        assertThat(result.session().status()).isEqualTo("closed");
        var statuses = result.session().coachingState().path(DirectVideoPracticeLoop.STATE_KEY).path("statuses");
        assertThat(statuses.get(statuses.size() - 1).asText()).contains("할 일: " + PracticeLoopRouter.WRAP_UP,
                "다음 테이크: \"취소해\"에서 매달리듯 붙잡아 봐도 좋아요");
        assertThat(PurposeView.from("stuck", result.session().coachingState()).choices()).isEmpty();
    }

    @Test void anEvaluateOpeningKeepsItsSummaryAndTheResultCard() {
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("""
                <설계>
                영상: 연기
                관찰 근거: 화면·음성
                대사 확인: 확인됨
                대사 시간: 0:03 "가르쳐 줘" / 0:12 "취소해"
                장면: 이별 직후 | 헬레네 | 연인
                버릇: "취소해"에서 화내는 사람처럼 들려요
                </설계>
                <코치>
                "가르쳐 줘"까지는 붙잡는 게 보였어요.
                끝에서 화내는 쪽으로 가요.
                </코치>
                <카드>
                잘 된 곳: 0:03 "가르쳐 줘"에서 붙잡는 마음이 보여요
                아쉬운 곳: 0:12 "취소해"에서 화내는 쪽으로 들려요
                다음 테이크: "취소해"에서 붙잡듯 말해 봐도 좋아요
                </카드>""");
        var result = coach().turn(fresh("evaluate"), null, UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo("\"가르쳐 줘\"까지는 붙잡는 게 보였어요.\n끝에서 화내는 쪽으로 가요.");
        var view = PurposeView.from("evaluate", result.session().coachingState());
        assertThat(view.card().issue()).isEqualTo(new PurposeView.CardItem(12, "\"취소해\"에서 화내는 쪽으로 들려요"));
        assertThat(view.choices()).extracting(PurposeView.Choice::label).containsExactly("코치와 같이 고치기", "다른 것도 봐 주세요");
    }

    @Test void typedWordsAreClassifiedAndAQuestionIsAnsweredInTheSameStep() {
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(STUCK_OPENING,
                "\"취소해\"에선 화내는 쪽으로 들려요. 어디서 그랬어요?\n<보기>\n0:12 \"취소해\"\n</보기>");
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"not_yet\",\"question\"]}");
        var opened = coach().turn(fresh("stuck"), null, UUID.randomUUID());
        var result = coach().turn(after(opened), "제가 어디서 이상했어요?", UUID.randomUUID());
        verify(model).classify(anyList(), anyString(), anyList());
        assertThat(lastPrompt()).contains("할 일: 물음에 답하기", "이번 응답이 하는 단계: 어떻게 막혔는지");
        assertThat(PurposeView.from("stuck", result.session().coachingState()).step()).isEqualTo("reason");
        var turns = new ArrayList<CoachTurnSnapshot>(result.session().turns());
        assertThat(turns).hasSize(3);
    }
}
