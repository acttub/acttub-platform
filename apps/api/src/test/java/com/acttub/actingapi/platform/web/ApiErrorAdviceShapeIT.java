package com.acttub.actingapi.platform.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 실제 앱의 필터·검증 인터셉터·Jackson 설정을 거친 422 오류 형상(apps/api/CONTRACT.md §6-2).
 *
 * <p>{@link ValidationErrorContractIT} 가 맨 위 칸의 형상을 본다면, 여기서는 Jackson 이 중첩 칸에서 멈출 때,
 * 칸이 통째로 null 일 때, Bean Validation 이 목록·맵 안에서 실패할 때, 경로·쿼리 값이 틀릴 때를 본다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
@Import(ApiErrorAdviceShapeIT.ShapeController.class)
class ApiErrorAdviceShapeIT {
    private static final ObjectMapper JSON = new ObjectMapper();

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("api_error_advice_shape");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @Test
    void nestedBooleanGivenAStringIsBoolType() throws Exception {
        assertBodyError("/__test/advice/nested", "{\"child\":{\"flag\":\"yes\"}}", """
                {"detail":[{"type":"bool_type","loc":["body","child","flag"],
                  "msg":"Input should be a valid boolean","input":"yes"}]}
                """);
    }

    @Test
    void nestedIntegerGivenABooleanIsIntType() throws Exception {
        assertBodyError("/__test/advice/nested", "{\"child\":{\"count\":true}}", """
                {"detail":[{"type":"int_type","loc":["body","child","count"],
                  "msg":"Input should be a valid integer","input":true}]}
                """);
    }

    @Test
    void nestedIntegerOutsideTheJavaRangeIsIntType() throws Exception {
        assertBodyError("/__test/advice/nested", "{\"child\":{\"count\":3000000000}}", """
                {"detail":[{"type":"int_type","loc":["body","child","count"],
                  "msg":"Input should be a valid integer","input":3000000000}]}
                """);
    }

    @Test
    void nestedIntegerGivenAFractionalStringIsIntParsing() throws Exception {
        assertBodyError("/__test/advice/nested", "{\"child\":{\"count\":\"12.5\"}}", """
                {"detail":[{"type":"int_parsing","loc":["body","child","count"],
                  "msg":"Input should be a valid integer, unable to parse string as an integer",
                  "input":"12.5"}]}
                """);
    }

    @Test
    void nestedIntegerGivenAWholeNumberStringIsAccepted() throws Exception {
        MvcResult result = postJson("/__test/advice/nested", "{\"child\":{\"count\":\" 12 \"}}");

        assertThat(result.getResponse().getStatus()).isEqualTo(201);
    }

    @Test
    @Disabled("버그: 16진 문자만으로 된 길이 틀린 UUID 의 msg 에 Jackson 문구와 Java 형 이름이 실린다")
    void nestedUuidOfHexCharactersWithTheWrongLengthReportsTheLengthLikePydantic() throws Exception {
        String reason = "invalid length: expected length 32 for simple format, found 3";
        assertBodyError("/__test/advice/nested", "{\"child\":{\"id\":\"abc\"}}", """
                {"detail":[{"type":"uuid_parsing","loc":["body","child","id"],
                  "msg":"Input should be a valid UUID, %s","input":"abc",
                  "ctx":{"error":"%s"}}]}
                """.formatted(reason, reason));
    }

    @Test
    void nestedEnumWithOneValueNamesThatValue() throws Exception {
        assertBodyError("/__test/advice/nested", "{\"child\":{\"single\":\"other\"}}", """
                {"detail":[{"type":"enum","loc":["body","child","single"],
                  "msg":"Input should be 'only'","input":"other","ctx":{"expected":"'only'"}}]}
                """);
    }

    @Test
    void nestedEnumWithNoValuesAsksForAValidEnumValue() throws Exception {
        assertBodyError("/__test/advice/nested", "{\"child\":{\"none\":\"other\"}}", """
                {"detail":[{"type":"enum","loc":["body","child","none"],
                  "msg":"Input should be a valid enum value","input":"other",
                  "ctx":{"expected":"a valid enum value"}}]}
                """);
    }

    @Test
    void nestedNumberGivenAStringIsAValueErrorWithJacksonsReason() throws Exception {
        assertBodyError("/__test/advice/nested", "{\"child\":{\"ratio\":\"abc\"}}", """
                {"detail":[{"type":"value_error","loc":["body","child","ratio"],
                  "msg":"Cannot coerce String value (\\"abc\\") to `java.lang.Double` value (but might if coercion using `CoercionConfig` was enabled)",
                  "input":"abc"}]}
                """);
    }

    @Test
    void listElementOfRecordsUsesTheIndexAndTheElementsField() throws Exception {
        assertBodyError("/__test/advice/nested", "{\"items\":[{\"count\":1},{\"flag\":3}]}", """
                {"detail":[{"type":"bool_type","loc":["body","items",1,"flag"],
                  "msg":"Input should be a valid boolean","input":3}]}
                """);
    }

    @Test
    void mapValueUsesTheMapKeyAsTheLocation() throws Exception {
        assertBodyError("/__test/advice/nested", "{\"labels\":{\"mood\":5}}", """
                {"detail":[{"type":"string_type","loc":["body","labels","mood"],
                  "msg":"Input should be a valid string","input":5}]}
                """);
    }

    @Test
    void nullForEveryNonNullableKindNamesTheExpectedType() throws Exception {
        assertBodyError(
                "/__test/advice/nulls",
                """
                {"s":null,"b":null,"i":null,"d":null,"u":null,"k":null,"l":null,"m":null,"c":null,"n":null,
                 "sd":null,"f":null,"big":null,"arr":null,"lo":null,"sh":null,"by":null,"bi":null}
                """,
                """
                {"detail":[
                  {"type":"string_type","loc":["body","s"],"msg":"Input should be a valid string","input":null},
                  {"type":"bool_type","loc":["body","b"],"msg":"Input should be a valid boolean","input":null},
                  {"type":"int_type","loc":["body","i"],"msg":"Input should be a valid integer","input":null},
                  {"type":"float_type","loc":["body","d"],"msg":"Input should be a valid number","input":null},
                  {"type":"uuid_type","loc":["body","u"],
                   "msg":"UUID input should be a string, bytes or UUID object","input":null},
                  {"type":"enum","loc":["body","k"],"msg":"Input should be 'a' or 'b'","input":null,
                   "ctx":{"expected":"'a' or 'b'"}},
                  {"type":"list_type","loc":["body","l"],"msg":"Input should be a valid list","input":null},
                  {"type":"dict_type","loc":["body","m"],"msg":"Input should be a valid dictionary","input":null},
                  {"type":"model_type","loc":["body","c"],
                   "msg":"Input should be a valid dictionary or object to extract fields from","input":null},
                  {"type":"string_type","loc":["body","sd"],"msg":"Input should be a valid string","input":null},
                  {"type":"float_type","loc":["body","f"],"msg":"Input should be a valid number","input":null},
                  {"type":"float_type","loc":["body","big"],"msg":"Input should be a valid number","input":null},
                  {"type":"list_type","loc":["body","arr"],"msg":"Input should be a valid list","input":null},
                  {"type":"int_type","loc":["body","lo"],"msg":"Input should be a valid integer","input":null},
                  {"type":"int_type","loc":["body","sh"],"msg":"Input should be a valid integer","input":null},
                  {"type":"int_type","loc":["body","by"],"msg":"Input should be a valid integer","input":null},
                  {"type":"int_type","loc":["body","bi"],"msg":"Input should be a valid integer","input":null}
                ]}
                """);
    }

    @Test
    void beanValidationInsideListsAndMapsIsOrderedByDeclarationAndIndex() throws Exception {
        assertBodyError(
                "/__test/advice/bean",
                """
                {"by_key":{"k":{"name":"x","count":0}},
                 "items":[{"name":"a","count":1},{"count":-1,"note":""}]}
                """,
                """
                {"detail":[
                  {"type":"missing","loc":["body","items",1,"name"],"msg":"Field required",
                   "input":{"count":-1,"note":""}},
                  {"type":"greater_than","loc":["body","items",1,"count"],"msg":"count must be positive",
                   "input":-1,"ctx":{"gt":0}},
                  {"type":"string_too_short","loc":["body","items",1,"note"],"msg":"note must not be empty",
                   "input":"","ctx":{"min_length":1}},
                  {"type":"greater_than","loc":["body","by_key","k","count"],"msg":"count must be positive",
                   "input":0,"ctx":{"gt":0}}
                ]}
                """);
    }

    @Test
    void classLevelConstraintIsABodyValueErrorWithTheWholeBody() throws Exception {
        assertBodyError(
                "/__test/advice/bean",
                "{\"items\":[],\"by_key\":{\"bad\":{\"name\":\"x\",\"count\":1}}}",
                """
                {"detail":[{"type":"value_error","loc":["body"],"msg":"Value error, key must not be bad",
                  "input":{"items":[],"by_key":{"bad":{"name":"x","count":1}}},"ctx":{"error":{}}}]}
                """);
    }

    @Test
    void stringOverAOneCharacterLimitUsesTheSingularAndUnknownKeysStillFail() throws Exception {
        assertBodyError("/__test/advice/bounded", "{\"one\":\"ab\",\"zzz\":1}", """
                {"detail":[
                  {"type":"string_too_long","loc":["body","one"],"msg":"String should have at most 1 character",
                   "input":"ab","ctx":{"max_length":1}},
                  {"type":"extra_forbidden","loc":["body","zzz"],"msg":"Extra inputs are not permitted","input":1}
                ]}
                """);
    }

    @Test
    void unmappedPathIsNotFound() throws Exception {
        MvcResult result = postJson("/__test/advice/nothing-here", "{\"one\":\"a\"}");

        assertThat(result.getResponse().getStatus()).isEqualTo(404);
        assertThat(JSON.readTree(result.getResponse().getContentAsString()))
                .isEqualTo(JSON.readTree("{\"detail\":\"Not Found\"}"));
    }

    @Test
    void nonIntegerQueryValueIsQueryIntParsing() throws Exception {
        MvcResult result = mvc.perform(get("/__test/advice/page").param("limit", "abc")).andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(422);
        assertThat(JSON.readTree(result.getResponse().getContentAsString())).isEqualTo(JSON.readTree("""
                {"detail":[{"type":"int_parsing","loc":["query","limit"],
                  "msg":"Input should be a valid integer, unable to parse string as an integer",
                  "input":"abc"}]}
                """));
    }

    @Test
    void pathValueOfAnotherTypeIsAPathValueError() throws Exception {
        MvcResult result = mvc.perform(get("/__test/advice/day/{day}", "nope")).andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(422);
        JsonNode error = JSON.readTree(result.getResponse().getContentAsString()).get("detail").get(0);
        assertThat(error.get("type").asText()).isEqualTo("value_error");
        assertThat(error.get("loc")).isEqualTo(JSON.readTree("[\"path\",\"day\"]"));
        assertThat(error.get("input").asText()).isEqualTo("nope");
        assertThat(error.get("msg").asText()).contains("java.time.LocalDate");
    }

    private void assertBodyError(String path, String request, String expected) throws Exception {
        MvcResult result = postJson(path, request);
        assertThat(result.getResponse().getStatus()).isEqualTo(422);
        assertThat(JSON.readTree(result.getResponse().getContentAsString())).isEqualTo(JSON.readTree(expected));
    }

    private MvcResult postJson(String path, String request) throws Exception {
        return mvc.perform(post(path).contentType("application/json").content(request)).andReturn();
    }

    @TestConfiguration(proxyBeanMethods = false)
    @RestController
    static class ShapeController {
        @PostMapping("/__test/advice/nested")
        ResponseEntity<Void> nested(@RequestBody NestedBody body) {
            return ResponseEntity.status(201).build();
        }

        @PostMapping("/__test/advice/nulls")
        ResponseEntity<Void> nulls(@RequestBody NullsBody body) {
            return ResponseEntity.status(201).build();
        }

        @PostMapping("/__test/advice/bean")
        ResponseEntity<Void> bean(@Valid @RequestBody BeanBody body) {
            return ResponseEntity.status(201).build();
        }

        @PostMapping("/__test/advice/bounded")
        ResponseEntity<Void> bounded(@RequestBody BoundedBody body) {
            return ResponseEntity.status(201).build();
        }

        @GetMapping("/__test/advice/page")
        ResponseEntity<Void> page(@RequestParam Integer limit) {
            return ResponseEntity.ok().build();
        }

        @GetMapping("/__test/advice/day/{day}")
        ResponseEntity<Void> day(@PathVariable LocalDate day) {
            return ResponseEntity.ok().build();
        }
    }

    record NestedBody(Inner child, List<Inner> items, Map<String, String> labels) {
    }

    record Inner(Boolean flag, Integer count, UUID id, Single single, None none, Double ratio) {
    }

    record NullsBody(
            String s,
            boolean b,
            Integer i,
            Double d,
            UUID u,
            Kind k,
            List<String> l,
            Map<String, String> m,
            Inner c,
            @Schema(nullable = true) String n,
            @Schema(description = "설명만 있고 null 은 받지 않는다") String sd,
            float f,
            java.math.BigDecimal big,
            String[] arr,
            long lo,
            Short sh,
            byte by,
            java.math.BigInteger bi) {
    }

    @com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = false)
    record BoundedBody(@Schema(maxLength = 1) String one) {
    }

    @NoBadKey
    record BeanBody(
            @com.fasterxml.jackson.annotation.JsonProperty("items") @Valid List<Item> items,
            @com.fasterxml.jackson.annotation.JsonProperty("by_key") @Valid Map<String, Item> byKey) {
    }

    record Item(
            @NotNull String name,
            @Positive(message = "count must be positive") Integer count,
            @Size(min = 1, message = "note must not be empty") String note) {
    }

    enum Kind {
        a,
        b
    }

    enum Single {
        only
    }

    enum None {
    }

    @Target(ElementType.TYPE)
    @Retention(RetentionPolicy.RUNTIME)
    @Constraint(validatedBy = NoBadKeyValidator.class)
    @interface NoBadKey {
        String message() default "key must not be bad";

        Class<?>[] groups() default {};

        Class<? extends Payload>[] payload() default {};
    }

    static class NoBadKeyValidator implements ConstraintValidator<NoBadKey, BeanBody> {
        @Override
        public boolean isValid(BeanBody body, ConstraintValidatorContext context) {
            return body.byKey() == null || !body.byKey().containsKey("bad");
        }
    }
}
