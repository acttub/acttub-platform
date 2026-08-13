package com.acttub.actingapi.web;

import java.lang.annotation.Annotation;
import java.lang.reflect.RecordComponent;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.introspect.BeanPropertyDefinition;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import org.springframework.stereotype.Component;

/** DTO record 선언을 정본으로 삼아 Jackson 바인딩 전에 누적 가능한 검증을 수행한다. */
@Component
final class RequestBodyTreeValidator {
    private final ObjectMapper mapper;
    private final ApiErrorAdvice errors;

    RequestBodyTreeValidator(ObjectMapper mapper, ApiErrorAdvice errors) {
        this.mapper = mapper;
        this.errors = errors;
    }

    List<Map<String, Object>> validate(Class<?> bodyType, JsonNode body) {
        if (!bodyType.isRecord() || !body.isObject()) {
            return List.of();
        }

        List<Map<String, Object>> errors = new ArrayList<>();
        Set<String> knownFields = new HashSet<>();
        Object wholeBody = input(body);
        for (RecordComponent component : bodyType.getRecordComponents()) {
            String field = wireName(bodyType, component);
            knownFields.add(field);
            List<Object> location = List.of("body", field);
            boolean present = body.has(field);
            NotNull required = annotation(component, NotNull.class);
            if (!present) {
                if (required != null) {
                    errors.add(ApiErrorAdvice.validationError(
                            "missing", location, "Field required", wholeBody));
                }
                continue;
            }

            JsonNode value = body.get(field);
            Schema schema = annotation(component, Schema.class);
            if (value.isNull()) {
                if (schema == null || !schema.nullable()) {
                    errors.add(this.errors.nullTypeError(component.getType(), location));
                }
                continue;
            }

            if (component.getType() == String.class) {
                if (!value.isTextual()) {
                    errors.add(ApiErrorAdvice.validationError(
                            "string_type",
                            location,
                            "Input should be a valid string",
                            input(value)));
                    continue;
                }
                validateString(schema, location, value.textValue(), errors);
            } else if (isScalar(component.getType())) {
                validateScalar(component, value, location, errors);
            }
        }
        if (!ignoresUnknown(bodyType)) {
            body.fields().forEachRemaining(entry -> {
                if (!knownFields.contains(entry.getKey())) {
                    errors.add(ApiErrorAdvice.validationError(
                            "extra_forbidden",
                            List.of("body", entry.getKey()),
                            "Extra inputs are not permitted",
                            input(entry.getValue())));
                }
            });
        }
        return List.copyOf(errors);
    }

    private void validateScalar(
            RecordComponent component,
            JsonNode value,
            List<Object> location,
            List<Map<String, Object>> errors) {
        try (JsonParser parser = value.traverse(mapper)) {
            mapper.readValue(parser, mapper.constructType(component.getGenericType()));
        } catch (JsonMappingException exception) {
            errors.add(this.errors.jacksonError(exception, location, input(value)));
        } catch (java.io.IOException exception) {
            // JsonNode 자체를 읽는 경로라 구문 오류는 없다. 형식 오류는 위 mapping 분기다.
            throw new IllegalStateException("cached JsonNode could not be validated", exception);
        }
    }

    private void validateString(
            Schema schema,
            List<Object> location,
            String value,
            List<Map<String, Object>> errors) {
        if (schema == null) {
            return;
        }
        int length = value.codePointCount(0, value.length());
        if (schema.minLength() > 0 && length < schema.minLength()) {
            int minimum = schema.minLength();
            Map<String, Object> error = ApiErrorAdvice.validationError(
                    "string_too_short",
                    location,
                    "String should have at least " + minimum
                            + (minimum == 1 ? " character" : " characters"),
                    value);
            error.put("ctx", Map.of("min_length", minimum));
            errors.add(error);
        } else if (schema.maxLength() < Integer.MAX_VALUE && length > schema.maxLength()) {
            int maximum = schema.maxLength();
            Map<String, Object> error = ApiErrorAdvice.validationError(
                    "string_too_long",
                    location,
                    "String should have at most " + maximum
                            + (maximum == 1 ? " character" : " characters"),
                    value);
            error.put("ctx", Map.of("max_length", maximum));
            errors.add(error);
        }
    }

    private String wireName(Class<?> bodyType, RecordComponent component) {
        JavaType javaType = mapper.constructType(bodyType);
        return mapper.getDeserializationConfig().introspect(javaType).findProperties().stream()
                .filter(property -> property.getInternalName().equals(component.getName()))
                .map(BeanPropertyDefinition::getName)
                .findFirst()
                .orElse(component.getName());
    }

    private Object input(JsonNode node) {
        return node.isNull() ? null : mapper.convertValue(node, Object.class);
    }

    private static boolean isScalar(Class<?> type) {
        return type.isPrimitive()
                || type == Boolean.class
                || Number.class.isAssignableFrom(type)
                || type == UUID.class
                || type.isEnum();
    }

    private static boolean ignoresUnknown(Class<?> bodyType) {
        JsonIgnoreProperties annotation = bodyType.getAnnotation(JsonIgnoreProperties.class);
        return annotation != null && annotation.ignoreUnknown();
    }

    private static <A extends Annotation> A annotation(
            RecordComponent component,
            Class<A> annotationType) {
        A annotation = component.getAnnotation(annotationType);
        if (annotation == null) {
            annotation = component.getAnnotatedType().getAnnotation(annotationType);
        }
        if (annotation == null) {
            annotation = component.getAccessor().getAnnotation(annotationType);
        }
        if (annotation == null) {
            try {
                annotation = component.getDeclaringRecord()
                        .getDeclaredField(component.getName())
                        .getAnnotation(annotationType);
            } catch (NoSuchFieldException ignored) {
                // RecordComponent 에 대응하는 필드는 JVM 이 항상 만들지만 안전하게 폴백한다.
            }
        }
        return annotation;
    }
}
