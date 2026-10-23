package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 영상 없이 말로 하는 코칭(SOMA-745)이 실제 턴에서 타는 길: 영상 없이 모델 부르기, 목적별 첫 질문, 단계, 지어낸 대사 떼기. */
class DirectVideoCoachTalkTest {
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);

    static final String CONCERN_OPENING = """
            <설계>
            입력: 영상 없음 (말로 하는 코칭)
            장면: 없음
            대사 시간: 없음
            </설계>
            <코치>
            요즘 연기하면서 어떤 고민이 있어요?
            </코치>
            <보기>
            오디션이 걱정돼요
            혼자 연습이 막막해요
            연기가 늘지 않아요
            </보기>""";

    DirectVideoCoachTalkTest() {
        when(model.model()).thenReturn("gemini-3-flash-preview");
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}");
    }

    DirectVideoCoach coach() {
        // 연습 루프 스위치가 꺼져 있어도 말로 하는 회차는 목적별 코칭을 탄다.
        return new DirectVideoCoach(model, videos, storage, new RecordingFailureReporter(), new RecordingLlmTelemetry(), false);
    }

    static CoachSessionSnapshot fresh(String purpose) {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", 0, "그 외", "그 외", null, "open", "", List.of(),
                PriorContext.EMPTY, "legacy", 0, null, null).withCoachingState("three_layers_v1", 0, null, "open", "")
                .withSessionPurpose(PurposeLoop.TALK_PREFIX + purpose);
    }

    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<DirectVideoModel.Message>> histories() {
        return ArgumentCaptor.forClass((Class<List<DirectVideoModel.Message>>) (Class<?>) List.class);
    }

    @Test void theOpeningNeverTouchesAVideoAndAsksTheConcernQuestion() {
        when(model.reply(isNull(), anyList(), anyString())).thenReturn(CONCERN_OPENING);
        var result = coach().turn(fresh("concern"), null, UUID.randomUUID());

        assertThat(result.reply().message()).isEqualTo("요즘 연기하면서 어떤 고민이 있어요?");
        verifyNoInteractions(videos, storage);
        verify(model, never()).upload(any(), anyString());
        var prompts = ArgumentCaptor.forClass(String.class);
        var history = histories();
        verify(model).reply(isNull(), history.capture(), prompts.capture());
        assertThat(prompts.getValue()).contains("[영상 없이 말로 하는 코칭]", "[이번 첫 응답: 고민 상담 · 영상 없이]");
        assertThat(history.getValue()).as("모델은 빈 대화를 받지 않는다 — 시작 한 줄이 맨 앞에 있다").hasSize(1);
        assertThat(history.getValue().getFirst().role()).isEqualTo("user");
        assertThat(history.getValue().getFirst().text()).contains("영상 없이", "고민 상담");
        var view = PurposeView.from(PurposeLoop.TALK_PREFIX + "concern", result.session().coachingState());
        assertThat(view.purpose()).isEqualTo("concern");
        assertThat(view.step()).isEqualTo("concern");
        assertThat(view.choices()).extracting(PurposeView.Choice::label)
                .containsExactly("오디션이 걱정돼요", "혼자 연습이 막막해요", "연기가 늘지 않아요", "잘 모르겠어요");
        assertThat(result.session().status()).isEqualTo("open");
    }

    @Test void aNoVideoOpeningIsNeverCutAsNotActingOrTooShort() {
        when(model.reply(isNull(), anyList(), anyString())).thenReturn("""
                <설계>
                영상: 연기 아님: 영상이 없다
                </설계>
                <코치>
                어떤 게 막혔어요?
                </코치>""");
        var result = coach().turn(fresh("stuck"), null, UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo("어떤 게 막혔어요?");
        assertThat(result.session().status()).isEqualTo("open");
    }

    @Test void theSecondReplyUsesTheTalkStepAndTheTalkTurnPrompt() {
        when(model.reply(isNull(), anyList(), anyString())).thenReturn(CONCERN_OPENING,
                "그 마음이면 연습이 무겁겠어요. 언제 제일 긴장돼요?\n<보기>\n심사위원 앞에서요\n대사 직전에요\n연기 중간에요\n</보기>");
        var opened = coach().turn(fresh("concern"), null, UUID.randomUUID());
        var result = coach().turn(opened.session(), "오디션만 가면 너무 긴장해요", UUID.randomUUID());

        assertThat(result.reply().message()).isEqualTo("그 마음이면 연습이 무겁겠어요. 언제 제일 긴장돼요?");
        var prompts = ArgumentCaptor.forClass(String.class);
        verify(model, org.mockito.Mockito.times(2)).reply(isNull(), anyList(), prompts.capture());
        assertThat(prompts.getValue()).contains("[영상 없이 말로 하는 코칭]", "[고민 상담의 길 · 영상 없이]",
                "할 일: 무엇이 필요한지 묻기", "배우가 「어떤 고민인지」 질문에 한 답: 오디션만 가면 너무 긴장해요");
        assertThat(PurposeView.from(PurposeLoop.TALK_PREFIX + "concern", result.session().coachingState()).step()).isEqualTo("need");
        verifyNoInteractions(videos, storage);
    }

    @Test void stoppingATalkSessionClosesWithTheTalkLineInsteadOfANewTake() {
        when(model.reply(isNull(), anyList(), anyString())).thenReturn(CONCERN_OPENING);
        var opened = coach().turn(fresh("concern"), null, UUID.randomUUID());
        org.mockito.Mockito.clearInvocations(model);
        var done = coach().turn(opened.session(), "그만", UUID.randomUUID());

        assertThat(done.reply().message()).isEqualTo("오늘은 여기까지 해요. 다음에 또 이야기해요.");
        assertThat(done.session().closeReason()).isEqualTo("actor_finished");
        verify(model, never()).reply(any(), anyList(), anyString());
        verifyNoInteractions(videos, storage);
    }

    @Test void theFixedClosingDependsOnWhetherTheSessionHasAVideo() {
        assertThat(DirectVideoCoach.fixedClosing(java.util.Locale.KOREAN, true)).isEqualTo("오늘은 여기까지 해요. 다음에 또 이야기해요.");
        assertThat(DirectVideoCoach.fixedClosing(java.util.Locale.ENGLISH, true)).isEqualTo("That's it for today. Let's talk again next time.");
        assertThat(DirectVideoCoach.fixedClosing(null, true)).isEqualTo("오늘은 여기까지 해요. 다음에 또 이야기해요.");
        assertThat(DirectVideoCoach.fixedClosing(java.util.Locale.KOREAN, false)).isEqualTo("오늘은 여기까지 해요. 새 테이크를 올리면 이어서 해요.");
        assertThat(DirectVideoCoach.fixedClosing(java.util.Locale.ENGLISH, false))
                .isEqualTo("That's it for today. Upload a new take and we'll pick up from here.");
    }

    @Test void aLineTheActorNeverWroteIsDroppedFromTheReply() {
        when(model.reply(isNull(), anyList(), anyString())).thenReturn("""
                <설계>
                입력: 영상 없음 (말로 하는 코칭)
                장면: 모름 | 모름 | 모름
                대사 시간: 없음
                </설계>
                <코치>
                연습하는 인물은 어떤 사람이라고 봤어요?
                </코치>""");
        var opened = coach().turn(fresh("character"), null, UUID.randomUUID());
        when(model.reply(isNull(), anyList(), anyString())).thenReturn(
                "지안은 동훈에게만은 사람으로 보이고 싶어 해요.\n\"고마워요\"에서 고마움을 누르며 말해 봐도 좋아요.");
        var state = (com.fasterxml.jackson.databind.node.ObjectNode) opened.session().coachingState();
        ((com.fasterxml.jackson.databind.node.ObjectNode) state.path(PurposeLoop.STATE_KEY)).put("step", 2);
        var result = coach().turn(opened.session(), "동훈이 자길 사람으로 봐 줬으면 해요", UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo("지안은 동훈에게만은 사람으로 보이고 싶어 해요.");
    }
}
