package com.acttub.actingapi.platform.config;

import static org.assertj.core.api.Assertions.assertThat;

import io.swagger.v3.oas.models.SpecVersion;
import org.junit.jupiter.api.Test;

class OpenApiMetadataConfigurationTest {
    @Test
    void threeLayerUnionsKeepBothVersionsAndEveryReferenceResolves() {
        var configuration = new PydanticOpenApiCustomizer();
        var models = new java.util.LinkedHashMap<String, io.swagger.v3.oas.models.media.Schema>();
        var converters = io.swagger.v3.core.converter.ModelConverters.getInstance(true);
        models.putAll(converters.readAll(com.acttub.actingapi.feature.practice.adapter.web.PracticeSessionDtos.PracticeSessionDetail.class));
        models.putAll(converters.readAll(com.acttub.actingapi.feature.coach.adapter.web.CoachDtos.CoachTurnResponse.class));
        models.putAll(converters.readAll(com.acttub.actingapi.feature.report.adapter.web.ReportDtos.ReportDetailResponse.class));
        var api = new io.swagger.v3.oas.models.OpenAPI().components(new io.swagger.v3.oas.models.Components().schemas(models));
        configuration.pydanticSchemaShapeCustomizer().customise(api);
        com.fasterxml.jackson.databind.JsonNode json = io.swagger.v3.core.util.Json31.mapper().valueToTree(api);
        var schemas = json.path("components").path("schemas");
        for (var ref : json.findValues("$ref")) {
            assertThat(ref.asText()).startsWith("#/components/schemas/");
            assertThat(schemas.has(ref.asText().substring("#/components/schemas/".length())))
                    .as("dangling reference %s", ref.asText()).isTrue();
        }
        assertThat(schemas.path("PracticeSessionDetail").at("/properties/summary/anyOf").toString())
                .contains("ObservationPackResponse", "VideoRecordSummaryResponse").doesNotContain("JsonNode");
        for (String component : java.util.List.of("CoachTurnResponse", "ReportDetailResponse")) {
            assertThat(schemas.path(component).at("/properties/report/anyOf").toString())
                    .contains("AnalysisReport", "ExpressionReport", "PublicPracticeNote");
        }
        assertThat(schemas.path("PublicPracticeNote").at("/properties/revision/minimum").asInt()).isEqualTo(1);
        assertThat(schemas.path("PublicPracticeNote").at("/properties/revision/exclusiveMinimum").isMissingNode()).isTrue();
    }

    @Test
    void metadataMatchesFastApiAndGeneratedServersAreRemoved() {
        var configuration = new OpenApiMetadataConfiguration();
        var openApi = configuration.actingApiOpenApi();

        assertThat(openApi.getSpecVersion()).isEqualTo(SpecVersion.V31);
        assertThat(openApi.getInfo().getTitle()).isEqualTo("acting-api");
        assertThat(openApi.getInfo().getVersion()).isEqualTo("0.1.0");
        assertThat(openApi.getInfo().getDescription()).isEqualTo(
                "연기 분석 플랫폼 API v2. Bearer access token을 사용합니다.");
        assertThat(openApi.getServers()).isNotEmpty();

        configuration.removeGeneratedServerMetadata().customise(openApi);
        assertThat(openApi.getServers()).isNull();
    }
}
