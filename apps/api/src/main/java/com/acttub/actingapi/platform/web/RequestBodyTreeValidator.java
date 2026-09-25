package com.acttub.actingapi.platform.web;

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
        Set<String> credentials = credentialFields(bodyType);
        Object wholeBody = credentials.isEmpty() ? input(body) : withoutCredentials(bodyType, body, credentials);
        for (RecordComponent component : bodyType.getRecordComponents()) {
            String field = wireName(bodyType, component);
            knownFields.add(field);
            List<Object> location = List.of("body", field);
            if (credentials.contains(field)) {
                // 자격 칸의 오류는 같은 모양으로 내되 값은 싣지 않는다 (CredentialField).
                // 빠진 칸의 input 은 이미 자격 값을 뺀 본문이라 그대로 둔다.
                List<Map<String, Object>> own = new ArrayList<>();
                validateComponent(component, body, location, wholeBody, own);
                own.stream()
                        .filter(error -> !"missing".equals(error.get("type")))
                        .forEach(error -> error.computeIfPresent("input", (key, echoed) -> CredentialField.REDACTED));
                errors.addAll(own);
                continue;
            }
            validateComponent(component, body, location, wholeBody, errors);
        }
        if (!ignoresUnknown(bodyType)) {
            body.fields().forEachRemaining(entry -> {
                if (!knownFields.contains(entry.getKey())) {
                    errors.add(ApiErrorAdvice.validationError(
                            "extra_forbidden",
                            List.of("body", entry.getKey()),
                            "Extra inputs are not permitted",
                            credentials.isEmpty() ? input(entry.getValue()) : CredentialField.REDACTED));
                }
            });
        }
        return List.copyOf(errors);
    }

    private void validateComponent(
            RecordComponent component,
            JsonNode body,
            List<Object> location,
            Object wholeBody,
            List<Map<String, Object>> errors) {
        String field = (String) location.get(1);
        NotNull required = annotation(component, NotNull.class);
        if (!body.has(field)) {
            if (required != null) {
                errors.add(ApiErrorAdvice.validationError(
                        "missing", location, "Field required", wholeBody));
            }
            return;
        }

        JsonNode value = body.get(field);
        Schema schema = annotation(component, Schema.class);
        if (value.isNull()) {
            if (schema == null || !schema.nullable()) {
                errors.add(this.errors.nullTypeError(component.getType(), location));
            }
            return;
        }

        if (component.getType() == String.class) {
            if (!value.isTextual()) {
                errors.add(ApiErrorAdvice.validationError(
                        "string_type",
                        location,
                        "Input should be a valid string",
                        input(value)));
                return;
            }
            validateString(schema, location, value.textValue(), errors);
        } else if (isScalar(component.getType())) {
            validateScalar(component, value, location, errors);
        }
    }

    /** 이 요청 본문에서 자격 값이 실리는 칸의 이름(요청에 적히는 이름). 없으면 빈 집합. */
    private Set<String> credentialFields(Class<?> bodyType) {
        Set<String> fields = new HashSet<>();
        for (RecordComponent component : bodyType.getRecordComponents()) {
            if (annotation(component, CredentialField.class) != null) {
                fields.add(wireName(bodyType, component));
            }
        }
        return fields;
    }

    /**
     * 본문 전체를 싣는 자리에 대신 싣는 것 — 선언된 칸 가운데 자격 값이 아닌 것만. 모르는 키도 뺀다:
     * 이름을 잘못 쓴 키({@code idToken})에 토큰이 실려 온다.
     */
    private Object withoutCredentials(Class<?> bodyType, JsonNode body, Set<String> credentials) {
        Map<String, Object> kept = new java.util.LinkedHashMap<>();
        for (RecordComponent component : bodyType.getRecordComponents()) {
            String field = wireName(bodyType, component);
            if (!credentials.contains(field) && body.has(field)) {
                kept.put(field, input(body.get(field)));
            }
        }
        return kept;
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
