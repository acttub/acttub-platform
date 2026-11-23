package com.acttub.actingapi.platform.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.Month;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;
import org.springframework.context.annotation.Import;

/**
 * 앱이 쓰는 JSON 매퍼의 기본 동작을 여러 타입으로 한 번에 고정한다(SOMA-1103). Jackson 3 은 기본값이 여럿 바뀌었다
 * (속성 이름 정렬, 뒤에 붙은 토큰 거부, 원시 타입 null 거부, enum toString, 날짜 표기 등). 기대값은 Jackson 2 매퍼를
 * 실제로 돌려 얻었다. 응답 본문·요청 해석이 여기서 갈린다.
 */
@JsonTest
@Import(JacksonConfig.class)
class JacksonDefaultsContractTest {

    @Autowired
    ObjectMapper mapper;

    enum Kind { FIRST_KIND, second }

    record Nested(String zeta, int alpha) {
    }

    /** 선언 순서가 알파벳 순서와 다르다. */
    record Zoo(
            String zeta, int alpha, long big, double half, double whole, float single, BigDecimal decimal,
            BigInteger integer, boolean flag, Integer missing, String text, Instant instant, OffsetDateTime offset,
            LocalDate date, LocalTime time, LocalDateTime local, ZonedDateTime zoned, Duration duration, Month month,
            java.util.Date utilDate, java.sql.Timestamp timestamp, java.sql.Date sqlDate, UUID uuid,
            Optional<String> present, Optional<String> absent, List<Object> list, Map<String, Object> map, Kind kind,
            byte[] bytes, char letter, Nested nested, JsonNode tree, double notNumber) {
    }

    /** 레코드가 아닌 클래스: 필드·게터 순서. */
    static final class Bean {
        private final String zeta = "z";
        private final int alpha = 1;

        public String getZeta() {
            return zeta;
        }

        public int getAlpha() {
            return alpha;
        }

        public boolean isReady() {
            return true;
        }

        public String getComputed() {
            return zeta + alpha;
        }
    }

    record Primitive(int count, boolean flag, double ratio) {
    }

    record Text(String value) {
    }

    record Times(Instant instant, OffsetDateTime offset, LocalDate date, Duration duration, Optional<String> maybe) {
    }

    record Choice(Kind kind) {
    }

    record Amount(BigDecimal amount, double ratio, long count) {
    }

    @Test
    @DisplayName("여러 타입을 담은 레코드를 Jackson 2 때와 같은 바이트로 쓴다")
    void writesEveryTypeAsBefore() throws Exception {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("z", 1);
        map.put("a", null);
        map.put("m", List.of("x"));
        Zoo zoo = new Zoo("마지막 \"따옴\" /슬래시\n줄   😀", 7, 9_007_199_254_740_993L, 0.5, 2.0, 1.25f,
                new BigDecimal("1.10"), new BigInteger("123456789012345678901234567890"), true, null, "",
                Instant.parse("2026-08-06T01:02:03.456789Z"),
                OffsetDateTime.of(2026, 8, 6, 10, 2, 3, 0, ZoneOffset.ofHours(9)),
                LocalDate.of(2026, 1, 2), LocalTime.of(3, 4, 5), LocalDateTime.of(2026, 1, 2, 3, 4, 5),
                ZonedDateTime.of(2026, 1, 2, 3, 4, 5, 0, ZoneOffset.UTC), Duration.ofSeconds(90), Month.MARCH,
                new java.util.Date(1_700_000_000_123L), new java.sql.Timestamp(1_700_000_000_123L),
                java.sql.Date.valueOf("2026-01-02"), UUID.fromString("123e4567-e89b-12d3-a456-426614174000"),
                Optional.of("있음"), Optional.empty(), List.of(1, "두", 3.5, false), map, Kind.FIRST_KIND,
                new byte[] {1, 2, 3}, 'ㄱ', new Nested("n", 2), mapper.readTree("{\"b\":1,\"a\":[2.50,null]}"),
                Double.NaN);

        assertThat(mapper.writeValueAsString(zoo)).isEqualTo(EXPECTED_ZOO);
        assertThat(mapper.writeValueAsString(new Bean())).isEqualTo(EXPECTED_BEAN);
        assertThat(mapper.writeValueAsString(Map.of("only", Kind.second))).isEqualTo("{\"only\":\"second\"}");
    }

    @Test
    @DisplayName("요청 본문 해석: 뒤에 붙은 토큰, 원시 타입 null, 형 맞추기, 날짜, enum 이 Jackson 2 때와 같다")
    void readsRequestBodiesAsBefore() {
        assertThat(read("{\"value\":\"a\"} trailing", Text.class)).isEqualTo(EXPECTED_TRAILING);
        assertThat(read("{\"value\":\"a\"}{\"value\":\"b\"}", Text.class)).isEqualTo(EXPECTED_SECOND_DOCUMENT);
        assertThat(read("{\"count\":null,\"flag\":null,\"ratio\":null}", Primitive.class)).isEqualTo(EXPECTED_NULL_PRIMITIVES);
        assertThat(read("{}", Primitive.class)).isEqualTo(EXPECTED_MISSING_PRIMITIVES);
        assertThat(read("{\"count\":\"3\",\"flag\":true,\"ratio\":1}", Primitive.class)).isEqualTo(EXPECTED_STRING_INT);
        assertThat(read("{\"count\":3,\"flag\":\"true\",\"ratio\":1}", Primitive.class)).isEqualTo(EXPECTED_STRING_BOOLEAN);
        assertThat(read("{\"count\":3,\"flag\":true,\"ratio\":\"1.5\"}", Primitive.class)).isEqualTo(EXPECTED_STRING_DOUBLE);
        assertThat(read("{\"count\":3.0,\"flag\":true,\"ratio\":1}", Primitive.class)).isEqualTo(EXPECTED_FLOAT_INT);
        assertThat(read("{\"value\":5}", Text.class)).isEqualTo(EXPECTED_NUMBER_TEXT);
        assertThat(read("{\"value\":[\"a\"]}", Text.class)).isEqualTo(EXPECTED_ARRAY_TEXT);
        assertThat(read("{\"instant\":1700000000,\"offset\":\"2026-08-06T10:02:03+09:00\",\"date\":\"2026-01-02\","
                + "\"duration\":\"PT90S\",\"maybe\":null}", Times.class)).isEqualTo(EXPECTED_TIMES);
        assertThat(read("{\"instant\":\"2026-08-06T01:02:03.4567891Z\",\"offset\":null,\"date\":null,\"duration\":90,"
                + "\"maybe\":\"x\"}", Times.class)).isEqualTo(EXPECTED_TIMES_NUMERIC);
        assertThat(read("{\"kind\":\"FIRST_KIND\"}", Choice.class)).isEqualTo("Choice[kind=FIRST_KIND]");
        assertThat(read("{\"kind\":\"first_kind\"}", Choice.class)).isEqualTo(EXPECTED_ENUM_CASE);
        assertThat(read("{\"kind\":0}", Choice.class)).isEqualTo(EXPECTED_ENUM_INDEX);
        assertThat(read("{\"amount\":1.10,\"ratio\":1e400,\"count\":9007199254740993}", Amount.class))
                .isEqualTo(EXPECTED_AMOUNT);
        assertThat(read("[{\"value\":\"a\"}]", Text.class)).isEqualTo(EXPECTED_ARRAY_ROOT);
        assertThat(read("{\"value\":\"a\",\"value\":\"b\"}", Text.class)).isEqualTo(EXPECTED_DUPLICATE);
    }

    private String read(String json, Class<?> type) {
        try {
            return String.valueOf(mapper.readValue(json, type));
        } catch (Exception exception) {
            return "ERROR";
        }
    }

    /**
     * Jackson 2 때와 한 곳만 다르다: {@code java.time.Month} 를 Jackson 2 는 {@code "MARCH"}, Jackson 3 은 0 부터 센
     * 숫자 {@code 2} 로 쓴다. 코드에 Month 를 JSON 으로 내는 곳이 없어 맞추지 않았다(SOMA-1103 진행 기록).
     */
    private static final String EXPECTED_ZOO = "{\"zeta\":\"마지막 \\\"따옴\\\" /슬래시\\n줄 \u2028 😀\",\"alpha\":7,\"big\":9007199254740993,\"half\":0.5,\"whole\":2.0,\"single\":1.25,\"decimal\":1.10,\"integer\":123456789012345678901234567890,\"flag\":true,\"missing\":null,\"text\":\"\",\"instant\":\"2026-08-06T01:02:03.456789Z\",\"offset\":\"2026-08-06T01:02:03.000000Z\",\"date\":\"2026-01-02\",\"time\":\"03:04:05\",\"local\":\"2026-01-02T03:04:05\",\"zoned\":\"2026-01-02T03:04:05Z\",\"duration\":\"PT1M30S\",\"month\":2,\"utilDate\":\"2023-11-14T22:13:20.123+00:00\",\"timestamp\":\"2023-11-14T22:13:20.123+00:00\",\"sqlDate\":\"2026-01-02\",\"uuid\":\"123e4567-e89b-12d3-a456-426614174000\",\"present\":\"있음\",\"absent\":null,\"list\":[1,\"두\",3.5,false],\"map\":{\"z\":1,\"a\":null,\"m\":[\"x\"]},\"kind\":\"FIRST_KIND\",\"bytes\":\"AQID\",\"letter\":\"ㄱ\",\"nested\":{\"zeta\":\"n\",\"alpha\":2},\"tree\":{\"b\":1,\"a\":[2.5,null]},\"notNumber\":\"NaN\"}";
    private static final String EXPECTED_BEAN = "{\"zeta\":\"z\",\"alpha\":1,\"ready\":true,\"computed\":\"z1\"}";
    private static final String EXPECTED_TRAILING = "Text[value=a]";
    private static final String EXPECTED_SECOND_DOCUMENT = "Text[value=a]";
    private static final String EXPECTED_NULL_PRIMITIVES = "ERROR";
    private static final String EXPECTED_MISSING_PRIMITIVES = "ERROR";
    private static final String EXPECTED_STRING_INT = "Primitive[count=3, flag=true, ratio=1.0]";
    private static final String EXPECTED_STRING_BOOLEAN = "ERROR";
    private static final String EXPECTED_STRING_DOUBLE = "ERROR";
    private static final String EXPECTED_FLOAT_INT = "Primitive[count=3, flag=true, ratio=1.0]";
    private static final String EXPECTED_NUMBER_TEXT = "ERROR";
    private static final String EXPECTED_ARRAY_TEXT = "ERROR";
    private static final String EXPECTED_TIMES = "Times[instant=2023-11-14T22:13:20Z, offset=2026-08-06T01:02:03Z, date=2026-01-02, duration=PT1M30S, maybe=Optional.empty]";
    private static final String EXPECTED_TIMES_NUMERIC = "Times[instant=2026-08-06T01:02:03.456789100Z, offset=null, date=null, duration=PT1M30S, maybe=Optional[x]]";
    private static final String EXPECTED_ENUM_CASE = "ERROR";
    private static final String EXPECTED_ENUM_INDEX = "Choice[kind=FIRST_KIND]";
    private static final String EXPECTED_AMOUNT = "Amount[amount=1.10, ratio=Infinity, count=9007199254740993]";
    private static final String EXPECTED_ARRAY_ROOT = "ERROR";
    /**
     * Jackson 2 와 다르다: 레코드에 같은 키가 두 번 오면 Jackson 2 는 정의 오류("No fallback setter/field defined for
     * creator property")를 내고 Jackson 3 은 뒤 값을 받는다. HTTP 요청 본문은 트리로 먼저 읽어 뒤 값이 이기므로 옮기기
     * 전후 같은 응답이다(boot-compare 의 duplicate-key·auth-duplicate-key 요청, SOMA-1103 진행 기록).
     */
    private static final String EXPECTED_DUPLICATE = "Text[value=b]";
}
