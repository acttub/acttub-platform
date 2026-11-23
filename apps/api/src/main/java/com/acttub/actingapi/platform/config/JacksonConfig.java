package com.acttub.actingapi.platform.config;

import java.math.BigInteger;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

import tools.jackson.core.JsonGenerator;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.ValueSerializer;
import tools.jackson.databind.cfg.CoercionAction;
import tools.jackson.databind.cfg.CoercionInputShape;
import tools.jackson.databind.cfg.DateTimeFeature;
import tools.jackson.databind.module.SimpleModule;
import tools.jackson.databind.type.LogicalType;
import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 직렬화 계약을 못 박는다 (apps/api/CONTRACT.md §4, §6).
 *
 * <ul>
 *   <li>datetime 은 전 엔드포인트 {@code ...Z} + 마이크로초 <b>6자리 고정</b>.
 *       Jackson 기본은 후행 0을 잘라내 자릿수가 들쭉날쭉해지므로 직접 직렬화한다.</li>
 *   <li>{@code @JsonInclude(NON_NULL)} 을 전역으로 켜지 않는다 — null 필드를 키째 실어보내야 한다.
 *       (Spring Boot 기본이 ALWAYS 라 "켜지 않는다"가 곧 구현이다. 회귀 테스트로 고정한다.)</li>
 *   <li>{@code FAIL_ON_UNKNOWN_PROPERTIES} 는 전역 true, 허용 DTO 만
 *       {@code @JsonIgnoreProperties(ignoreUnknown = true)} 로 연다 (apps/api/CONTRACT.md §6-3).
 *       Jackson 은 반대 방향을 표현하지 못한다 — {@code ignoreUnknown=false} 는
 *       "전역을 따르라"는 뜻이라 DTO 별 거부를 강제할 수 없다.</li>
 * </ul>
 *
 * <p>{@code LocalDateTime} 은 쓰지 않는다 — 오프셋이 없어 Z 를 붙일 근거가 사라진다.
 */
@Configuration(proxyBeanMethods = false)
public class JacksonConfig {

    /** {@code 2026-08-06T01:02:03.456789Z} — 소수 6자리 고정, 항상 UTC. */
    public static final DateTimeFormatter MICROS_UTC =
            DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSSSSS'Z'").withZone(ZoneOffset.UTC);

    @Bean
    JsonMapperBuilderCustomizer acttubJacksonCustomizer() {
        SimpleModule module = new SimpleModule("acttub-contract");
        module.addSerializer(Instant.class, new ValueSerializer<>() {
            @Override
            public void serialize(Instant value, JsonGenerator gen, SerializationContext serializers) {
                gen.writeString(MICROS_UTC.format(value));
            }
        });
        module.addSerializer(OffsetDateTime.class, new ValueSerializer<>() {
            @Override
            public void serialize(OffsetDateTime value, JsonGenerator gen, SerializationContext serializers) {
                gen.writeString(MICROS_UTC.format(value.toInstant()));
            }
        });
        module.addDeserializer(Byte.class, ExactIntegerDeserializer.bytes());
        module.addDeserializer(Byte.TYPE, ExactIntegerDeserializer.bytes());
        module.addDeserializer(Short.class, ExactIntegerDeserializer.shorts());
        module.addDeserializer(Short.TYPE, ExactIntegerDeserializer.shorts());
        module.addDeserializer(Integer.class, ExactIntegerDeserializer.integers());
        module.addDeserializer(Integer.TYPE, ExactIntegerDeserializer.integers());
        module.addDeserializer(Long.class, ExactIntegerDeserializer.longs());
        module.addDeserializer(Long.TYPE, ExactIntegerDeserializer.longs());
        module.addDeserializer(BigInteger.class, ExactIntegerDeserializer.bigIntegers());

        return builder -> {
            builder.addModule(module);
            builder.disable(DateTimeFeature.WRITE_DATES_AS_TIMESTAMPS);
            builder.disable(MapperFeature.ALLOW_COERCION_OF_SCALARS);
            builder.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
            builder.withCoercionConfig(LogicalType.Textual, textual -> {
                textual.setCoercion(CoercionInputShape.Integer, CoercionAction.Fail);
                textual.setCoercion(CoercionInputShape.Float, CoercionAction.Fail);
                textual.setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail);
            });
        };
    }
}
