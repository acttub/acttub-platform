package com.acttub.actingapi.platform.json;

import java.math.BigDecimal;
import java.math.BigInteger;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * JSON 트리에서 값을 느슨하게 읽는 규칙. 형이 안 맞으면 예외 대신 기본값을 주고, 문자열 숫자·소수·불리언을
 * 잘라서라도 바꾼다(예: {@code "1.5"} → 1, {@code " 12 "} → 12, JSON null 의 글자 → {@code "null"}).
 *
 * <p>이 코드는 처음부터 Jackson 2 의 {@code JsonNode.asText()}·{@code asInt()} 같은 메서드의 이 규칙 위에서
 * 짜였다. Jackson 3 의 같은 이름 메서드는 형이 안 맞으면 예외를 던지고 잘라 바꾸지 않는다. 저장된 JSON·모델
 * 출력·요청 본문을 읽는 결과가 바뀌지 않게, 같은 결과를 내는 Jackson 3 메서드가 없는 읽기는 여기를 거친다.
 * 규칙은 {@code LenientJsonTest} 의 값 표가 고정한다.
 */
public final class LenientJson {

    private LenientJson() {
    }

    public static String asText(JsonNode node) {
        return node.asText();
    }

    public static String asText(JsonNode node, String defaultValue) {
        return node.asText(defaultValue);
    }

    public static int asInt(JsonNode node) {
        return node.asInt();
    }

    public static int asInt(JsonNode node, int defaultValue) {
        return node.asInt(defaultValue);
    }

    public static long asLong(JsonNode node) {
        return node.asLong();
    }

    public static long asLong(JsonNode node, long defaultValue) {
        return node.asLong(defaultValue);
    }

    public static double asDouble(JsonNode node) {
        return node.asDouble();
    }

    public static double asDouble(JsonNode node, double defaultValue) {
        return node.asDouble(defaultValue);
    }

    public static boolean asBoolean(JsonNode node) {
        return node.asBoolean();
    }

    public static boolean asBoolean(JsonNode node, boolean defaultValue) {
        return node.asBoolean(defaultValue);
    }

    public static int intValue(JsonNode node) {
        return node.intValue();
    }

    public static long longValue(JsonNode node) {
        return node.longValue();
    }

    public static BigDecimal decimalValue(JsonNode node) {
        return node.decimalValue();
    }

    public static BigInteger bigIntegerValue(JsonNode node) {
        return node.bigIntegerValue();
    }

    public static boolean canConvertToInt(JsonNode node) {
        return node.canConvertToInt();
    }
}
