package com.acttub.actingapi.feature.practice.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

/** 영상 없이 말로 하는 시작(SOMA-745)의 요청 모양: 영상이 없으면 말로 하는 목적이어야 한다. */
class PracticeCreateRequestValidationTest {
    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    private int violations(UUID videoId, String purpose) {
        return violations(videoId, purpose, null);
    }

    private int violations(UUID videoId, String purpose, UUID readingSessionId) {
        return validator.validate(new PracticeDtos.CreateRequest(UUID.randomUUID(), videoId, null, null, null, purpose, null,
                readingSessionId)).size();
    }

    /** 리딩 녹음으로 시작(SOMA-791): 리딩 회차만 보내고 영상·목적은 뺀다. 목적 값 reading 은 앱이 보낼 수 없다. */
    @Test void aReadingStartCarriesNeitherAVideoNorAPurpose() {
        UUID reading = UUID.randomUUID();
        assertThat(violations(null, null, reading)).isZero();
        assertThat(violations(UUID.randomUUID(), null, reading)).isEqualTo(1);
        assertThat(violations(null, "character", reading)).isEqualTo(1);
        assertThat(violations(null, "reading", null)).as("reading 은 요청 목적 값이 아니다").isPositive();
    }

    @Test void withoutAVideoOnlyTheTalkPurposesPass() {
        assertThat(violations(null, "stuck")).isZero();
        assertThat(violations(null, "character")).isZero();
        assertThat(violations(null, "concern")).isZero();
        assertThat(violations(null, null)).as("영상도 목적도 없으면 예전처럼 422 배열").isEqualTo(1);
        assertThat(violations(null, "evaluate")).isEqualTo(1);
    }

    @Test void withAVideoAnyPurposeOrNoneStillPasses() {
        assertThat(violations(UUID.randomUUID(), null)).isZero();
        assertThat(violations(UUID.randomUUID(), "evaluate")).isZero();
        assertThat(violations(UUID.randomUUID(), "concern")).isZero();
        assertThat(violations(UUID.randomUUID(), "worry")).as("모르는 목적").isEqualTo(1);
    }
}
