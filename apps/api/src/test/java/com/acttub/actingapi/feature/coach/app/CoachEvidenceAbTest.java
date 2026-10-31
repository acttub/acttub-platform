package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.integration.llm.StructuredJson;
import java.util.Locale;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

/** 근거·방법 비교(SOMA-955): 계정 배정, 상태 저장, 실험 쪽 파일 고르기. */
class CoachEvidenceAbTest {

    @Test
    void accountsSplitRoughlyByShareAndStayOnTheSameSide() {
        long on = IntStream.range(0, 2000).mapToObj(i -> new UUID(i * 7919L, i * 104729L))
                .filter(id -> DirectVideoCoach.EVIDENCE_ON.equals(DirectVideoCoach.evidenceByAccount(id, 50))).count();
        assertThat(on).isBetween(850L, 1150L);
        UUID actor = UUID.randomUUID();
        assertThat(DirectVideoCoach.evidenceByAccount(actor, 50)).isEqualTo(DirectVideoCoach.evidenceByAccount(actor, 50));
        assertThat(DirectVideoCoach.evidenceByAccount(actor, 0)).as("0 이면 모두 지금처럼(롤백)").isEqualTo(DirectVideoCoach.EVIDENCE_OFF);
        assertThat(DirectVideoCoach.evidenceByAccount(actor, 100)).isEqualTo(DirectVideoCoach.EVIDENCE_ON);
    }

    @Test
    void theFirstSavedSideIsKept() {
        var state = StructuredJson.MAPPER.createObjectNode();
        assertThat(DirectVideoPracticeLoop.storedEvidence(state)).isEmpty();
        DirectVideoPracticeLoop.rememberEvidence(state, DirectVideoCoach.EVIDENCE_ON);
        DirectVideoPracticeLoop.rememberEvidence(state, DirectVideoCoach.EVIDENCE_OFF);
        assertThat(DirectVideoPracticeLoop.storedEvidence(state)).isEqualTo(DirectVideoCoach.EVIDENCE_ON);
    }

    @Test
    void onlyKoreanExperimentConversationsUseTheEvidenceFiles() {
        Locale ko = Locale.KOREAN;
        assertThat(DirectVideoPrompts.practiceLoopTurn(ko, true)).contains("근거는 보이고 들린 것부터 말한다");
        assertThat(DirectVideoPrompts.practiceLoopTurn(ko, false)).doesNotContain("근거는 보이고 들린 것부터 말한다");
        assertThat(DirectVideoPrompts.practiceLoopTurn(Locale.ENGLISH, true)).isEqualTo(DirectVideoPrompts.practiceLoopTurn(Locale.ENGLISH));
        assertThat(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.WRAP_UP, ko, CoachFlows.A, true)).contains("예를 들면");
        assertThat(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.WRAP_UP, ko, CoachFlows.A, false))
                .isEqualTo(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.WRAP_UP, ko, CoachFlows.A));
        assertThat(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.GAP, ko, CoachFlows.B, true))
                .as("B 흐름의 tell 은 그대로").isEqualTo(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.GAP, ko, CoachFlows.B));
        assertThat(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.WANT, ko, CoachFlows.A, true))
                .isEqualTo(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.WANT, ko, CoachFlows.A));
    }
}
