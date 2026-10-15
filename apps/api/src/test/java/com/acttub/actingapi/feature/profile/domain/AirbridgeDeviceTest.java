package com.acttub.actingapi.feature.profile.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class AirbridgeDeviceTest {

    @Test
    @DisplayName("36자 UUID 는 대소문자 상관없이 받는다")
    void acceptsUuids() {
        assertThat(AirbridgeDevice.isUsable("11111111-2222-3333-4444-555555555555")).isTrue();
        assertThat(AirbridgeDevice.isUsable("ABCDEF12-3456-7890-ABCD-EF1234567890")).isTrue();
    }

    @Test
    @DisplayName("모두 0 인 ID(광고 추적 제한)와 UUID 모양이 아닌 값은 받지 않는다")
    void rejectsUnusable() {
        assertThat(AirbridgeDevice.isUsable("00000000-0000-0000-0000-000000000000")).isFalse();
        assertThat(AirbridgeDevice.isUsable(null)).isFalse();
        assertThat(AirbridgeDevice.isUsable("")).isFalse();
        assertThat(AirbridgeDevice.isUsable("11111111222233334444555555555555")).isFalse();
        assertThat(AirbridgeDevice.isUsable("1111111g-2222-3333-4444-555555555555")).isFalse();
        assertThat(AirbridgeDevice.isUsable("11111111-2222-3333-4444-5555555555555")).isFalse();
    }
}
