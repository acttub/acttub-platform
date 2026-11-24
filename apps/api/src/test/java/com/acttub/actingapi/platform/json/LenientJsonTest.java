package com.acttub.actingapi.platform.json;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.function.Function;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * {@link LenientJson} 의 읽기 규칙을 값 표로 고정한다. 표는 Jackson 2.21 의 같은 이름 메서드를 실제로 돌려 뽑았다
 * (SOMA-1103). Jackson 3 으로 옮긴 뒤에도 이 표가 그대로 맞아야 저장된 JSON·모델 출력을 읽는 결과가 같다.
 * {@code <null>} 은 Java null, {@code EX:} 는 그 예외가 난다는 뜻이다.
 */
class LenientJsonTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final List<String> METHODS = List.of(
            "asText", "asText(d)", "asText(null)", "asInt", "asInt(7)", "asLong", "asLong(7)", "asDouble", "asDouble(1.5)",
            "intValue", "longValue", "decimalValue", "bigIntegerValue", "canConvertToInt", "asText(\"\")", "asBoolean",
            "asBoolean(true)");

    private static final List<Function<JsonNode, Object>> READS = List.of(
            LenientJson::asText,
            node -> LenientJson.asText(node, "d"),
            node -> LenientJson.asText(node, null),
            LenientJson::asInt,
            node -> LenientJson.asInt(node, 7),
            LenientJson::asLong,
            node -> LenientJson.asLong(node, 7),
            LenientJson::asDouble,
            node -> LenientJson.asDouble(node, 1.5),
            LenientJson::intValue,
            LenientJson::longValue,
            LenientJson::decimalValue,
            LenientJson::bigIntegerValue,
            LenientJson::canConvertToInt,
            node -> LenientJson.asText(node, ""),
            LenientJson::asBoolean,
            node -> LenientJson.asBoolean(node, true));

    static List<List<String>> rows() {
        return List.of(
            row("\"abc\"", "abc", "abc", "abc", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false", "abc", "false", "true"),
            row("\"\"", "", "", "", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false", "", "false", "true"),
            row("\"  \"", "  ", "  ", "  ", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false", "  ", "false", "true"),
            row("\"123\"", "123", "123", "123", "123", "123", "123", "123", "123.0", "123.0", "0", "0", "0", "0", "false", "123", "false", "true"),
            row("\"-5\"", "-5", "-5", "-5", "-5", "-5", "-5", "-5", "-5.0", "-5.0", "0", "0", "0", "0", "false", "-5", "false", "true"),
            row("\"+7\"", "+7", "+7", "+7", "7", "7", "7", "7", "7.0", "7.0", "0", "0", "0", "0", "false", "+7", "false", "true"),
            row("\"1.5\"", "1.5", "1.5", "1.5", "1", "1", "1", "1", "1.5", "1.5", "0", "0", "0", "0", "false", "1.5", "false", "true"),
            row("\"-1.5\"", "-1.5", "-1.5", "-1.5", "-1", "-1", "-1", "-1", "-1.5", "-1.5", "0", "0", "0", "0", "false", "-1.5", "false", "true"),
            row("\"true\"", "true", "true", "true", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false", "true", "true", "true"),
            row("\"TRUE\"", "TRUE", "TRUE", "TRUE", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false", "TRUE", "false", "true"),
            row("\" true \"", " true ", " true ", " true ", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false", " true ", "true", "true"),
            row("\"false\"", "false", "false", "false", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false", "false", "false", "false"),
            row("\" false\"", " false", " false", " false", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false", " false", "false", "false"),
            row("\" 12 \"", " 12 ", " 12 ", " 12 ", "12", "12", "12", "12", "12.0", "12.0", "0", "0", "0", "0", "false", " 12 ", "false", "true"),
            row("\"1e3\"", "1e3", "1e3", "1e3", "1000", "1000", "1000", "1000", "1000.0", "1000.0", "0", "0", "0", "0", "false", "1e3", "false", "true"),
            row("\"0x10\"", "0x10", "0x10", "0x10", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false", "0x10", "false", "true"),
            row("\"null\"", "null", "null", "null", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false", "null", "false", "true"),
            row("\"2147483648\"", "2147483648", "2147483648", "2147483648", "0", "7", "2147483648", "2147483648", "2.147483648E9", "2.147483648E9", "0", "0", "0", "0", "false", "2147483648", "false", "true"),
            row("\"9223372036854775808\"", "9223372036854775808", "9223372036854775808", "9223372036854775808", "0", "7", "0", "7", "9.223372036854776E18", "9.223372036854776E18", "0", "0", "0", "0", "false", "9223372036854775808", "false", "true"),
            row("\"NaN\"", "NaN", "NaN", "NaN", "0", "0", "0", "0", "NaN", "NaN", "0", "0", "0", "0", "false", "NaN", "false", "true"),
            row("123", "123", "123", "123", "123", "123", "123", "123", "123.0", "123.0", "123", "123", "123", "123", "true", "123", "true", "true"),
            row("-5", "-5", "-5", "-5", "-5", "-5", "-5", "-5", "-5.0", "-5.0", "-5", "-5", "-5", "-5", "true", "-5", "true", "true"),
            row("0", "0", "0", "0", "0", "0", "0", "0", "0.0", "0.0", "0", "0", "0", "0", "true", "0", "false", "false"),
            row("2147483647", "2147483647", "2147483647", "2147483647", "2147483647", "2147483647", "2147483647", "2147483647", "2.147483647E9", "2.147483647E9", "2147483647", "2147483647", "2147483647", "2147483647", "true", "2147483647", "true", "true"),
            row("2147483648", "2147483648", "2147483648", "2147483648", "-2147483648", "-2147483648", "2147483648", "2147483648", "2.147483648E9", "2.147483648E9", "-2147483648", "2147483648", "2147483648", "2147483648", "false", "2147483648", "true", "true"),
            row("-2147483649", "-2147483649", "-2147483649", "-2147483649", "2147483647", "2147483647", "-2147483649", "-2147483649", "-2.147483649E9", "-2.147483649E9", "2147483647", "-2147483649", "-2147483649", "-2147483649", "false", "-2147483649", "true", "true"),
            row("9223372036854775807", "9223372036854775807", "9223372036854775807", "9223372036854775807", "-1", "-1", "9223372036854775807", "9223372036854775807", "9.223372036854776E18", "9.223372036854776E18", "-1", "9223372036854775807", "9223372036854775807", "9223372036854775807", "false", "9223372036854775807", "true", "true"),
            row("9223372036854775808", "9223372036854775808", "9223372036854775808", "9223372036854775808", "0", "0", "-9223372036854775808", "-9223372036854775808", "9.223372036854776E18", "9.223372036854776E18", "0", "-9223372036854775808", "9223372036854775808", "9223372036854775808", "false", "9223372036854775808", "true", "true"),
            row("1.5", "1.5", "1.5", "1.5", "1", "1", "1", "1", "1.5", "1.5", "1", "1", "1.5", "1", "true", "1.5", "false", "true"),
            row("-1.5", "-1.5", "-1.5", "-1.5", "-1", "-1", "-1", "-1", "-1.5", "-1.5", "-1", "-1", "-1.5", "-1", "true", "-1.5", "false", "true"),
            row("2.0", "2.0", "2.0", "2.0", "2", "2", "2", "2", "2.0", "2.0", "2", "2", "2.0", "2", "true", "2.0", "false", "true"),
            row("1e3", "1000.0", "1000.0", "1000.0", "1000", "1000", "1000", "1000", "1000.0", "1000.0", "1000", "1000", "1000.0", "1000", "true", "1000.0", "false", "true"),
            row("1.0E10", "1.0E10", "1.0E10", "1.0E10", "2147483647", "2147483647", "10000000000", "10000000000", "1.0E10", "1.0E10", "2147483647", "10000000000", "1.0E+10", "10000000000", "false", "1.0E10", "false", "true"),
            row("0.1", "0.1", "0.1", "0.1", "0", "0", "0", "0", "0.1", "0.1", "0", "0", "0.1", "0", "true", "0.1", "false", "true"),
            row("1e400", "Infinity", "Infinity", "Infinity", "2147483647", "2147483647", "9223372036854775807", "9223372036854775807", "Infinity", "Infinity", "2147483647", "9223372036854775807", "EX:NumberFormatException", "EX:NumberFormatException", "false", "Infinity", "false", "true"),
            row("123456789012345678901234567890.5", "1.2345678901234568E29", "1.2345678901234568E29", "1.2345678901234568E29", "2147483647", "2147483647", "9223372036854775807", "9223372036854775807", "1.2345678901234568E29", "1.2345678901234568E29", "2147483647", "9223372036854775807", "1.2345678901234568E+29", "123456789012345680000000000000", "false", "1.2345678901234568E29", "false", "true"),
            row("true", "true", "true", "true", "1", "1", "1", "1", "1.0", "1.0", "0", "0", "0", "0", "false", "true", "true", "true"),
            row("false", "false", "false", "false", "0", "0", "0", "0", "0.0", "0.0", "0", "0", "0", "0", "false", "false", "false", "false"),
            row("null", "null", "d", "<null>", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false", "", "false", "true"),
            row("{}", "", "", "", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false", "", "false", "true"),
            row("{\"a\":1}", "", "", "", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false", "", "false", "true"),
            row("[]", "", "", "", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false", "", "false", "true"),
            row("[1]", "", "", "", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false", "", "false", "true"),
            row("MISSING", "", "d", "<null>", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false", "", "false", "true")
        );
    }

    private static List<String> row(String input, String... expected) {
        return java.util.stream.Stream.concat(java.util.stream.Stream.of(input), java.util.Arrays.stream(expected)).toList();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("rows")
    void readsLikeJackson2(List<String> row) throws Exception {
        String input = row.getFirst();
        JsonNode node = input.equals("MISSING") ? MAPPER.createObjectNode().path("x") : MAPPER.readTree(input);
        for (int i = 0; i < METHODS.size(); i++) {
            assertThat(read(READS.get(i), node)).as("%s.%s", input, METHODS.get(i)).isEqualTo(row.get(i + 1));
        }
    }

    private static String read(Function<JsonNode, Object> reader, JsonNode node) {
        try {
            Object value = reader.apply(node);
            return value == null ? "<null>" : String.valueOf(value);
        } catch (RuntimeException exception) {
            return "EX:" + exception.getClass().getSimpleName();
        }
    }
}
