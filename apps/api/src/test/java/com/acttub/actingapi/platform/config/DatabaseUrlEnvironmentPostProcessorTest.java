package com.acttub.actingapi.platform.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class DatabaseUrlEnvironmentPostProcessorTest {

    private static MockEnvironment process(MockEnvironment environment) {
        new DatabaseUrlEnvironmentPostProcessor().postProcessEnvironment(environment, null);
        return environment;
    }

    @Test
    void deployUrlWithOnlyAUserSetsTheUrlAndUsernameButNoPassword() {
        MockEnvironment environment = process(new MockEnvironment()
                .withProperty("DATABASE_URL", "postgresql://acting@db.internal/acting"));

        assertThat(environment.getProperty("spring.datasource.url"))
                .isEqualTo("jdbc:postgresql://db.internal:5432/acting");
        assertThat(environment.getProperty("spring.datasource.username")).isEqualTo("acting");
        assertThat(environment.containsProperty("spring.datasource.password")).isFalse();
    }

    @Test
    void blankDatabaseUrlOrAnExplicitDatasourceUrlLeavesTheEnvironmentAlone() {
        MockEnvironment blank = process(new MockEnvironment().withProperty("DATABASE_URL", "  "));
        MockEnvironment explicit = process(new MockEnvironment()
                .withProperty("spring.datasource.url", "jdbc:postgresql://localhost:5432/test")
                .withProperty("DATABASE_URL", "postgresql://u:p@h/db"));

        assertThat(blank.getPropertySources().contains(DatabaseUrlEnvironmentPostProcessor.PROPERTY_SOURCE_NAME))
                .isFalse();
        assertThat(explicit.getProperty("spring.datasource.url")).isEqualTo("jdbc:postgresql://localhost:5432/test");
        assertThat(explicit.containsProperty("spring.datasource.username")).isFalse();
    }
}
