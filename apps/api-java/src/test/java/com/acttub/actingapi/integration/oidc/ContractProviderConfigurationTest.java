package com.acttub.actingapi.integration.oidc;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;

class ContractProviderConfigurationTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(ContractProviderConfiguration.class, MapperConfiguration.class)
            .withPropertyValues("contract.auth-provider-fixture=/path/that/does/not/exist.json");

    @Test
    void defaultProfileNeverLoadsContractFixture() {
        runner.run(context -> assertThat(context)
                .doesNotHaveBean(ContractProviderFixture.class)
                .doesNotHaveBean(ProviderRegistry.class));
    }

    @Test
    void contractProfileBuildsRegistryFromConfiguredFixturePath() {
        runner.withPropertyValues(
                        "spring.profiles.active=contract",
                        "contract.auth-provider-fixture="
                                + "../../tools/contract-harness/contract_harness/fixtures/"
                                + "auth_providers.json")
                .run(context -> {
                    assertThat(context).hasNotFailed().hasSingleBean(ProviderRegistry.class);
                    assertThat(context.getBean(ProviderRegistry.class)
                            .verify("google", "harness-token-new-actor"))
                            .isEqualTo(new ProviderIdentity(
                                    "harness-new-actor",
                                    "new-actor@harness.test",
                                    true));
                });
    }

    static class MapperConfiguration {
        @Bean
        ObjectMapper objectMapper() {
            return new ObjectMapper();
        }
    }
}
