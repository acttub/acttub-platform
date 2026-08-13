package com.acttub.actingapi.auth;

import java.nio.file.Path;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration(proxyBeanMethods = false)
@Profile("contract")
class ContractProviderConfiguration {
    @Bean
    ContractProviderFixture contractProviderFixture(
            ObjectMapper mapper,
            @Value("${contract.auth-provider-fixture}") String fixturePath) {
        return ContractProviderFixture.load(mapper, Path.of(fixturePath));
    }

    @Bean
    ProviderRegistry providerRegistry(ContractProviderFixture fixture) {
        return new ProviderRegistry(fixture.verifiers());
    }
}
