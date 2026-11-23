package com.acttub.actingapi.feature.auth.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Set;
import java.util.stream.Collectors;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

/** 가입 요청의 동의 목록은 원소마다 검증된다 — 원소의 빈 action 이 422 가 되는 근거다. */
class SignupDecisionValidationTest {

    private static final Validator VALIDATOR = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void eachDecisionIsValidated() throws Exception {
        AuthDtos.SignupRequest request = new ObjectMapper().readValue(
                "{\"signup_token\":\"t\",\"decisions\":[{\"document_id\":\"d\",\"action\":\"granted\"},{\"document_id\":\"d\"},null]}",
                AuthDtos.SignupRequest.class);

        Set<String> paths = VALIDATOR.validate(request).stream()
                .map(violation -> violation.getPropertyPath().toString()).collect(Collectors.toSet());

        assertThat(paths).containsExactlyInAnyOrder("decisions[1].action", "decisions[2].<list element>");
    }
}
