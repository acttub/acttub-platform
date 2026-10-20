package com.acttub.actingapi.feature.report.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.report.app.ActorExperience;
import org.junit.jupiter.api.Test;

/** 표현 성적표는 해 본 실험과 달라진 것이 모두 적혀야 만든다. 물음은 경험 진술이 아니다. */
class ExpressionReadinessTest {
    @Test void aTestedExperimentNeedsAnObservedChange() {
        assertThat(ExpressionReadiness.playable(true, "끝을 짧게", null)).isFalse();
        assertThat(ExpressionReadiness.playable(true, "끝을 짧게", "  ")).isFalse();
        assertThat(ExpressionReadiness.playable(true, "끝을 짧게", "덜 애원")).isTrue();
        assertThat(ExpressionReadiness.playable(null, "끝을 짧게", "덜 애원")).isFalse();
    }

    @Test void aQuestionIsNotAnExperience() {
        assertThat(ActorExperience.onlyExperience("편했어？")).isFalse();
        assertThat(ActorExperience.onlyExperience("편했어?")).isFalse();
        assertThat(ActorExperience.onlyExperience("편했어.")).isTrue();
    }
}
