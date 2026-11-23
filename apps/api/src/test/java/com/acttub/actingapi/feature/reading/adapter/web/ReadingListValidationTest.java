package com.acttub.actingapi.feature.reading.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

/** 대본 만들기·배역 고치기·진행 저장의 목록은 원소마다 검증된다 — 원소의 빠진 필수 값이 422 가 되는 근거다. */
class ReadingListValidationTest {

    private static final Validator VALIDATOR = Validation.buildDefaultValidatorFactory().getValidator();
    private static final ObjectMapper JSON = new ObjectMapper();

    private static Set<String> paths(Object request) {
        return VALIDATOR.validate(request).stream()
                .map(violation -> violation.getPropertyPath().toString()).collect(Collectors.toSet());
    }

    @Test
    void scriptCharactersAndLinesAreValidatedOneByOne() throws Exception {
        ScriptDtos.CreateRequest request = JSON.readValue("""
                {"request_id":"%s","title":"t","source":"typed","raw_text":"r",
                 "characters":[{"name":"햄릿"},{}],
                 "lines":[{"ordinal":1,"kind":"dialogue","character_index":0}]}
                """.formatted(UUID.randomUUID()), ScriptDtos.CreateRequest.class);

        assertThat(paths(request)).containsExactlyInAnyOrder("characters[1].name", "lines[0].text");
    }

    @Test
    void patchedCharactersAreValidatedOneByOne() throws Exception {
        ScriptDtos.PatchRequest request = JSON.readValue("{\"characters\":[{\"name\":\"햄릿\"}]}", ScriptDtos.PatchRequest.class);

        assertThat(paths(request)).containsExactly("characters[0].id");
    }

    @Test
    void lineResultsAreValidatedOneByOne() throws Exception {
        SessionDtos.ProgressRequest request = JSON.readValue(
                "{\"progress_seq\":1,\"line_results\":[{\"misses\":-1}]}", SessionDtos.ProgressRequest.class);

        assertThat(paths(request)).containsExactlyInAnyOrder("lineResults[0].lineId", "lineResults[0].misses");
    }
}
