package com.acttub.actingapi.platform.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
@Import(ValidationErrorContractIT.ContractController.class)
class ValidationErrorContractIT {
    private static final ObjectMapper JSON = new ObjectMapper();

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("validation_contract");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    JwtService jwt;

    /**
     * 실물 엔드포인트가 내는 도메인 검증 오류. 위의 케이스들은 합성 컨트롤러로 <b>형상</b>만
     * 보지만, 이것은 {@code MemoryController} 가 {@code ApiValidationException} 을 직접 만드는
     * 자리다 — {@code ctx.error} 가 사유 문자열이 아니라 <b>빈 객체</b>인 것까지가 계약이다.
     *
     * <p><b>계약 하네스에서 옮겨 온 기대값이다</b>(SOMA-403 2단계). 인벤토리 검사기는
     * {@code ApiException} 만 세므로 이 부류를 보지 못한다 — 그래서 손으로 옮긴다.
     */
    @Test
    void blankMemoryValueIsAFieldScopedValueError() throws Exception {
        UUID userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active'::user_status_t)", userId);

        MvcResult result = mvc.perform(put("/v2/me/memory/{field}", "goal")
                        .header("Authorization", "Bearer " + jwt.issueAccessToken(userId).value())
                        .contentType("application/json")
                        .content("{\"value\":\"   \"}"))
                .andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(422);
        assertThat(JSON.readTree(result.getResponse().getContentAsString()))
                .isEqualTo(JSON.readTree("""
                        {"detail":[{
                          "type":"value_error",
                          "loc":["body","value"],
                          "msg":"Value error, value must not be blank",
                          "input":"   ",
                          "ctx":{"error":{}}
                        }]}
                        """));
    }

    @Test
    void integralFloatIsAccepted() throws Exception {
        MvcResult result = postJson("/__test/validation/integer", "{\"size_bytes\":12.0}");
        assertThat(result.getResponse().getStatus()).isEqualTo(201);
    }

    @Test
    void nonNumericStringHasIntParsingError() throws Exception {
        assertError(
                "/__test/validation/integer",
                "{\"size_bytes\":\"abc\"}",
                """
                {"detail":[{"type":"int_parsing","loc":["body","size_bytes"],
                  "msg":"Input should be a valid integer, unable to parse string as an integer",
                  "input":"abc"}]}
                """);
    }

    @Test
    void fractionalFloatHasIntFromFloatError() throws Exception {
        assertError(
                "/__test/validation/integer",
                "{\"size_bytes\":12.5}",
                """
                {"detail":[{"type":"int_from_float","loc":["body","size_bytes"],
                  "msg":"Input should be a valid integer, got a number with a fractional part",
                  "input":12.5}]}
                """);
    }

    @Test
    void unknownRootPropertyHasExtraForbiddenError() throws Exception {
        assertError(
                "/__test/validation/shape",
                "{\"child\":{\"inner_name\":\"ok\"},\"surprise\":1}",
                """
                {"detail":[{"type":"extra_forbidden","loc":["body","surprise"],
                  "msg":"Extra inputs are not permitted","input":1}]}
                """);
    }

    @Test
    void nestedFieldUsesFullWirePathAndRejectedInput() throws Exception {
        assertError(
                "/__test/validation/shape",
                "{\"child\":{\"inner_name\":5}}",
                """
                {"detail":[{"type":"string_type","loc":["body","child","inner_name"],
                  "msg":"Input should be a valid string","input":5}]}
                """);
    }

    @Test
    void nestedUnknownPropertyUsesFullPath() throws Exception {
        assertError(
                "/__test/validation/shape",
                "{\"child\":{\"inner_name\":\"ok\",\"extra\":1}}",
                """
                {"detail":[{"type":"extra_forbidden","loc":["body","child","extra"],
                  "msg":"Extra inputs are not permitted","input":1}]}
                """);
    }

    @Test
    void arrayElementUsesNumericIndexAndRejectedInput() throws Exception {
        assertError(
                "/__test/validation/shape",
                "{\"child\":{\"inner_name\":\"ok\"},\"tags\":[\"ok\",9]}",
                """
                {"detail":[{"type":"string_type","loc":["body","tags",1],
                  "msg":"Input should be a valid string","input":9}]}
                """);
    }

    @Test
    void badUuidHasUuidParsingErrorAndContext() throws Exception {
        assertError(
                "/__test/validation/shape",
                "{\"child\":{\"inner_name\":\"ok\"},\"doc_id\":\"not-a-uuid\"}",
                """
                {"detail":[{"type":"uuid_parsing","loc":["body","doc_id"],
                  "msg":"Input should be a valid UUID, invalid character: found `n` at 1",
                  "input":"not-a-uuid","ctx":{"error":"invalid character: found `n` at 1"}}]}
                """);
    }

    @Test
    void badEnumHasExpectedValuesInMessageAndContext() throws Exception {
        assertError(
                "/__test/validation/shape",
                "{\"child\":{\"inner_name\":\"ok\"},\"kind\":\"zzz\"}",
                """
                {"detail":[{"type":"enum","loc":["body","kind"],
                  "msg":"Input should be 'a' or 'b'","input":"zzz",
                  "ctx":{"expected":"'a' or 'b'"}}]}
                """);
    }

    @Test
    void missingNestedObjectEchoesEnclosingParentObject() throws Exception {
        assertError(
                "/__test/validation/shape",
                "{\"tags\":[\"ok\"]}",
                """
                {"detail":[{"type":"missing","loc":["body","child"],
                  "msg":"Field required","input":{"tags":["ok"]}}]}
                """);
    }

    private void assertError(String path, String request, String expected) throws Exception {
        MvcResult result = postJson(path, request);
        assertThat(result.getResponse().getStatus()).isEqualTo(422);
        JsonNode actual = JSON.readTree(result.getResponse().getContentAsString());
        assertThat(actual).isEqualTo(JSON.readTree(expected));
    }

    private MvcResult postJson(String path, String request) throws Exception {
        return mvc.perform(post(path).contentType("application/json").content(request)).andReturn();
    }

    @TestConfiguration(proxyBeanMethods = false)
    @RestController
    static class ContractController {
        @PostMapping("/__test/validation/integer")
        ResponseEntity<Void> integer(@RequestBody IntegerBody body) {
            return ResponseEntity.status(201).build();
        }

        @PostMapping("/__test/validation/shape")
        ResponseEntity<Void> shape(@Valid @RequestBody ShapeBody body) {
            return ResponseEntity.status(201).build();
        }
    }

    record IntegerBody(@JsonProperty("size_bytes") Long sizeBytes) {
    }

    record ShapeBody(
            @Valid @NotNull Child child,
            List<String> tags,
            @JsonProperty("doc_id") UUID docId,
            Kind kind) {
    }

    record Child(@NotNull @JsonProperty("inner_name") String innerName) {
    }

    enum Kind {
        a,
        b
    }
}
