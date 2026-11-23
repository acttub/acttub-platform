package com.acttub.actingapi.platform.json;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.function.Function;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
            "intValue", "longValue", "decimalValue", "bigIntegerValue", "canConvertToInt");

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
            LenientJson::canConvertToInt);

    static List<List<String>> rows() {
        return List.of(
            row("\"abc\"", "abc", "abc", "abc", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false"),
            row("\"\"", "", "", "", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false"),
            row("\"  \"", "  ", "  ", "  ", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false"),
            row("\"123\"", "123", "123", "123", "123", "123", "123", "123", "123.0", "123.0", "0", "0", "0", "0", "false"),
            row("\"-5\"", "-5", "-5", "-5", "-5", "-5", "-5", "-5", "-5.0", "-5.0", "0", "0", "0", "0", "false"),
            row("\"+7\"", "+7", "+7", "+7", "7", "7", "7", "7", "7.0", "7.0", "0", "0", "0", "0", "false"),
            row("\"1.5\"", "1.5", "1.5", "1.5", "1", "1", "1", "1", "1.5", "1.5", "0", "0", "0", "0", "false"),
            row("\"-1.5\"", "-1.5", "-1.5", "-1.5", "-1", "-1", "-1", "-1", "-1.5", "-1.5", "0", "0", "0", "0", "false"),
            row("\"true\"", "true", "true", "true", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false"),
            row("\"TRUE\"", "TRUE", "TRUE", "TRUE", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false"),
            row("\" true \"", " true ", " true ", " true ", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false"),
            row("\"false\"", "false", "false", "false", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false"),
            row("\" 12 \"", " 12 ", " 12 ", " 12 ", "12", "12", "12", "12", "12.0", "12.0", "0", "0", "0", "0", "false"),
            row("\"1e3\"", "1e3", "1e3", "1e3", "1000", "1000", "1000", "1000", "1000.0", "1000.0", "0", "0", "0", "0", "false"),
            row("\"0x10\"", "0x10", "0x10", "0x10", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false"),
            row("\"null\"", "null", "null", "null", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false"),
            row("\"2147483648\"", "2147483648", "2147483648", "2147483648", "0", "7", "2147483648", "2147483648", "2.147483648E9", "2.147483648E9", "0", "0", "0", "0", "false"),
            row("\"9223372036854775808\"", "9223372036854775808", "9223372036854775808", "9223372036854775808", "0", "7", "0", "7", "9.223372036854776E18", "9.223372036854776E18", "0", "0", "0", "0", "false"),
            row("\"NaN\"", "NaN", "NaN", "NaN", "0", "0", "0", "0", "NaN", "NaN", "0", "0", "0", "0", "false"),
            row("123", "123", "123", "123", "123", "123", "123", "123", "123.0", "123.0", "123", "123", "123", "123", "true"),
            row("-5", "-5", "-5", "-5", "-5", "-5", "-5", "-5", "-5.0", "-5.0", "-5", "-5", "-5", "-5", "true"),
            row("0", "0", "0", "0", "0", "0", "0", "0", "0.0", "0.0", "0", "0", "0", "0", "true"),
            row("2147483647", "2147483647", "2147483647", "2147483647", "2147483647", "2147483647", "2147483647", "2147483647", "2.147483647E9", "2.147483647E9", "2147483647", "2147483647", "2147483647", "2147483647", "true"),
            row("2147483648", "2147483648", "2147483648", "2147483648", "-2147483648", "-2147483648", "2147483648", "2147483648", "2.147483648E9", "2.147483648E9", "-2147483648", "2147483648", "2147483648", "2147483648", "false"),
            row("-2147483649", "-2147483649", "-2147483649", "-2147483649", "2147483647", "2147483647", "-2147483649", "-2147483649", "-2.147483649E9", "-2.147483649E9", "2147483647", "-2147483649", "-2147483649", "-2147483649", "false"),
            row("9223372036854775807", "9223372036854775807", "9223372036854775807", "9223372036854775807", "-1", "-1", "9223372036854775807", "9223372036854775807", "9.223372036854776E18", "9.223372036854776E18", "-1", "9223372036854775807", "9223372036854775807", "9223372036854775807", "false"),
            row("9223372036854775808", "9223372036854775808", "9223372036854775808", "9223372036854775808", "0", "0", "-9223372036854775808", "-9223372036854775808", "9.223372036854776E18", "9.223372036854776E18", "0", "-9223372036854775808", "9223372036854775808", "9223372036854775808", "false"),
            row("1.5", "1.5", "1.5", "1.5", "1", "1", "1", "1", "1.5", "1.5", "1", "1", "1.5", "1", "true"),
            row("-1.5", "-1.5", "-1.5", "-1.5", "-1", "-1", "-1", "-1", "-1.5", "-1.5", "-1", "-1", "-1.5", "-1", "true"),
            row("2.0", "2.0", "2.0", "2.0", "2", "2", "2", "2", "2.0", "2.0", "2", "2", "2.0", "2", "true"),
            row("1e3", "1000.0", "1000.0", "1000.0", "1000", "1000", "1000", "1000", "1000.0", "1000.0", "1000", "1000", "1000.0", "1000", "true"),
            row("1.0E10", "1.0E10", "1.0E10", "1.0E10", "2147483647", "2147483647", "10000000000", "10000000000", "1.0E10", "1.0E10", "2147483647", "10000000000", "1.0E+10", "10000000000", "false"),
            row("0.1", "0.1", "0.1", "0.1", "0", "0", "0", "0", "0.1", "0.1", "0", "0", "0.1", "0", "true"),
            row("1e400", "Infinity", "Infinity", "Infinity", "2147483647", "2147483647", "9223372036854775807", "9223372036854775807", "Infinity", "Infinity", "2147483647", "9223372036854775807", "EX:NumberFormatException", "EX:NumberFormatException", "false"),
            row("123456789012345678901234567890.5", "1.2345678901234568E29", "1.2345678901234568E29", "1.2345678901234568E29", "2147483647", "2147483647", "9223372036854775807", "9223372036854775807", "1.2345678901234568E29", "1.2345678901234568E29", "2147483647", "9223372036854775807", "1.2345678901234568E+29", "123456789012345680000000000000", "false"),
            row("true", "true", "true", "true", "1", "1", "1", "1", "1.0", "1.0", "0", "0", "0", "0", "false"),
            row("false", "false", "false", "false", "0", "0", "0", "0", "0.0", "0.0", "0", "0", "0", "0", "false"),
            row("null", "null", "d", "<null>", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false"),
            row("{}", "", "", "", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false"),
            row("{\"a\":1}", "", "", "", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false"),
            row("[]", "", "", "", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false"),
            row("[1]", "", "", "", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false"),
            row("MISSING", "", "d", "<null>", "0", "7", "0", "7", "0.0", "1.5", "0", "0", "0", "0", "false")
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
