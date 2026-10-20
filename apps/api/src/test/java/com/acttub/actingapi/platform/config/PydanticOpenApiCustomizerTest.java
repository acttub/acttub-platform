package com.acttub.actingapi.platform.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.Paths;
import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.ComposedSchema;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.IntegerSchema;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import org.junit.jupiter.api.Test;

/**
 * springdoc 산출물을 pydantic 이 내던 모양으로 바꾸는 규칙을 합성 문서로 본다.
 *
 * <p>{@code OpenApiSnapshotIT} 는 실제 스펙 전체가 커밋된 스냅샷과 같은지만 본다. 지금 스펙에 없는 모양(3.1
 * {@code types} 집합의 nullable, 배열 기본값, 맵이 아닌 nullable 컴포넌트)은 거기서 드러나지 않으므로 여기서 본다.
 */
class PydanticOpenApiCustomizerTest {

    private static void customise(OpenAPI openApi) {
        new PydanticOpenApiCustomizer().pydanticSchemaShapeCustomizer().customise(openApi);
    }

    private static Schema<?> typed(String... types) {
        Schema<?> schema = new Schema<>();
        schema.setTypes(new LinkedHashSet<>(List.of(types)));
        return schema;
    }

    private static Schema<?> object(Map<String, Schema> properties) {
        Schema<?> schema = new Schema<>();
        schema.setType("object");
        schema.setProperties(new LinkedHashMap<>(properties));
        return schema;
    }

    private static OpenAPI document(Map<String, Schema> components) {
        return new OpenAPI().components(new Components().schemas(new LinkedHashMap<>(components)));
    }

    @Test
    void parametersGetPydanticTitlesAndNullableBecomesAnyOfWithNull() {
        ArraySchema ids = new ArraySchema();
        ids.setNullable(true);
        ids.setItems(new IntegerSchema().format("int64"));
        StringSchema requestId = new StringSchema();
        requestId.setMaxLength(Integer.MAX_VALUE);
        ComposedSchema mode = new ComposedSchema();
        StringSchema modeText = new StringSchema();
        modeText.setMaxLength(Integer.MAX_VALUE);
        mode.setAnyOf(new java.util.ArrayList<>(List.of(modeText, new IntegerSchema().format("int32"))));
        Operation get = new Operation().parameters(new java.util.ArrayList<>(List.of(
                new Parameter().in("query").name("session_ids").schema(ids),
                new Parameter().in("header").name("X-Request-Id").schema(requestId),
                new Parameter().in("query").name("mode").schema(mode),
                new Parameter().in("query").name("flag").schema(typed("boolean", "null")),
                new Parameter().in("query").name("raw"))));
        OpenAPI openApi = new OpenAPI().paths(new Paths()
                .addPathItem("/v2/things", new PathItem().get(get).post(new Operation())));

        customise(openApi);

        List<Parameter> parameters = get.getParameters();
        Schema<?> nullableIds = parameters.get(0).getSchema();
        assertThat(nullableIds.getTitle()).isEqualTo("Session Ids");
        assertThat(nullableIds.getAnyOf()).hasSize(2);
        Schema<?> idsArray = nullableIds.getAnyOf().get(0);
        assertThat(idsArray.getTitle()).isNull();
        assertThat(idsArray.getNullable()).isNull();
        assertThat(idsArray.getItems().getFormat()).isNull();
        assertThat(nullableIds.getAnyOf().get(1).getTypes()).containsExactly("null");

        Schema<?> header = parameters.get(1).getSchema();
        assertThat(header.getTitle()).isEqualTo("X-Request-Id");
        assertThat(header.getMaxLength()).isNull();

        Schema<?> union = parameters.get(2).getSchema();
        assertThat(union.getTitle()).isEqualTo("Mode");
        assertThat(union.getAnyOf().get(0).getMaxLength()).isNull();
        assertThat(union.getAnyOf().get(1).getFormat()).isNull();

        Schema<?> flag = parameters.get(3).getSchema();
        assertThat(flag.getTitle()).isEqualTo("Flag");
        assertThat(flag.getAnyOf().get(0).getTypes()).containsExactly("boolean");
        assertThat(flag.getAnyOf().get(0).getType()).isEqualTo("boolean");
        assertThat(flag.getAnyOf().get(1).getTypes()).containsExactly("null");

        assertThat(parameters.get(4).getSchema()).isNull();
    }

    @Test
    void wildcardResponseIsDroppedWhenJsonIsAlreadyDocumentedAndInlineAnyOfLosesItsType() {
        ComposedSchema report = new ComposedSchema();
        report.setType("string");
        report.setAnyOf(new java.util.ArrayList<>(List.of(new StringSchema(), new IntegerSchema())));
        MediaType json = new MediaType().schema(report);
        MediaType wildcard = new MediaType().schema(new StringSchema());
        ApiResponse ok = new ApiResponse().content(new Content()
                .addMediaType("*/*", wildcard)
                .addMediaType("application/json", json));
        Operation get = new Operation().responses(new ApiResponses()
                .addApiResponse("200", ok)
                .addApiResponse("204", new ApiResponse()));
        OpenAPI openApi = new OpenAPI().paths(new Paths()
                .addPathItem("/v2/reports", new PathItem().get(get).post(new Operation())));

        customise(openApi);

        assertThat(ok.getContent()).containsOnlyKeys("application/json");
        assertThat(ok.getContent().get("application/json")).isSameAs(json);
        assertThat(report.getType()).isNull();
        assertThat(report.getAnyOf()).hasSize(2);
    }

    @Test
    void documentWithoutPathsOrComponentsIsLeftAlone() {
        OpenAPI bare = new OpenAPI();

        customise(bare);

        assertThat(bare.getPaths()).isNull();
        assertThat(bare.getComponents()).isNull();

        OpenAPI noSchemas = new OpenAPI().components(new Components());
        customise(noSchemas);
        assertThat(noSchemas.getComponents().getSchemas()).isNull();
    }

    @Test
    void componentPropertiesGetTitlesExclusiveBoundsAndTypedDefaults() {
        Schema<?> count = new IntegerSchema().format("int32");
        count.setMinimum(BigDecimal.ZERO);
        Schema<?> ratio = new Schema<>().type("number").format("double");
        ratio.setMinimum(new BigDecimal("0.5"));
        Schema<?> limit = new IntegerSchema();
        limit.setMinimum(BigDecimal.ONE);
        limit.setExclusiveMinimum(false);
        limit.setMaximum(BigDecimal.valueOf(100));
        limit.setExclusiveMaximum(false);
        Schema<Object> tags = new Schema<>().type("array");
        tags.setDefault("[]");
        Schema<Object> label = new Schema<>();
        label.setTypes(new LinkedHashSet<>(List.of("string")));
        label.setDefault("maybe");
        Schema<Object> enabled = new Schema<>().type("boolean");
        enabled.setDefault("yes");
        Map<String, Schema> properties = new LinkedHashMap<>();
        properties.put("max_count", count);
        properties.put("ratio", ratio);
        properties.put("limit", limit);
        properties.put("tags", tags);
        properties.put("label", label);
        properties.put("enabled", enabled);
        properties.put("a__b", new StringSchema());
        properties.put("2fa_code", new StringSchema());
        properties.put("_1", new StringSchema());
        OpenAPI openApi = document(Map.of("Prefs", object(properties)));

        customise(openApi);

        Schema<?> prefs = openApi.getComponents().getSchemas().get("Prefs");
        assertThat(prefs.getTitle()).isEqualTo("Prefs");
        Map<String, Schema> normalized = prefs.getProperties();
        assertThat(normalized.get("max_count").getTitle()).isEqualTo("Max Count");
        assertThat(normalized.get("max_count").getFormat()).isNull();
        assertThat(normalized.get("max_count").getMinimum()).isNull();
        assertThat(normalized.get("max_count").getExclusiveMinimumValue()).isEqualTo(new BigDecimal("0.0"));
        assertThat(normalized.get("ratio").getFormat()).isNull();
        assertThat(normalized.get("ratio").getExclusiveMinimumValue()).isEqualTo(new BigDecimal("0.5"));
        assertThat(normalized.get("limit").getMinimum()).isEqualTo(BigDecimal.ONE);
        assertThat(normalized.get("limit").getMaximum()).isEqualTo(BigDecimal.valueOf(100));
        assertThat(normalized.get("limit").getExclusiveMinimumValue()).isNull();
        assertThat(normalized.get("tags").getDefault()).isEqualTo(List.of());
        assertThat(normalized.get("label").getDefault()).isEqualTo("maybe");
        assertThat(normalized.get("enabled").getDefault()).isEqualTo("yes");
        assertThat(normalized.get("a__b").getTitle()).isEqualTo("A B");
        assertThat(normalized.get("2fa_code").getTitle()).isEqualTo("2Fa Code");
        assertThat(normalized.get("_1").getTitle()).isEqualTo("1");
    }

    @Test
    void openApi31NullableTypeSetsBecomeAnyOfWithANullSchema() {
        Schema<?> score = typed("number", "null");
        score.setFormat("double");
        Schema<?> either = typed("string", "integer", "null");
        ComposedSchema already = new ComposedSchema();
        already.setNullable(true);
        already.setAnyOf(new java.util.ArrayList<>(List.of(new StringSchema(), new Schema<>().type("null"))));
        Map<String, Schema> properties = new LinkedHashMap<>();
        properties.put("score", score);
        properties.put("either", either);
        properties.put("already", already);
        OpenAPI openApi = document(Map.of("Result", object(properties)));

        customise(openApi);

        Map<String, Schema> normalized = openApi.getComponents().getSchemas().get("Result").getProperties();
        Schema<?> nullableScore = normalized.get("score");
        assertThat(nullableScore.getTitle()).isEqualTo("Score");
        assertThat(nullableScore.getAnyOf().get(0).getTypes()).containsExactly("number");
        assertThat(nullableScore.getAnyOf().get(0).getType()).isEqualTo("number");
        assertThat(nullableScore.getAnyOf().get(0).getFormat()).isNull();
        assertThat(nullableScore.getAnyOf().get(1).getTypes()).containsExactly("null");

        Schema<?> nullableEither = normalized.get("either");
        assertThat(nullableEither.getAnyOf().get(0).getTypes()).containsExactly("string", "integer");
        assertThat(nullableEither.getAnyOf().get(0).getType()).isNull();

        assertThat(normalized.get("already")).isSameAs(already);
        assertThat(already.getAnyOf()).hasSize(2);
    }

    @Test
    void anyOfThatAlreadyHasAnOpenApi31NullSchemaIsLeftAsIs() {
        Schema<?> nullType = typed("null");
        ComposedSchema already = new ComposedSchema();
        already.setNullable(true);
        already.setAnyOf(new java.util.ArrayList<>(List.of(new StringSchema(), nullType)));
        OpenAPI openApi = document(Map.of("Result", object(Map.of("already", already))));

        customise(openApi);

        Map<String, Schema> normalized = openApi.getComponents().getSchemas().get("Result").getProperties();
        assertThat(normalized.get("already")).isSameAs(already);
        assertThat(already.getAnyOf().get(1)).isSameAs(nullType);
        assertThat(nullType.getTypes()).containsExactly("null");
    }

    @Test
    void validationErrorGetsFastApiTitlesOnlyForThePropertiesItHas() {
        OpenAPI partial = document(Map.of("ValidationError", object(Map.of("msg", new StringSchema()))));

        customise(partial);

        Schema<?> error = partial.getComponents().getSchemas().get("ValidationError");
        assertThat(error.getRequired()).containsExactly("msg");
        assertThat(error.getProperties()).containsOnlyKeys("msg");
        assertThat(((Schema<?>) error.getProperties().get("msg")).getTitle()).isEqualTo("Message");

        Schema<?> bare = new Schema<>().type("object");
        OpenAPI withoutProperties = document(Map.of("ValidationError", bare));
        customise(withoutProperties);
        assertThat(bare.getRequired()).isNull();
        assertThat(bare.getTitle()).isEqualTo("ValidationError");
    }

    @Test
    void nullableAdmissionWeightsComponentIsUnwrappedAndReferencedAsNullable() {
        Schema<?> weights = object(Map.of("practical", new IntegerSchema()));
        ComposedSchema nullableWeights = new ComposedSchema();
        nullableWeights.setAnyOf(new java.util.ArrayList<>(List.of(new Schema<>().type("null"), weights)));
        Map<String, Schema> notice = new LinkedHashMap<>();
        notice.put("designated_works", new ArraySchema().items(new StringSchema()));
        notice.put("weights", new Schema<>());
        Map<String, Schema> components = new LinkedHashMap<>();
        components.put("AdmissionNotice", object(notice));
        components.put("AdmissionWeights", nullableWeights);
        components.put("AdmissionStage", new Schema<>().type("object"));
        OpenAPI openApi = document(components);

        customise(openApi);

        Map<String, Schema> schemas = openApi.getComponents().getSchemas();
        assertThat(schemas.get("AdmissionWeights")).isSameAs(weights);
        assertThat(weights.getTitle()).isEqualTo("AdmissionWeights");
        Schema<?> noticeWeights = (Schema<?>) schemas.get("AdmissionNotice").getProperties().get("weights");
        assertThat(noticeWeights.getAnyOf()).hasSize(2);
        assertThat(noticeWeights.getAnyOf().get(0).get$ref()).isEqualTo("#/components/schemas/AdmissionWeights");
        assertThat(noticeWeights.getAnyOf().get(1).getTypes()).containsExactly("null");
        assertThat(((Schema<?>) schemas.get("AdmissionNotice").getProperties().get("designated_works")).getDefault())
                .isEqualTo(List.of());
        assertThat(schemas.get("AdmissionStage").getProperties()).isNull();
    }

    @Test
    void reportDetailGetsTheReportUnionAndMissingReportFieldsAreSkipped() {
        Map<String, Schema> components = new LinkedHashMap<>();
        components.put("ReportDetailResponse", object(Map.of("report", new Schema<>())));
        components.put("JsonNode", new Schema<>().type("object"));
        components.put("AnalysisNextTake", new Schema<>().type("object"));
        components.put("EffectiveExperiment", object(Map.of("label", new StringSchema())));
        components.put("PracticeNoteRecordRef", new Schema<>().type("object"));
        components.put("PublicPracticeNote", object(Map.of("body", new StringSchema())));
        OpenAPI openApi = document(components);

        customise(openApi);

        Map<String, Schema> schemas = openApi.getComponents().getSchemas();
        Schema<?> report = (Schema<?>) schemas.get("ReportDetailResponse").getProperties().get("report");
        assertThat(report.getTitle()).isEqualTo("Report");
        assertThat(report.getAnyOf()).extracting(Schema::get$ref).containsExactly(
                "#/components/schemas/AnalysisReport",
                "#/components/schemas/ExpressionReport",
                "#/components/schemas/PublicPracticeNote");
        assertThat(schemas).doesNotContainKey("JsonNode");
        assertThat(schemas.get("AnalysisNextTake").getProperties()).isNull();
        assertThat(schemas.get("EffectiveExperiment").getProperties()).containsOnlyKeys("label");
        assertThat(schemas.get("PublicPracticeNote").getProperties()).containsOnlyKeys("body");
        assertThat(schemas.get("PracticeNoteRecordRef").getProperties()).isNull();
        Schema<?> analysisType = (Schema<?>) schemas.get("AnalysisReport").getProperties().get("report_type");
        assertThat(analysisType.getConst()).isEqualTo("analysis");
        assertThat(Set.copyOf(schemas.keySet())).contains("ExpressionReport", "BlockedReport");
    }
}
