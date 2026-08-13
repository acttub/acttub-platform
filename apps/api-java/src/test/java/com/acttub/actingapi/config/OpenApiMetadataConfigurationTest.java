package com.acttub.actingapi.config;

import static org.assertj.core.api.Assertions.assertThat;

import io.swagger.v3.oas.models.SpecVersion;
import org.junit.jupiter.api.Test;

class OpenApiMetadataConfigurationTest {
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
