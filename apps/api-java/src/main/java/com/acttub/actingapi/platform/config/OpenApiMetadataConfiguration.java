package com.acttub.actingapi.platform.config;

import java.util.List;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.SpecVersion;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.servers.Server;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;

/** FastAPI가 커밋한 문서 최상위 메타데이터를 springdoc에도 고정한다. */
@Configuration(proxyBeanMethods = false)
class OpenApiMetadataConfiguration {
    private static final String DESCRIPTION =
            "연기 분석 플랫폼 API v2. Bearer access token을 사용합니다.";

    @Bean
    OpenAPI actingApiOpenApi() {
        // 비어 있지 않은 초기 servers는 springdoc의 요청 URL 자동 생성을 막는다.
        // 직렬화 전 customizer가 이 sentinel 자체도 제거한다.
        return new OpenAPI(SpecVersion.V31)
                .info(new Info()
                        .title("acting-api")
                        .description(DESCRIPTION)
                        .version("0.1.0"))
                .servers(List.of(new Server().url("/__springdoc_server_sentinel__")));
    }

    @Bean
    @Order(Ordered.LOWEST_PRECEDENCE)
    OpenApiCustomizer removeGeneratedServerMetadata() {
        return openApi -> openApi.setServers(null);
    }
}
