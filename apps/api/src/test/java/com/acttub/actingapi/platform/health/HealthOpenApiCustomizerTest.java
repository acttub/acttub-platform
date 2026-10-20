package com.acttub.actingapi.platform.health;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.Paths;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import org.junit.jupiter.api.Test;

class HealthOpenApiCustomizerTest {

    private static void customise(OpenAPI openApi) {
        new HealthOpenApiCustomizer().healthResponseConstCustomizer().customise(openApi);
    }

    @Test
    void healthLosesItsGeneratedTagAndStatusBecomesTheOkConstant() {
        Operation get = new Operation().tags(new java.util.ArrayList<>(List.of("health-controller")));
        Operation other = new Operation().tags(new java.util.ArrayList<>(List.of("v2-auth")));
        Schema<?> status = new StringSchema();
        Schema<?> health = new Schema<>().type("object");
        health.setProperties(new LinkedHashMap<>(Map.of("status", status)));
        OpenAPI openApi = new OpenAPI()
                .paths(new Paths()
                        .addPathItem("/health", new PathItem().get(get))
                        .addPathItem("/v2/auth/login", new PathItem().post(other)))
                .components(new Components().schemas(new LinkedHashMap<>(Map.of("HealthResponse", health))));

        customise(openApi);

        assertThat(get.getTags()).isNull();
        assertThat(other.getTags()).containsExactly("v2-auth");
        assertThat(status.getConst()).isEqualTo("ok");
    }

    @Test
    void documentWithoutTheHealthPathOrStatusPropertyIsUnchanged() {
        Schema<?> other = new StringSchema();
        Schema<?> health = new Schema<>().type("object");
        health.setProperties(new LinkedHashMap<>(Map.of("version", other)));
        OpenAPI withoutStatus = new OpenAPI()
                .paths(new Paths())
                .components(new Components().schemas(new LinkedHashMap<>(Map.of(
                        "HealthResponse", health, "Bare", new Schema<>().type("object")))));

        customise(withoutStatus);

        assertThat(health.getProperties()).containsOnlyKeys("version");
        assertThat(other.getConst()).isNull();

        OpenAPI withoutHealthComponent = new OpenAPI()
                .components(new Components().schemas(new LinkedHashMap<>(Map.of("Bare", new Schema<>()))));
        customise(withoutHealthComponent);
        assertThat(withoutHealthComponent.getComponents().getSchemas()).containsOnlyKeys("Bare");

        OpenAPI healthWithoutProperties = new OpenAPI()
                .components(new Components().schemas(new LinkedHashMap<>(Map.of("HealthResponse", new Schema<>()))));
        customise(healthWithoutProperties);
        assertThat(healthWithoutProperties.getComponents().getSchemas().get("HealthResponse").getProperties()).isNull();

        OpenAPI bare = new OpenAPI();
        customise(bare);
        assertThat(bare.getComponents()).isNull();
    }
}
