package com.acttub.actingapi.storage;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;

class ContractObjectStorageConfigurationTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(ContractObjectStorage.class, MapperConfiguration.class)
            .withPropertyValues("contract.s3-fixture=/path/that/does/not/exist.json");

    @Test
    void defaultProfileNeverLoadsContractStorage() {
        runner.run(context -> assertThat(context).doesNotHaveBean(ObjectStorage.class));
    }

    @Test
    void contractProfileLoadsTheSharedFixture() {
        runner.withPropertyValues(
                        "spring.profiles.active=contract",
                        "contract.s3-fixture="
                                + "../../tools/contract-harness/contract_harness/fixtures/s3.json")
                .run(context -> {
                    assertThat(context).hasNotFailed().hasSingleBean(ObjectStorage.class);
                    assertThat(context.getBean(ObjectStorage.class)
                            .presignUpload("video.mp4", "video/mp4", 12, 1800))
                            .contains("X-Amz-Algorithm=")
                            .contains("X-Amz-Signature=");
                });
    }

    static class MapperConfiguration {
        @Bean
        ObjectMapper objectMapper() {
            return new ObjectMapper();
        }
    }
}
