package com.acttub.actingapi.config;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import io.swagger.v3.core.converter.ModelConverter;
import io.swagger.v3.core.jackson.ModelResolver;
import io.swagger.v3.oas.models.media.ComposedSchema;
import io.swagger.v3.oas.models.media.Schema;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class PydanticOpenApiCustomizer {
    static {
        // Pydantic emits enum classes as titled components and uses pure $ref properties.
        // This applies the same rule to every enum Springdoc discovers, including later groups.
        ModelResolver.enumsAsRef = true;
    }

    @Bean
    ModelConverter pydanticPgEnumModelConverter() {
        return new PydanticPgEnumModelConverter();
    }

    @Bean
    OpenApiCustomizer pydanticSchemaShapeCustomizer() {
        return openApi -> {
            if (openApi.getComponents() == null || openApi.getComponents().getSchemas() == null) {
                return;
            }
            applyFastApiValidationErrorTitles(openApi.getComponents().getSchemas());
            openApi.getComponents().getSchemas().replaceAll(
                    (modelName, schema) -> normalize(schema, modelName));
        };
    }

    private static void applyFastApiValidationErrorTitles(Map<String, Schema> schemas) {
        // FastAPI가 자체 생성하는 ValidationError는 일반 field-name 규칙 대신
        // Location·Message·Error Type·Context라는 명시적 title을 사용한다.
        Schema<?> validationError = schemas.get("ValidationError");
        if (validationError == null || validationError.getProperties() == null) {
            return;
        }
        setTitle(validationError, "loc", "Location");
        setTitle(validationError, "msg", "Message");
        setTitle(validationError, "type", "Error Type");
        setTitle(validationError, "input", "Input");
        setTitle(validationError, "ctx", "Context");
    }

    private static void setTitle(
            Schema<?> owner,
            String propertyName,
            String title) {
        Schema<?> property = (Schema<?>) owner.getProperties().get(propertyName);
        if (property != null && property.getTitle() == null) {
            property.setTitle(title);
        }
    }

    private static Schema<?> normalize(Schema<?> schema, String inferredTitle) {
        if (schema == null) {
            return null;
        }
        if (schema.getTitle() == null && inferredTitle != null && schema.get$ref() == null) {
            schema.setTitle(inferredTitle);
        }

        normalizeExclusiveBounds(schema);
        stripUnboundedMaxLength(schema);
        normalizeProperties(schema);
        if (schema.getItems() != null) {
            schema.setItems(normalize(schema.getItems(), null));
        }
        normalizeSchemas(schema.getAllOf());
        normalizeSchemas(schema.getOneOf());
        normalizeSchemas(schema.getAnyOf());

        if (!isNullable(schema) || hasNullAlternative(schema)) {
            return schema;
        }
        return nullableAnyOf(schema);
    }

    /**
     * 배타 경계를 OpenAPI 3.1 표기로 옮긴다.
     *
     * <p>3.0 은 {@code minimum} + {@code exclusiveMinimum: true} 로 썼지만 3.1 에서
     * {@code exclusiveMinimum} 은 <b>불리언이 아니라 경계값 자체</b>다. pydantic 은 3.1 로
     * 내보내므로 정본은 {@code {"type":"integer","exclusiveMinimum":0.0}} 이고,
     * {@code @Schema(minimum="0", exclusiveMinimum=true)} 를 그대로 두면
     * {@code {"minimum":0}} 이 나가 어긋난다. 이 자리에 오면 불리언 플래그는 이미 유실돼
     * 있으므로 <b>명시적으로 {@code false} 가 아닌 한</b> 배타로 본다.
     *
     * <p>근거: 현재 정본에 <b>포함</b> 하한·상한은 0건이고 배타만 2건이다(둘 다
     * {@code UploadIntentRequest}). 포함 경계를 쓰는 필드가 새로 생기면 이 가정이 깨지는데,
     * 그때는 정본과 컴포넌트를 대조하는 {@code HealthAndBootIT} 의 OpenAPI 테스트가 잡는다.
     */
    private static void normalizeExclusiveBounds(Schema<?> schema) {
        if (schema.getMinimum() != null && !Boolean.FALSE.equals(schema.getExclusiveMinimum())) {
            schema.setExclusiveMinimumValue(asFloatLiteral(schema.getMinimum()));
            schema.setMinimum(null);
            schema.setExclusiveMinimum(null);
        }
        if (schema.getMaximum() != null && !Boolean.FALSE.equals(schema.getExclusiveMaximum())) {
            schema.setExclusiveMaximumValue(asFloatLiteral(schema.getMaximum()));
            schema.setMaximum(null);
            schema.setExclusiveMaximum(null);
        }
    }

    /**
     * 정수여도 소수점을 남긴다 — pydantic 은 수치 제약을 float 로 내보내
     * 정본이 {@code 0.0} 인데, {@code BigDecimal("0")} 은 {@code 0} 으로 직렬화된다.
     * 하네스의 openapi diff 는 값뿐 아니라 <b>타입까지</b> 비교하므로 그 차이가 그대로 잡힌다.
     */
    private static java.math.BigDecimal asFloatLiteral(java.math.BigDecimal value) {
        return value.scale() > 0 ? value : value.setScale(1);
    }

    /**
     * 상한이 없다는 뜻의 {@code maxLength} 를 지운다.
     *
     * <p>{@code @Size(min = 1)} 은 max 기본값이 {@link Integer#MAX_VALUE} 라 springdoc 이
     * {@code "maxLength": 2147483647} 을 문서에 싣는다. pydantic 의 {@code min_length=1} 은
     * 하한만 내보내므로 정본에는 그 키가 아예 없다. 실제 상한이 있는 필드는 값이 다르므로
     * 영향을 받지 않는다.
     */
    private static void stripUnboundedMaxLength(Schema<?> schema) {
        if (Integer.valueOf(Integer.MAX_VALUE).equals(schema.getMaxLength())) {
            schema.setMaxLength(null);
        }
    }

    @SuppressWarnings("unchecked")
    private static void normalizeProperties(Schema<?> schema) {
        Map<String, Schema> properties = schema.getProperties();
        if (properties == null) {
            return;
        }
        properties.replaceAll((wireName, property) ->
                (Schema) normalize(property, propertyTitle(wireName)));
    }

    private static void normalizeSchemas(List<Schema> schemas) {
        if (schemas == null) {
            return;
        }
        schemas.replaceAll(schema -> (Schema) normalize(schema, null));
    }

    private static boolean isNullable(Schema<?> schema) {
        return Boolean.TRUE.equals(schema.getNullable())
                || schema.getTypes() != null && schema.getTypes().contains("null");
    }

    private static boolean hasNullAlternative(Schema<?> schema) {
        if (schema.getAnyOf() == null) {
            return false;
        }
        return schema.getAnyOf().stream().anyMatch(PydanticOpenApiCustomizer::isNullSchema);
    }

    private static boolean isNullSchema(Schema schema) {
        return "null".equals(schema.getType())
                || schema.getTypes() != null
                && schema.getTypes().size() == 1
                && schema.getTypes().contains("null");
    }

    private static Schema<?> nullableAnyOf(Schema<?> schema) {
        String title = schema.getTitle();
        schema.setTitle(null);
        schema.setNullable(null);
        if (schema.getTypes() != null && schema.getTypes().contains("null")) {
            Set<String> nonNullTypes = new LinkedHashSet<>(schema.getTypes());
            nonNullTypes.remove("null");
            schema.setTypes(nonNullTypes);
            if (nonNullTypes.size() == 1) {
                schema.setType(nonNullTypes.iterator().next());
            }
        }

        ComposedSchema nullable = new ComposedSchema();
        nullable.setTitle(title);
        nullable.setAnyOf(new ArrayList<>(List.of(schema, nullSchema())));
        return nullable;
    }

    /**
     * {@code {"type": "null"}} 하나.
     *
     * <p>{@code new Schema<>().type("null")} 로 만들면 <b>빈 객체 {@code {}} 로 직렬화된다</b> —
     * OpenAPI 3.1 직렬화는 단일 {@code type} 이 아니라 {@code types} 집합을 읽기 때문이다.
     * 그러면 문서상 {@code anyOf: [{...}, {}]} 가 되어 nullable 표기가 정본과 어긋난다.
     */
    private static Schema<?> nullSchema() {
        Schema<?> schema = new Schema<>();
        schema.setTypes(new LinkedHashSet<>(List.of("null")));
        return schema;
    }

    private static String propertyTitle(String wireName) {
        String[] words = wireName.split("_");
        List<String> titled = new ArrayList<>(words.length);
        for (String word : words) {
            if (word.isEmpty()) {
                continue;
            }
            String lower = word.toLowerCase(Locale.ROOT);
            titled.add(Character.toUpperCase(lower.charAt(0)) + lower.substring(1));
        }
        return String.join(" ", titled);
    }
}
