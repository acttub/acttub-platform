package com.acttub.actingapi.platform.json;

import java.math.BigDecimal;
import java.math.BigInteger;

import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.io.NumberInput;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.POJONode;

/**
 * JSON 트리에서 값을 느슨하게 읽는 규칙. 형이 안 맞으면 예외 대신 기본값을 주고, 문자열 숫자·소수·불리언을
 * 잘라서라도 바꾼다(예: {@code "1.5"} → 1, {@code " 12 "} → 12, JSON null 의 글자 → {@code "null"}).
 *
 * <p>이 코드는 처음부터 Jackson 2 의 {@code JsonNode.asText()}·{@code asInt()} 같은 메서드의 이 규칙 위에서
 * 짜였다. Jackson 3 의 같은 이름 메서드는 형이 안 맞으면 예외를 던지고 잘라 바꾸지 않는다. 저장된 JSON·모델
 * 출력·요청 본문을 읽는 결과가 바뀌지 않게, 같은 결과를 내는 Jackson 3 메서드가 없는 읽기는 여기를 거친다.
 * 규칙은 Jackson 2.21 의 노드 클래스를 그대로 옮겼고 {@code LenientJsonTest} 의 값 표가 고정한다.
 */
public final class LenientJson {

    private LenientJson() {
    }

    /** 문자열은 그대로, 숫자·불리언은 글자로, JSON null 은 {@code "null"}, 객체·배열·없는 값은 빈 문자열. */
    public static String asText(JsonNode node) {
        if (node.isNull()) {
            return "null";
        }
        if (node.isPojo()) {
            Object value = ((POJONode) node).getPojo();
            return value == null ? "null" : value.toString();
        }
        return node.isContainer() ? "" : node.asString("");
    }

    /** {@link #asText(JsonNode)} 와 같되 JSON null·없는 값은 기본값. 객체·배열은 빈 문자열이다. */
    public static String asText(JsonNode node, String defaultValue) {
        if (node.isPojo()) {
            Object value = ((POJONode) node).getPojo();
            return value == null ? defaultValue : value.toString();
        }
        return node.isContainer() ? "" : node.asString(defaultValue);
    }

    public static int asInt(JsonNode node) {
        return asInt(node, 0);
    }

    /** 숫자는 int 로 잘라 바꾸고(넘치면 감긴다), 불리언은 1·0, 문자열은 다듬어 숫자로 읽고, 나머지는 기본값. */
    public static int asInt(JsonNode node, int defaultValue) {
        if (node.isNumber()) {
            return node.numberValue().intValue();
        }
        if (node.isBoolean()) {
            return node.booleanValue() ? 1 : 0;
        }
        if (node.isString()) {
            return NumberInput.parseAsInt(node.stringValue(), defaultValue);
        }
        return pojoNumber(node) instanceof Number number ? number.intValue() : defaultValue;
    }

    public static long asLong(JsonNode node) {
        return asLong(node, 0L);
    }

    public static long asLong(JsonNode node, long defaultValue) {
        if (node.isNumber()) {
            return node.numberValue().longValue();
        }
        if (node.isBoolean()) {
            return node.booleanValue() ? 1L : 0L;
        }
        if (node.isString()) {
            return NumberInput.parseAsLong(node.stringValue(), defaultValue);
        }
        return pojoNumber(node) instanceof Number number ? number.longValue() : defaultValue;
    }

    public static double asDouble(JsonNode node) {
        return asDouble(node, 0.0);
    }

    public static double asDouble(JsonNode node, double defaultValue) {
        if (node.isNumber()) {
            return node.numberValue().doubleValue();
        }
        if (node.isBoolean()) {
            return node.booleanValue() ? 1.0 : 0.0;
        }
        if (node.isString()) {
            return NumberInput.parseAsDouble(node.stringValue(), defaultValue);
        }
        return pojoNumber(node) instanceof Number number ? number.doubleValue() : defaultValue;
    }

    public static boolean asBoolean(JsonNode node) {
        return asBoolean(node, false);
    }

    /** 불리언은 그대로, 정수는 0 이 아니면 참, 문자열은 다듬어 "true"·"false" 만 읽고, 실수·나머지는 기본값. */
    public static boolean asBoolean(JsonNode node, boolean defaultValue) {
        if (node.isBoolean()) {
            return node.booleanValue();
        }
        if (node.isString()) {
            String value = node.stringValue().trim();
            return "true".equals(value) || !"false".equals(value) && defaultValue;
        }
        if (node.isPojo()) {
            return ((POJONode) node).getPojo() instanceof Boolean value ? value : defaultValue;
        }
        if (!node.isNumber()) {
            return defaultValue;
        }
        return switch (node.numberValue()) {
            case Integer integer -> integer != 0;
            case Long integer -> integer != 0;
            case Short integer -> integer != 0;
            case BigInteger integer -> !BigInteger.ZERO.equals(integer);
            default -> defaultValue;
        };
    }

    /** 숫자만 int 로 잘라 바꾸고(넘치면 감긴다) 나머지는 0. */
    public static int intValue(JsonNode node) {
        return node.isNumber() ? node.numberValue().intValue() : 0;
    }

    public static long longValue(JsonNode node) {
        return node.isNumber() ? node.numberValue().longValue() : 0L;
    }

    /** 숫자가 아니면 0. 무한대·NaN 인 실수는 {@link NumberFormatException}. */
    public static BigDecimal decimalValue(JsonNode node) {
        if (!node.isNumber()) {
            return BigDecimal.ZERO;
        }
        return switch (node.numberValue()) {
            case BigDecimal decimal -> decimal;
            case BigInteger integer -> new BigDecimal(integer);
            case Double real -> BigDecimal.valueOf(real);
            case Float real -> BigDecimal.valueOf(real);
            case Number integral -> BigDecimal.valueOf(integral.longValue());
        };
    }

    public static BigInteger bigIntegerValue(JsonNode node) {
        if (!node.isNumber()) {
            return BigInteger.ZERO;
        }
        return switch (node.numberValue()) {
            case BigInteger integer -> integer;
            case BigDecimal decimal -> {
                StreamReadConstraints.defaults().validateBigIntegerScale(decimal.scale());
                yield decimal.toBigInteger();
            }
            case Double real -> BigDecimal.valueOf(real).toBigInteger();
            case Float real -> BigDecimal.valueOf(real).toBigInteger();
            case Number integral -> BigInteger.valueOf(integral.longValue());
        };
    }

    /** int 범위 안의 숫자면 참. 소수는 범위만 본다(잘라 바꿀 수 있으면 참). */
    public static boolean canConvertToInt(JsonNode node) {
        if (!node.isNumber()) {
            return false;
        }
        return switch (node.numberValue()) {
            case Integer integer -> true;
            case Short integer -> true;
            case Long integer -> integer >= Integer.MIN_VALUE && integer <= Integer.MAX_VALUE;
            case Double real -> real >= Integer.MIN_VALUE && real <= Integer.MAX_VALUE;
            case Float real -> real >= Integer.MIN_VALUE && real <= Integer.MAX_VALUE;
            case BigInteger integer -> integer.compareTo(BigInteger.valueOf(Integer.MIN_VALUE)) >= 0
                    && integer.compareTo(BigInteger.valueOf(Integer.MAX_VALUE)) <= 0;
            case BigDecimal decimal -> decimal.compareTo(BigDecimal.valueOf(Integer.MIN_VALUE)) >= 0
                    && decimal.compareTo(BigDecimal.valueOf(Integer.MAX_VALUE)) <= 0;
            default -> false;
        };
    }

    private static Object pojoNumber(JsonNode node) {
        return node.isPojo() ? ((POJONode) node).getPojo() : null;
    }
}
