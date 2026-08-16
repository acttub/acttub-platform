package com.acttub.actingapi.platform.config;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import com.acttub.actingapi.coach.adapter.web.CoachDtos.CoachConfirmResponse;
import com.acttub.actingapi.coach.adapter.web.CoachDtos.CoachTurnResponse;
import com.acttub.actingapi.report.app.PublicReport.BlockedReport;
import com.acttub.actingapi.report.adapter.web.ReportDtos.ReportDetailResponse;
import io.swagger.v3.core.converter.ModelConverter;
import io.swagger.v3.core.converter.ModelConverters;
import io.swagger.v3.core.jackson.ModelResolver;
import io.swagger.v3.oas.models.media.ComposedSchema;
import io.swagger.v3.oas.models.media.IntegerSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
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

    /**
     * {@code coach}·{@code report}의 DTO를 여기서 직접 참조하는 것은 <b>정리가 덜 된 게 아니라
     * 순서 제약 때문이다.</b> 아래 {@code registerReferencedSchemas} 호출들은 반드시
     * {@code schemas.replaceAll(normalize)} <b>앞에</b> 실행돼야 하는데, 기능 패키지별
     * {@code OpenApiCustomizer}로 쪼개면 springdoc이 커스터마이저 간 실행 순서를 보장하지 않는다.
     *
     * <p>이 참조는 순환이 아니므로 {@code PackageCycleTest}가 잡지 않는다. 단일 모듈을 유지하기로
     * 했으므로(ADR-016) 상향 의존의 실질 해도 없다. 옮기려면 순서를 먼저 명시적 계약으로 만들어라.
     */
    @Bean
    OpenApiCustomizer pydanticSchemaShapeCustomizer() {
        return openApi -> {
            normalizeResponseContentTypes(openApi);
            normalizeParameterSchemas(openApi);
            if (openApi.getComponents() == null || openApi.getComponents().getSchemas() == null) {
                return;
            }
            Map<String, Schema> schemas = openApi.getComponents().getSchemas();
            registerReferencedSchemas(schemas, ReportDetailResponse.class);
            registerReferencedSchemas(schemas, CoachTurnResponse.class);
            registerReferencedSchemas(schemas, CoachConfirmResponse.class);
            registerReferencedSchemas(schemas, BlockedReport.class);
            applyFastApiValidationErrorShape(schemas);
            schemas.replaceAll(
                    (modelName, schema) -> normalize(schema, modelName));
            applyAdmissionsSchemaShape(schemas);
            applyReportSchemaShape(schemas);
            applyCoachSchemaShape(schemas);
        };
    }

    /**
     * springdoc does not merge {@code referencedSchemas} discovered below a Jackson
     * {@code JsonNode} property into {@code components.schemas}. Resolve the annotated root
     * through Swagger's normal converter and merge every missing referenced model before the
     * shared pydantic normalization runs.
     */
    private static void registerReferencedSchemas(
            Map<String, Schema> schemas,
            Class<?> rootModel) {
        ModelConverters.getInstance(true).readAll(rootModel)
                .forEach(schemas::putIfAbsent);
    }

    private static void normalizeParameterSchemas(io.swagger.v3.oas.models.OpenAPI openApi) {
        if (openApi.getPaths() == null) {
            return;
        }
        openApi.getPaths().values().stream()
                .flatMap(path -> path.readOperations().stream())
                .filter(operation -> operation.getParameters() != null)
                .flatMap(operation -> operation.getParameters().stream())
                .filter(parameter -> parameter.getSchema() != null)
                .forEach(parameter -> parameter.setSchema(
                        normalizeParameter(parameter.getSchema(), parameterTitle(parameter))));
    }

    private static Schema<?> normalizeParameter(Schema<?> schema, String inferredTitle) {
        if (schema.getTitle() == null && inferredTitle != null && schema.get$ref() == null) {
            schema.setTitle(inferredTitle);
        }
        stripPydanticIntegerFormat(schema);
        stripUnboundedMaxLength(schema);
        if (schema.getItems() != null) {
            schema.setItems(normalizeParameter(schema.getItems(), null));
        }
        if (schema.getAnyOf() != null) {
            schema.getAnyOf().replaceAll(item -> (Schema) normalizeParameter(item, null));
        }
        if (!isNullable(schema) || hasNullAlternative(schema)) {
            return schema;
        }
        return nullableAnyOf(schema);
    }

    private static void normalizeResponseContentTypes(io.swagger.v3.oas.models.OpenAPI openApi) {
        if (openApi.getPaths() == null) {
            return;
        }
        openApi.getPaths().values().stream()
                .flatMap(path -> path.readOperations().stream())
                .filter(operation -> operation.getResponses() != null)
                .flatMap(operation -> operation.getResponses().values().stream())
                .filter(response -> response.getContent() != null)
                .forEach(response -> {
                    var wildcard = response.getContent().remove("*/*");
                    if (wildcard != null && !response.getContent().containsKey("application/json")) {
                        response.getContent().addMediaType("application/json", wildcard);
                    }
                    // 인라인 응답 스키마도 anyOf 옆의 type 을 떨어뜨린다. 컴포넌트 순회는
                    // 여기까지 오지 않아서, `POST /v2/reports` 처럼 세 리포트 형을 anyOf 로
                    // 직접 문서화한 자리에 반환 타입의 `type: string` 이 남아 있었다.
                    response.getContent().values().stream()
                            .map(io.swagger.v3.oas.models.media.MediaType::getSchema)
                            .filter(java.util.Objects::nonNull)
                            .forEach(PydanticOpenApiCustomizer::stripAnyOfBaseType);
                });
    }

    private static void applyFastApiValidationErrorShape(Map<String, Schema> schemas) {
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
        validationError.setRequired(List.of("loc", "msg", "type"));

        Schema<?> location = (Schema<?>) validationError.getProperties().get("loc");
        if (location != null) {
            ComposedSchema item = new ComposedSchema();
            item.setAnyOf(new ArrayList<>(List.of(new StringSchema(), new IntegerSchema())));
            location.setItems(item);
        }

        Schema<?> input = (Schema<?>) validationError.getProperties().get("input");
        if (input != null) {
            input.setType(null);
            input.setTypes(null);
            input.setFormat(null);
            input.setAdditionalProperties(null);
        }

        Schema<?> context = (Schema<?>) validationError.getProperties().get("ctx");
        if (context != null) {
            context.setType("object");
            context.setTypes(new LinkedHashSet<>(List.of("object")));
            context.setAdditionalProperties(null);
        }
    }

    /**
     * {@code default} 를 스키마 타입에 맞는 JSON 리터럴로 바꾼다.
     *
     * <p>{@code @Schema(defaultValue = ...)} 는 문자열만 받기 때문에 불리언 기본값이
     * {@code "false"} 로 나가는데, pydantic 은 {@code false} 를 낸다. 하네스 diff 는 값뿐
     * 아니라 <b>타입까지</b> 비교하므로 그대로 차이가 된다.
     *
     * <p>현재 정본의 default는 불리언, 문자열, 빈 배열만 사용한다. 어노테이션은 문자열만
     * 받으므로 JSON 리터럴이어야 하는 불리언과 배열만 여기서 타입을 바로잡는다.
     */
    private static void normalizeDefaultLiteral(Schema<?> schema) {
        if (!(schema.getDefault() instanceof String literal)) {
            return;
        }
        if (isTypedAs(schema, "boolean") && ("true".equals(literal) || "false".equals(literal))) {
            schema.setDefault(Boolean.valueOf(literal));
        } else if (isTypedAs(schema, "array") && "[]".equals(literal)) {
            schema.setDefault(new ArrayList<>());
        }
    }

    private static boolean isTypedAs(Schema<?> schema, String type) {
        return type.equals(schema.getType())
                || schema.getTypes() != null && schema.getTypes().contains(type);
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

        stripPydanticIntegerFormat(schema);
        stripPydanticNumberFormat(schema);
        normalizeExclusiveBounds(schema);
        stripUnboundedMaxLength(schema);
        normalizeDefaultLiteral(schema);
        normalizeProperties(schema);
        if (schema.getItems() != null) {
            schema.setItems(normalize(schema.getItems(), null));
        }
        normalizeSchemas(schema.getAllOf());
        normalizeSchemas(schema.getOneOf());
        normalizeSchemas(schema.getAnyOf());
        stripAnyOfBaseType(schema);

        if (!isNullable(schema) || hasNullAlternative(schema)) {
            return schema;
        }
        return nullableAnyOf(schema);
    }

    /** Pydantic does not emit a sibling {@code type} beside an {@code anyOf}. */
    private static void stripAnyOfBaseType(Schema<?> schema) {
        if (schema.getAnyOf() == null || schema.getAnyOf().isEmpty() || isNullable(schema)) {
            return;
        }
        schema.setType(null);
        schema.setTypes(null);
        schema.setFormat(null);
    }

    /** Pydantic의 무제한 {@code int}에는 Java {@code int32}/{@code int64} format이 없다. */
    private static void stripPydanticIntegerFormat(Schema<?> schema) {
        if ("integer".equals(schema.getType())
                || schema.getTypes() != null && schema.getTypes().contains("integer")) {
            schema.setFormat(null);
        }
    }

    /** Java {@code Double}의 {@code double} format은 pydantic의 무제한 number에 없다. */
    private static void stripPydanticNumberFormat(Schema<?> schema) {
        if ("number".equals(schema.getType())
                || schema.getTypes() != null && schema.getTypes().contains("number")) {
            schema.setFormat(null);
        }
    }

    private static void applyAdmissionsSchemaShape(Map<String, Schema> schemas) {
        setArrayDefaults(schemas, "AdmissionNotice", List.of(
                "designated_works", "essay_questions", "stages", "practical_items", "results"));
        setArrayDefaults(schemas, "AdmissionStage", List.of("evaluates"));
        setArrayDefaults(schemas, "AdmissionUniversity", List.of("resources", "tips"));

        Schema<?> notice = schemas.get("AdmissionNotice");
        Schema<?> weights = schemas.get("AdmissionWeights");
        if (notice == null || notice.getProperties() == null || weights == null) {
            return;
        }
        Schema<?> nonNullWeights = unwrapNullableComponent(weights);
        nonNullWeights.setTitle("AdmissionWeights");
        schemas.put("AdmissionWeights", nonNullWeights);

        ComposedSchema nullableWeights = new ComposedSchema();
        Schema<?> reference = new Schema<>();
        reference.set$ref("#/components/schemas/AdmissionWeights");
        nullableWeights.setAnyOf(new ArrayList<>(List.of(reference, nullSchema())));
        notice.getProperties().put("weights", nullableWeights);
    }

    private static Schema<?> unwrapNullableComponent(Schema<?> schema) {
        if (schema.getAnyOf() == null) {
            return schema;
        }
        return schema.getAnyOf().stream()
                .filter(candidate -> !isNullSchema(candidate))
                .findFirst()
                .orElse(schema);
    }

    private static void setArrayDefaults(
            Map<String, Schema> schemas,
            String component,
            List<String> properties) {
        Schema<?> owner = schemas.get(component);
        if (owner == null || owner.getProperties() == null) {
            return;
        }
        for (String property : properties) {
            Schema<?> value = (Schema<?>) owner.getProperties().get(property);
            if (value != null) {
                value.setDefault(new ArrayList<>());
            }
        }
    }

    private static void applyReportSchemaShape(Map<String, Schema> schemas) {
        setConst(schemas, "AnalysisReport", "report_type", "analysis");
        setConst(schemas, "ExpressionReport", "report_type", "expression");
        setConst(schemas, "AnalysisNextTake", "tested", false);
        setConst(schemas, "EffectiveExperiment", "tested", true);
        setConst(schemas, "ActorTraining", "tested", false);
        setConst(schemas, "BlockedReport", "report_type", "blocked");

        Schema<?> detail = schemas.get("ReportDetailResponse");
        if (detail != null && detail.getProperties() != null) {
            ComposedSchema report = new ComposedSchema();
            report.setTitle("Report");
            Schema<?> analysis = new Schema<>();
            analysis.set$ref("#/components/schemas/AnalysisReport");
            Schema<?> expression = new Schema<>();
            expression.set$ref("#/components/schemas/ExpressionReport");
            report.setAnyOf(new ArrayList<>(List.of(analysis, expression)));
            detail.getProperties().put("report", report);
            schemas.remove("JsonNode");
        }
    }

    private static void applyCoachSchemaShape(Map<String, Schema> schemas) {
        Schema<?> turn = schemas.get("CoachTurnResponse");
        if (turn != null && turn.getProperties() != null) {
            turn.getProperties().put("handoff", nullableReference("PublicHandoff", null));
            turn.getProperties().put("report", reportUnion(true));
        }
        Schema<?> confirm = schemas.get("CoachConfirmResponse");
        if (confirm != null && confirm.getProperties() != null) {
            confirm.getProperties().put("handoff", nullableReference("PublicHandoff", null));
            confirm.getProperties().put("report", reportUnion(false));
        }
        schemas.remove("JsonNode");
    }

    private static Schema<?> reportUnion(boolean nullable) {
        ComposedSchema report = new ComposedSchema();
        report.setTitle("Report");
        List<Schema> alternatives = new ArrayList<>();
        alternatives.add(reference("AnalysisReport"));
        alternatives.add(reference("ExpressionReport"));
        alternatives.add(reference("BlockedReport"));
        if (nullable) {
            alternatives.add(nullSchema());
        }
        report.setAnyOf(alternatives);
        return report;
    }

    private static Schema<?> nullableReference(String component, String title) {
        ComposedSchema nullable = new ComposedSchema();
        nullable.setTitle(title);
        nullable.setAnyOf(new ArrayList<>(List.of(reference(component), nullSchema())));
        return nullable;
    }

    private static Schema<?> reference(String component) {
        Schema<?> reference = new Schema<>();
        reference.set$ref("#/components/schemas/" + component);
        return reference;
    }

    private static void setConst(
            Map<String, Schema> schemas,
            String component,
            String property,
            Object value) {
        Schema<?> owner = schemas.get(component);
        if (owner == null || owner.getProperties() == null) {
            return;
        }
        Schema<?> field = (Schema<?>) owner.getProperties().get(property);
        if (field != null) {
            field.setConst(value);
        }
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
     * <p>기본 프로파일 정본의 수치 경계는 배타 2건({@code UploadIntentRequest})뿐이다.
     * 조건부 admin 프로파일의 {@code limit}은 포함 경계라 어노테이션에
     * {@code exclusiveMinimum=false}/{@code exclusiveMaximum=false}를 명시한다.
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
     * <p>{@code @Schema(minLength = 1)} 은 max 기본값이 {@link Integer#MAX_VALUE} 라 springdoc 이
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

    /**
     * 헤더 파라미터의 title 은 <b>이름 그대로</b>다.
     *
     * <p>정본에서 path·query 파라미터는 snake_case 를 변환하지만
     * ({@code session_id} → {@code Session Id}) 헤더만 {@code X-Request-Id} 를 그대로 쓴다 —
     * 헤더 이름은 이미 사람이 읽는 표기라 pydantic 이 손대지 않는다. 일반 규칙을 적용하면
     * {@code X-request-id} 가 되어 어긋난다.
     */
    private static String parameterTitle(io.swagger.v3.oas.models.parameters.Parameter parameter) {
        return "header".equals(parameter.getIn())
                ? parameter.getName()
                : propertyTitle(parameter.getName());
    }

    private static String propertyTitle(String wireName) {
        String[] words = wireName.split("_");
        List<String> titled = new ArrayList<>(words.length);
        for (String word : words) {
            if (word.isEmpty()) {
                continue;
            }
            String lower = word.toLowerCase(Locale.ROOT);
            StringBuilder title = new StringBuilder(lower);
            for (int index = 0; index < title.length(); index++) {
                char character = title.charAt(index);
                if (Character.isLetter(character)) {
                    title.setCharAt(index, Character.toUpperCase(character));
                    break;
                }
            }
            titled.add(title.toString());
        }
        return String.join(" ", titled);
    }
}
