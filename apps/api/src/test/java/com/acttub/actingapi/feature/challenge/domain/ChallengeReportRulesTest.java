package com.acttub.actingapi.feature.challenge.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** challenge.ai-report: 점수·등급·순위·칭찬·재능·합격 판정의 말은 띄어쓰기·대소문자와 무관하게 걸린다. */
class ChallengeReportRulesTest {
    @Test void challengeAiReport_catchesScoringPraiseTalentAndPassLanguage() {
        for (String text : new String[]{"점수로 보면 80점", "상위 10%에 듭니다", "등 급이 높다", "정말 잘 했어요", "재능이 보여요",
                "합격 가능성이 큽니다", "Your SCORE is high", "1위 참여작보다", "백분위로"}) {
            assertThat(ChallengeReportRules.forbiddenWord(text)).as(text).isNotNull();
        }
    }

    @Test void challengeAiReport_allowsObservationsAndDifferences() {
        for (String text : new String[]{"0.8초 동안 멈춘 뒤 대사를 시작했다", "다른 참여작들에서는 시선을 내리는 선택이 자주 보였다",
                "마지막 문장에서 목소리를 낮췄다", "영상 앞부분 2초는 소리가 들리지 않아 확인하지 못했다"}) {
            assertThat(ChallengeReportRules.forbiddenWord(text)).as(text).isNull();
        }
    }
}
