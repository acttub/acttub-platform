package com.acttub.actingapi.feature.practice.app;

import static org.assertj.core.api.Assertions.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class PracticeExperienceTest {
    @Test void newContractRequiresCapabilityFlagAndVideoOnlyInput() {
        NewPracticeSession input = new NewPracticeSession(UUID.randomUUID(), "", "", "", "그 외", "그 외", null, null);
        assertThat(PracticeExperience.select("three_layers_v1", true, input)).isEqualTo("three_layers_v1");
        assertThat(PracticeExperience.select(null, true, input)).isEqualTo("legacy");
        assertThat(PracticeExperience.select("three_layers_v1", false, input)).isEqualTo("legacy");
        NewPracticeSession withGoal = new NewPracticeSession(input.uploadIntentId(), "", "", "상대를 붙잡고 싶다", "그 외", "그 외", null, null);
        assertThat(PracticeExperience.select("three_layers_v1", true, withGoal)).isEqualTo("legacy");
    }
}
