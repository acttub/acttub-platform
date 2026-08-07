package com.acttub.actingapi.config;

import java.io.IOException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fasterxml.jackson.databind.cfg.CoercionAction;
import com.fasterxml.jackson.databind.cfg.CoercionInputShape;
import com.fasterxml.jackson.databind.module.SimpleModule;
import com.fasterxml.jackson.databind.type.LogicalType;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 직렬화 계약을 못 박는다 (/SPEC.md §4, §6).
 *
 * <ul>
 *   <li>datetime 은 전 엔드포인트 {@code ...Z} + 마이크로초 <b>6자리 고정</b>.
 *       Jackson 기본은 후행 0을 잘라내 자릿수가 들쭉날쭉해지므로 직접 직렬화한다.</li>
 *   <li>{@code @JsonInclude(NON_NULL)} 을 전역으로 켜지 않는다 — null 필드를 키째 실어보내야 한다.
 *       (Spring Boot 기본이 ALWAYS 라 "켜지 않는다"가 곧 구현이다. 회귀 테스트로 고정한다.)</li>
 *   <li>{@code FAIL_ON_UNKNOWN_PROPERTIES} 는 전역 true, 허용 DTO 만
 *       {@code @JsonIgnoreProperties(ignoreUnknown = true)} 로 연다 (/SPEC.md §6-3).
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
    Jackson2ObjectMapperBuilderCustomizer acttubJacksonCustomizer() {
        SimpleModule module = new SimpleModule("acttub-datetime");
        module.addSerializer(Instant.class, new JsonSerializer<>() {
            @Override
            public void serialize(Instant value, JsonGenerator gen, SerializerProvider serializers)
                    throws IOException {
                gen.writeString(MICROS_UTC.format(value));
            }
        });
        module.addSerializer(OffsetDateTime.class, new JsonSerializer<>() {
            @Override
            public void serialize(OffsetDateTime value, JsonGenerator gen, SerializerProvider serializers)
                    throws IOException {
                gen.writeString(MICROS_UTC.format(value.toInstant()));
            }
        });

        return builder -> {
            builder.modules(module);
            builder.featuresToDisable(
                    com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS,
                    com.fasterxml.jackson.databind.MapperFeature.ALLOW_COERCION_OF_SCALARS);
            builder.featuresToEnable(
                    com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
            builder.postConfigurer(objectMapper -> {
                var textual = objectMapper.coercionConfigFor(LogicalType.Textual);
                textual.setCoercion(CoercionInputShape.Integer, CoercionAction.Fail);
                textual.setCoercion(CoercionInputShape.Float, CoercionAction.Fail);
                textual.setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail);
            });
        };
    }
}
