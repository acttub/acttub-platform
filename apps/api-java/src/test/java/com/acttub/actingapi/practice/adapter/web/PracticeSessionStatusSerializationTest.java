package com.acttub.actingapi.practice.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.practice.adapter.web.PracticeSessionDtos.PracticeSessionStatusResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class PracticeSessionStatusSerializationTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void errorCodeIsAlwaysPresentUnderItsContractName() throws Exception {
        assertThat(mapper.readTree(mapper.writeValueAsBytes(
                new PracticeSessionStatusResponse("analyzing", null))))
                .isEqualTo(mapper.readTree("{\"status\":\"analyzing\",\"error_code\":null}"));
        assertThat(mapper.readTree(mapper.writeValueAsBytes(
                new PracticeSessionStatusResponse("failed", "gemini_timeout")))
                .path("error_code").textValue()).isEqualTo("gemini_timeout");
    }
}
