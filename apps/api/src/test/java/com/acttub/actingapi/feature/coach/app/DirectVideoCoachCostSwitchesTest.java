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

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.platform.observability.LlmStep;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 무료 영상 코칭 비용 스위치: 분류 모델·기록 자르기, 무료 후속 답 영상 빼기, 공통 지시를 고정 앞부분으로 옮기기. 끄면 예전과 같다. */
class DirectVideoCoachCostSwitchesTest {
    final DirectVideoCoachCostTest f = new DirectVideoCoachCostTest();
    final DirectVideoModel model = f.model;

    /** 코치 말·배우 말이 번갈아 쌓인 후속 답 회차. */
    CoachSessionSnapshot later() {
        return f.session("누구를 봤어요?", "엄마를 봤어", "그때 엄마가 뭘 했어요?");
    }

    @SuppressWarnings("unchecked")
    List<DirectVideoModel.Message> classified(DirectVideoModel classifier) {
        var transcript = ArgumentCaptor.forClass(List.class);
        verify(classifier).classify(transcript.capture(), anyString(), anyList());
        return transcript.getValue();
    }

    // ---- 1. 분류 모델 분리·기록 자르기 ----

    @Test void byDefaultTheDefaultModelClassifiesTheWholeConversation() {
        f.coach(CoachVideoCache.NONE).turn(later(), "문을 막았어", UUID.randomUUID());
        assertThat(classified(model)).hasSize(4);
        var route = f.telemetry.calls().stream().filter(call -> call.step() == LlmStep.COACH_ROUTE).findFirst().orElseThrow();
        assertThat(route.model()).isEqualTo(DirectVideoCoachCostTest.MODEL);
        // 분류 요청에는 영상이 없다(분류 인터페이스에 영상 칸이 없다).
        verify(model, never()).reply(any(), anyList(), eq(DirectVideoPrompts.practiceLoopClassifier()));
    }

    @Test void aSeparateClassifierGetsOnlyTheLastMessages() {
        DirectVideoModel lite = mock(DirectVideoModel.class);
        when(lite.model()).thenReturn("gemini-3.1-flash-lite");
        when(lite.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}");
        f.coach(CoachVideoCache.NONE).withClassifier(lite, 2).turn(later(), "문을 막았어", UUID.randomUUID());

        List<DirectVideoModel.Message> sent = classified(lite);
        assertThat(sent).extracting(DirectVideoModel.Message::text).containsExactly("그때 엄마가 뭘 했어요?", "문을 막았어");
        verify(model, never()).classify(anyList(), anyString(), anyList());
        var route = f.telemetry.calls().stream().filter(call -> call.step() == LlmStep.COACH_ROUTE).findFirst().orElseThrow();
        assertThat(route.model()).isEqualTo("gemini-3.1-flash-lite");
        // 코치 답은 그대로 기본 모델이다.
        verify(model, atLeastOnce()).reply(eq(f.file), anyList(), anyString());
    }

    @Test void aHistoryLimitLargerThanTheConversationKeepsEverything() {
        f.coach(CoachVideoCache.NONE).withClassifier(null, 10).turn(later(), "문을 막았어", UUID.randomUUID());
        assertThat(classified(model)).hasSize(4);
    }

    // ---- 2. 무료 후속 답 영상 빼기 ----

    @Test void offTheFollowUpReplyStillSeesTheVideo() {
        f.coach(DirectVideoCoachCostTest.counting()).withFreeVideoFirstOnly(false).turn(later(), "문을 막았어", UUID.randomUUID());
        verify(model, atLeastOnce()).reply(eq(f.file), anyList(), anyString());
        verify(model, never()).reply(isNull(), anyList(), anyString());
    }

    @Test @SuppressWarnings("unchecked")
    void aFreeActorsFollowUpGoesWithoutTheVideoAndKeepsTheHiddenDesign() {
        var coach = f.coach(DirectVideoCoachCostTest.counting()).withFreeVideoFirstOnly(true);
        coach.turn(later(), "문을 막았어", UUID.randomUUID());

        var history = ArgumentCaptor.forClass(List.class);
        verify(model, atLeastOnce()).reply(isNull(), history.capture(), anyString());
        verify(model, never()).reply(eq(f.file), anyList(), anyString());
        verify(model, never()).upload(any(), anyString());
        assertThat(f.lastTurn().metadata()).containsEntry("video_omitted", "true").containsEntry("video_budget_omitted", "false");
        // 첫 답의 숨은 <설계>는 대화 기록의 첫 코치 말에 되붙어 영상 없는 답에도 들어간다.
        List<DirectVideoModel.Message> sent = history.getValue();
        assertThat(sent.getFirst().role()).isEqualTo("model");
        assertThat(sent.getFirst().text()).startsWith("<설계>\n버릇: 말끝\n</설계>\n<코치>\n누구를 봤어요?");
    }

    @Test void aNewVideoInTheSameSessionIsSeenOnceThenOmittedAgain() {
        var coach = f.coach(DirectVideoCoachCostTest.counting()).withFreeVideoFirstOnly(true);
        coach.turn(later(), "문을 막았어", UUID.randomUUID());
        verify(model, never()).reply(eq(f.file), anyList(), anyString());

        // 같은 회차에 다시 찍은 영상(원본 etag 가 다름): 그 첫 답은 영상을 본다.
        f.source("etag-2");
        coach.turn(later(), "문을 막았어", UUID.randomUUID());
        verify(model, times(1)).reply(eq(f.file), anyList(), anyString());
        // 그 뒤 답은 다시 영상 없이 쓴다.
        coach.turn(later(), "문을 막았어", UUID.randomUUID());
        verify(model, times(1)).reply(eq(f.file), anyList(), anyString());
    }

    @Test void aProActorKeepsTheVideo() {
        f.coach(DirectVideoCoachCostTest.counting()).withFreeVideoFirstOnly(true)
                .withProMemory(userId -> true, CoachProMemory.NONE)
                .turn(later(), "문을 막았어", UUID.randomUUID());
        verify(model, atLeastOnce()).reply(eq(f.file), anyList(), anyString());
        verify(model, never()).reply(isNull(), anyList(), anyString());
    }

    @Test void aFailingProCheckKeepsTheVideo() {
        f.coach(DirectVideoCoachCostTest.counting()).withFreeVideoFirstOnly(true)
                .withProMemory(userId -> { throw new IllegalStateException("billing down"); }, CoachProMemory.NONE)
                .turn(later(), "문을 막았어", UUID.randomUUID());
        verify(model, atLeastOnce()).reply(eq(f.file), anyList(), anyString());
    }

    // ---- 4. 공통 지시를 고정 앞부분으로 ----

    /** 영상 없이 보낸 코치 답 지시(무료 후속 답). */
    String promptWithoutVideo(DirectVideoCoach coach, CoachSessionSnapshot session, String actorText) {
        reset(model);
        f.rewire();
        var prompts = ArgumentCaptor.forClass(String.class);
        coach.turn(session, actorText, UUID.randomUUID());
        verify(model, atLeastOnce()).reply(isNull(), anyList(), prompts.capture());
        return prompts.getAllValues().getFirst();
    }

    /** 영상 없는 무료 후속 답 코치. */
    DirectVideoCoach freeNoVideo() {
        return f.coach(DirectVideoCoachCostTest.counting()).withStablePrefix(true).withFreeVideoFirstOnly(true);
    }

    /** 첫 응답 설계에 근본 문제(목적)가 적힌 후속 답 회차. */
    CoachSessionSnapshot withRoot(CoachSessionSnapshot session) {
        ((tools.jackson.databind.node.ObjectNode) session.coachingState().path(DirectVideoPracticeLoop.STATE_KEY))
                .put("design", "버릇: 말끝\n근본 문제: 2 목적성이 안 보인다");
        return session;
    }

    static String fixedOf(String prompt) {
        return prompt.substring(0, prompt.indexOf(DirectVideoModel.TURN_BOUNDARY));
    }

    @Test void staticRulesMoveIntoTheFixedPartUnchanged() {
        String rules = DirectVideoPrompts.practiceLoopTurn() + "\n\n";
        String before = promptWithoutVideo(freeNoVideo(), later(), "문을 막았어");
        String moved = promptWithoutVideo(freeNoVideo().withStaticRulesInPrefix(true), later(), "문을 막았어");
        String movedLater = promptWithoutVideo(freeNoVideo().withStaticRulesInPrefix(true),
                f.session("누구를 봤어요?", "엄마를 봤어", "그때 엄마가 뭘 했어요?", "문을 막았어", "막고 뭘 했어요?"), "울었어");

        String fixed = moved.substring(0, moved.indexOf(DirectVideoModel.TURN_BOUNDARY));
        String turn = moved.substring(moved.indexOf(DirectVideoModel.TURN_BOUNDARY));
        assertThat(fixed).endsWith(rules);
        assertThat(turn).doesNotContain(DirectVideoPrompts.practiceLoopTurn());
        // 문구는 그대로이고 위치만 바뀌었다: 공통 지시를 경계 뒤 맨 앞으로 되돌리면 예전 지시문과 같다.
        assertThat(moved.replace(rules + DirectVideoModel.TURN_BOUNDARY, DirectVideoModel.TURN_BOUNDARY + rules)).isEqualTo(before);
        // 고정 앞부분은 후속 답마다 바이트까지 같다.
        assertThat(movedLater.substring(0, movedLater.indexOf(DirectVideoModel.TURN_BOUNDARY))).isEqualTo(fixed);
    }

    @Test void offOrWithoutTheStablePrefixTheInstructionIsUnchanged() {
        String before = f.prompt(f.coach(CoachVideoCache.NONE).withStablePrefix(true), later(), "문을 막았어");
        String off = f.prompt(f.coach(CoachVideoCache.NONE).withStablePrefix(true).withStaticRulesInPrefix(false),
                later(), "문을 막았어");
        assertThat(off).isEqualTo(before);

        String plain = f.prompt(f.coach(CoachVideoCache.NONE), later(), "문을 막았어");
        String plainOn = f.prompt(f.coach(CoachVideoCache.NONE).withStaticRulesInPrefix(true), later(), "문을 막았어");
        assertThat(plainOn).isEqualTo(plain).doesNotContain(DirectVideoModel.TURN_BOUNDARY);
    }

    @Test void rootAndExamplesMoveIntoTheFixedPartAndStayTheSame() {
        // 이번 답 지시에 실리는 모양(줄마다 앞뒤 공백을 떼고 빈 줄을 뺀다).
        String root = DirectVideoPrompts.practiceLoopRoot("2 목적성이 안 보인다", null).lines().map(String::strip)
                .filter(line -> !line.isEmpty()).collect(java.util.stream.Collectors.joining("\n"));
        assertThat(root).isNotEmpty();
        String before = promptWithoutVideo(freeNoVideo(), withRoot(later()), "문을 막았어");
        assertThat(before.substring(before.indexOf(DirectVideoModel.TURN_BOUNDARY))).contains(root, "[예시 답 칸]");

        var coach = freeNoVideo().withStaticRulesInPrefix(true).withRootInPrefix(true);
        String moved = promptWithoutVideo(coach, withRoot(later()), "문을 막았어");
        String movedLater = promptWithoutVideo(freeNoVideo().withStaticRulesInPrefix(true).withRootInPrefix(true),
                withRoot(f.session("누구를 봤어요?", "엄마를 봤어", "그때 엄마가 뭘 했어요?", "문을 막았어", "막고 뭘 했어요?")), "울었어");
        String rules = DirectVideoPrompts.practiceLoopTurn() + "\n\n";
        String fixed = fixedOf(moved);
        String turn = moved.substring(moved.indexOf(DirectVideoModel.TURN_BOUNDARY));
        // 공통 지시 → 근본 문제를 푸는 길 → 예시 답 칸 순서로 고정 앞부분 끝에 붙는다. 문구는 그대로다.
        assertThat(fixed).isEqualTo(fixedOf(before) + rules + root + "\n\n" + AnswerExamples.INSTRUCTION.strip() + "\n\n");
        // 이번 답 지시는 옮긴 칸만 빠졌다.
        String beforeTurn = before.substring(before.indexOf(DirectVideoModel.TURN_BOUNDARY))
                .replace(DirectVideoModel.TURN_BOUNDARY + rules, DirectVideoModel.TURN_BOUNDARY)
                .replace("\n" + root, "").replace(AnswerExamples.INSTRUCTION, "");
        assertThat(turn).isEqualTo(beforeTurn).doesNotContain("[예시 답 칸]");
        // 고정 앞부분은 후속 답마다 바이트까지 같다.
        assertThat(fixedOf(movedLater)).isEqualTo(fixed);
    }

    @Test void proOrVideoRepliesAreByteForByteUnchangedWithTheSwitchesOn() {
        // Pro: 영상 빼기를 켜도 영상이 붙고, 옮기기를 켜도 예전 지시문과 같다.
        String proBefore = f.prompt(f.coach(DirectVideoCoachCostTest.counting()).withStablePrefix(true)
                .withProMemory(userId -> true, CoachProMemory.NONE), withRoot(later()), "문을 막았어");
        String proOn = f.prompt(f.coach(DirectVideoCoachCostTest.counting()).withStablePrefix(true).withFreeVideoFirstOnly(true)
                .withStaticRulesInPrefix(true).withRootInPrefix(true)
                .withProMemory(userId -> true, CoachProMemory.NONE), withRoot(later()), "문을 막았어");
        assertThat(proOn).isEqualTo(proBefore);
        // 무료라도 영상이 붙는 답(영상 빼기 꺼짐)은 그대로다.
        String videoBefore = f.prompt(f.coach(DirectVideoCoachCostTest.counting()).withStablePrefix(true), withRoot(later()), "문을 막았어");
        String videoOn = f.prompt(f.coach(DirectVideoCoachCostTest.counting()).withStablePrefix(true)
                .withStaticRulesInPrefix(true).withRootInPrefix(true), withRoot(later()), "문을 막았어");
        assertThat(videoOn).isEqualTo(videoBefore);
    }

    // ---- 5. 무료 영상 없는 후속 답 모델 ----

    DirectVideoModel lite() {
        DirectVideoModel lite = mock(DirectVideoModel.class);
        when(lite.model()).thenReturn("gemini-3.1-flash-lite");
        when(lite.reply(isNull(), anyList(), anyString())).thenReturn(DirectVideoCoachCostTest.REPLY);
        return lite;
    }

    @Test void aFreeFollowUpWithoutTheVideoGoesToTheFollowUpModel() {
        DirectVideoModel lite = lite();
        freeNoVideo().withFollowupModel(lite).turn(later(), "문을 막았어", UUID.randomUUID());
        verify(lite).reply(isNull(), anyList(), anyString());
        verify(model, never()).reply(any(), anyList(), anyString());
        assertThat(f.lastTurn().model()).isEqualTo("gemini-3.1-flash-lite");
    }

    @Test void anEmptyFollowUpIsRewrittenByTheFollowUpModelThenByTheDefaultModel() {
        DirectVideoModel lite = lite();
        when(lite.reply(isNull(), anyList(), anyString())).thenReturn("");
        when(lite.replyLight(isNull(), anyList(), anyString())).thenReturn("");
        when(model.reply(isNull(), anyList(), anyString())).thenReturn(DirectVideoCoachCostTest.REPLY);
        freeNoVideo().withFollowupModel(lite).turn(later(), "문을 막았어", UUID.randomUUID());
        // 처음 답과 빈 답 다시 쓰기는 후속 답 모델, 가볍게 한 번 더도 후속 답 모델, 그래도 비면 기본 모델이 한 번 쓴다.
        verify(lite, times(2)).reply(isNull(), anyList(), anyString());
        verify(lite).replyLight(isNull(), anyList(), anyString());
        verify(model, times(1)).reply(isNull(), anyList(), anyString());
    }

    @Test void theFollowUpModelLeavesProVideoAndFirstRepliesAlone() {
        DirectVideoModel lite = lite();
        // Pro: 영상 빼기를 켜도 영상이 붙고 기본 모델이 쓴다.
        f.coach(DirectVideoCoachCostTest.counting()).withFreeVideoFirstOnly(true).withFollowupModel(lite)
                .withProMemory(userId -> true, CoachProMemory.NONE).turn(later(), "문을 막았어", UUID.randomUUID());
        // 무료라도 영상이 붙는 후속 답(영상 빼기 꺼짐)은 기본 모델이다.
        f.coach(DirectVideoCoachCostTest.counting()).withFollowupModel(lite).turn(later(), "문을 막았어", UUID.randomUUID());
        // 첫 답도 기본 모델이다.
        f.coach(DirectVideoCoachCostTest.counting()).withFreeVideoFirstOnly(true).withFollowupModel(lite)
                .turn(f.session(), null, UUID.randomUUID());
        verify(lite, never()).reply(any(), anyList(), anyString());
        verify(lite, never()).replyStream(any(), anyList(), anyString(), any());
        verify(model, times(3)).reply(eq(f.file), anyList(), anyString());
    }

    @Test void theFirstReplyIsUnchangedAndStillSeesTheVideo() {
        var first = f.session();
        String before = f.prompt(f.coach(CoachVideoCache.NONE).withStablePrefix(true), first, null);
        String on = f.prompt(f.coach(DirectVideoCoachCostTest.counting()).withStablePrefix(true).withStaticRulesInPrefix(true)
                .withFreeVideoFirstOnly(true).withClassifier(mock(DirectVideoModel.class), 4), first, null);
        assertThat(on).isEqualTo(before);
        verify(model, never()).classify(anyList(), anyString(), anyList());
    }
}
