package com.acttub.actingapi.config;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.function.Function;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.exc.InvalidFormatException;
import com.fasterxml.jackson.databind.deser.std.StdDeserializer;

/**
 * Pydantic의 정수 입력 규칙처럼 소수부가 정확히 0인 JSON float만 정수로 허용한다.
 * Jackson의 {@code ACCEPT_FLOAT_AS_INT} 기본값은 12.5까지 12로 잘라 버리므로 쓸 수 없다.
 */
final class ExactIntegerDeserializer<T extends Number> extends StdDeserializer<T> {
    private final BigInteger minimum;
    private final BigInteger maximum;
    private final Function<BigInteger, T> converter;

    ExactIntegerDeserializer(
            Class<T> type,
            BigInteger minimum,
            BigInteger maximum,
            Function<BigInteger, T> converter) {
        super(type);
        this.minimum = minimum;
        this.maximum = maximum;
        this.converter = converter;
    }

    @Override
    public T deserialize(JsonParser parser, DeserializationContext context) throws IOException {
        Object input;
        BigDecimal decimal;
        JsonToken token = parser.currentToken();
        try {
            if (token == JsonToken.VALUE_NUMBER_INT || token == JsonToken.VALUE_NUMBER_FLOAT) {
                decimal = parser.getDecimalValue();
                input = parser.getNumberValue();
            } else if (token == JsonToken.VALUE_STRING) {
                input = parser.getText();
                decimal = new BigDecimal(parser.getText().strip());
            } else {
                input = parser.readValueAs(Object.class);
                throw invalid(parser, input);
            }

            BigInteger integer = decimal.toBigIntegerExact();
            if ((minimum != null && integer.compareTo(minimum) < 0)
                    || (maximum != null && integer.compareTo(maximum) > 0)) {
                throw invalid(parser, input);
            }
            return converter.apply(integer);
        } catch (ArithmeticException | NumberFormatException exception) {
            input = token == JsonToken.VALUE_STRING ? parser.getText() : parser.getNumberValue();
            throw invalid(parser, input);
        }
    }

    private InvalidFormatException invalid(JsonParser parser, Object input) {
        return InvalidFormatException.from(
                parser,
                "Input cannot be represented as an exact " + handledType().getSimpleName(),
                input,
                handledType());
    }

    static ExactIntegerDeserializer<Byte> bytes() {
        return new ExactIntegerDeserializer<>(
                Byte.class,
                BigInteger.valueOf(Byte.MIN_VALUE),
                BigInteger.valueOf(Byte.MAX_VALUE),
                BigInteger::byteValueExact);
    }

    static ExactIntegerDeserializer<Short> shorts() {
        return new ExactIntegerDeserializer<>(
                Short.class,
                BigInteger.valueOf(Short.MIN_VALUE),
                BigInteger.valueOf(Short.MAX_VALUE),
                BigInteger::shortValueExact);
    }

    static ExactIntegerDeserializer<Integer> integers() {
        return new ExactIntegerDeserializer<>(
                Integer.class,
                BigInteger.valueOf(Integer.MIN_VALUE),
                BigInteger.valueOf(Integer.MAX_VALUE),
                BigInteger::intValueExact);
    }

    static ExactIntegerDeserializer<Long> longs() {
        return new ExactIntegerDeserializer<>(
                Long.class,
                BigInteger.valueOf(Long.MIN_VALUE),
                BigInteger.valueOf(Long.MAX_VALUE),
                BigInteger::longValueExact);
    }

    static ExactIntegerDeserializer<BigInteger> bigIntegers() {
        return new ExactIntegerDeserializer<>(BigInteger.class, null, null, Function.identity());
    }
}
