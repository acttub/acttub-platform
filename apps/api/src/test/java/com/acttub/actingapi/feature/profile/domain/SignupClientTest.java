package com.acttub.actingapi.feature.profile.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class SignupClientTest {

    @Test
    @DisplayName("헤더 값 모양(app/0.1.4)은 그대로 두고 앞뒤 공백만 걷는다")
    void keepsTheHeaderShape() {
        assertThat(SignupClient.of("app/0.1.4")).isEqualTo("app/0.1.4");
        assertThat(SignupClient.of(" web/0.1.0 ")).isEqualTo("web/0.1.0");
    }

    @Test
    @DisplayName("없거나 모양이 다르거나 32자를 넘으면 남기지 않는다")
    void dropsAnythingElse() {
        assertThat(SignupClient.of(null)).isNull();
        assertThat(SignupClient.of("")).isNull();
        assertThat(SignupClient.of("Mozilla/5.0 (iPhone; CPU)")).isNull();
        assertThat(SignupClient.of("app/" + "1".repeat(40))).isNull();
        assertThat(SignupClient.of("app")).isNull();
    }
}
