package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class ActorMaterialTest {

    @Test
    void acceptsTheThreeBlockageKindsAndRejectsOthersOrANegativeDuration() {
        assertThat(new ActorMaterial("상황", "인물", "목표", "표현", "", 0).durationMs()).isZero();
        assertThatThrownBy(() -> new ActorMaterial("", "", "", "연기", "", 1000))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("invalid blockage kind: 연기");
        assertThatThrownBy(() -> new ActorMaterial("", "", "", "분석", "", -1))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("durationMs must be non-negative");
    }
}
