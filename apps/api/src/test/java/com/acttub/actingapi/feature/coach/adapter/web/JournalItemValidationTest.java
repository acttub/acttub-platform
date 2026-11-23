package com.acttub.actingapi.feature.coach.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Set;
import java.util.stream.Collectors;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

/** 연습 노트 저장의 세 목록(practice·character·feedback)은 원소마다 검증된다 — 원소의 긴 글이 422 가 되는 근거다. */
class JournalItemValidationTest {

    private static final Validator VALIDATOR = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void eachItemOfEveryListIsValidated() throws Exception {
        String tooLong = "가".repeat(201);
        JournalDtos.UpdateRequest request = new ObjectMapper().readValue("""
                {"answers":{},
                 "practice":[{"text":"%s"}],
                 "character":[{"aspect":"wants"}],
                 "feedback":[{"text":"좋아요","at":-1}]}
                """.formatted(tooLong), JournalDtos.UpdateRequest.class);

        Set<String> paths = VALIDATOR.validate(request).stream()
                .map(violation -> violation.getPropertyPath().toString()).collect(Collectors.toSet());

        assertThat(paths).containsExactlyInAnyOrder("practice[0].text", "character[0].text", "feedback[0].at");
    }
}
