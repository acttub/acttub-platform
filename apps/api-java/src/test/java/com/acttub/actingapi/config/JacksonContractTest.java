package com.acttub.actingapi.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;
import org.springframework.context.annotation.Import;

/**
 * 직렬화 계약 회귀 테스트. {@code @JsonTest} 라 DB 가 필요 없다.
 *
 * <p>여기서 깨지면 프론트가 조용히 깨진다 — {@code apps/web} 이
 * {@code spec/openapi.json} 으로 타입을 만들기 때문이다 (/SPEC.md §1).
 */
@JsonTest
// @JsonTest 는 임의의 @Configuration 을 스캔하지 않는다. 실제 앱이 쓰는 그 설정을 그대로 끌어와야
// 이 테스트가 계약을 지키는 의미가 있다.
@Import(JacksonConfig.class)
class JacksonContractTest {

    @Autowired
    ObjectMapper objectMapper;

    record HasInstant(Instant at) {
    }

    record HasOffset(OffsetDateTime at) {
    }

    record Nullable(String value, String other) {
    }

    /** 요청 바디 16개 중 {@code additionalProperties: false} 인 9개 쪽 — 전역 설정으로 닫힌다. */
    record StrictRequest(String value) {
    }

    /**
     * unknown key 를 허용하는 7개 쪽 — {@code POST /v2/auth/login} 등.
     * 전역 스위치가 아니라 <b>DTO 어노테이션</b>으로 연다. 반대 방향은 Jackson 이
     * 표현하지 못한다 — {@code ignoreUnknown=false} 로는 거부를 강제할 수 없다.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record LenientRequest(String value) {
    }

    @Test
    @DisplayName("Instant 는 Z + 마이크로초 6자리 고정으로 나온다 (/SPEC.md §4)")
    void instantUsesSixFractionalDigits() throws Exception {
        String json = objectMapper.writeValueAsString(
                new HasInstant(Instant.parse("2026-08-06T01:02:03.456789Z")));

        assertThat(json).isEqualTo("{\"at\":\"2026-08-06T01:02:03.456789Z\"}");
    }

    @Test
    @DisplayName("소수부가 0이어도 6자리를 채운다 — Python isoformat() 은 통째로 생략했었다")
    void instantKeepsSixDigitsWhenZero() throws Exception {
        String json = objectMapper.writeValueAsString(
                new HasInstant(Instant.parse("2026-08-06T01:02:03Z")));

        assertThat(json).isEqualTo("{\"at\":\"2026-08-06T01:02:03.000000Z\"}");
    }

    @Test
    @DisplayName("나노초는 마이크로초로 잘린다 (자릿수 폭증 방지)")
    void instantTruncatesNanos() throws Exception {
        String json = objectMapper.writeValueAsString(
                new HasInstant(Instant.parse("2026-08-06T01:02:03.123456789Z")));

        assertThat(json).isEqualTo("{\"at\":\"2026-08-06T01:02:03.123456Z\"}");
    }

    @Test
    @DisplayName("OffsetDateTime 도 UTC 로 옮겨 Z 로 낸다 — +09:00 이 새 나가지 않는다")
    void offsetDateTimeNormalizesToUtc() throws Exception {
        String json = objectMapper.writeValueAsString(new HasOffset(
                OffsetDateTime.of(2026, 8, 6, 10, 2, 3, 456789000, ZoneOffset.ofHours(9))));

        assertThat(json).isEqualTo("{\"at\":\"2026-08-06T01:02:03.456789Z\"}");
    }

    @Test
    @DisplayName("null 필드는 키째 실려 나간다 — @JsonInclude(NON_NULL) 전역 사용 금지 (/SPEC.md §6 #3)")
    void nullFieldsAreEmitted() throws Exception {
        String json = objectMapper.writeValueAsString(new Nullable(null, "x"));

        assertThat(json).isEqualTo("{\"value\":null,\"other\":\"x\"}");
    }

    @Test
    @DisplayName("전역 기본은 unknown key 거부 (/SPEC.md §6-3)")
    void unknownKeyRejectedByDefault() {
        assertThatThrownBy(() -> objectMapper
                .readValue("{\"value\":\"a\",\"extra\":1}", StrictRequest.class))
                .isInstanceOf(UnrecognizedPropertyException.class);
    }

    @Test
    @DisplayName("허용 DTO 는 @JsonIgnoreProperties(ignoreUnknown=true) 로 연다 (/SPEC.md §6-3)")
    void unknownKeyAllowedPerDto() throws Exception {
        LenientRequest parsed = objectMapper
                .readValue("{\"value\":\"a\",\"extra\":1}", LenientRequest.class);

        assertThat(parsed.value()).isEqualTo("a");
    }
}
