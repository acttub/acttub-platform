package com.acttub.actingapi.consent.adapter;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Stream;

import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ResourceLoader;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ConsentPublisherIT {
    @DynamicPropertySource
    static void db(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("consent_publish");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    ConsentDocumentPublisher publisher;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    ResourceLoader resources;

    @Test
    @Order(1)
    void emptyDatabaseBootPublishesWholeManifestAndRepeatIsIdempotent() throws Exception {
        assertThat(jdbc.queryForList(
                "SELECT type::text,version,title,required,length(body) body_length "
                        + "FROM consent_documents ORDER BY type::text"))
                .hasSize(3)
                .allSatisfy(row -> {
                    assertThat(row.get("required")).isEqualTo(true);
                    assertThat(((Number) row.get("body_length")).intValue()).isPositive();
                });
        assertThat(publisher.publish()).isZero();
    }

    @Test
    @Order(2)
    void missingOrInvalidManifestNeverStopsStartup(@TempDir Path directory) throws Exception {
        ConsentDocumentPublisher missing = new ConsentDocumentPublisher(
                jdbc,
                mapper,
                resources,
                directory.resolve("missing").toString());
        assertThatCode(() -> missing.run(new DefaultApplicationArguments()))
                .doesNotThrowAnyException();

        Files.writeString(directory.resolve("manifest.json"), "{");
        ConsentDocumentPublisher invalid = new ConsentDocumentPublisher(
                jdbc,
                mapper,
                resources,
                directory.toString());
        assertThatCode(() -> invalid.run(new DefaultApplicationArguments()))
                .doesNotThrowAnyException();
    }

    @ParameterizedTest(name = "required가 {0}이면 manifest 전체를 거부한다")
    @MethodSource("invalidRequiredValues")
    @Order(3)
    void invalidRequiredPublishesNothingAndStartupContinues(
            String description,
            String requiredMember,
            @TempDir Path directory) throws Exception {
        jdbc.update("DELETE FROM consent_documents");
        Files.writeString(directory.resolve("valid.md"), "valid");
        Files.writeString(directory.resolve("invalid.md"), "invalid");
        Files.writeString(directory.resolve("manifest.json"), """
                [
                  {"file":"valid.md","type":"terms","version":"strict-valid",
                   "title":"Valid","required":true},
                  {"file":"invalid.md","type":"privacy","version":"strict-invalid",
                   "title":"Invalid"%s}
                ]
                """.formatted(requiredMember));

        ConsentDocumentPublisher malformed = new ConsentDocumentPublisher(
                jdbc,
                mapper,
                resources,
                directory.toString());
        assertThatCode(() -> malformed.run(new DefaultApplicationArguments()))
                .doesNotThrowAnyException();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM consent_documents",
                Integer.class)).isZero();
    }

    static Stream<Arguments> invalidRequiredValues() {
        return Stream.of(
                Arguments.of("누락", ""),
                Arguments.of("null", ",\"required\":null"),
                Arguments.of("문자열", ",\"required\":\"true\""));
    }

    @Test
    @Order(4)
    void concurrentPublishIgnoresOnlyTheNamedUniqueRace() throws Exception {
        jdbc.update("DELETE FROM consent_documents");
        ConsentDocumentPublisher other = new ConsentDocumentPublisher(jdbc, mapper, resources, "");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Integer> first = pool.submit(publisher::publish);
            Future<Integer> second = pool.submit(other::publish);
            assertThat(first.get() + second.get()).isBetween(3, 6);
            assertThat(jdbc.queryForObject(
                    "SELECT count(*) FROM consent_documents",
                    Integer.class)).isEqualTo(3);
        } finally {
            pool.shutdownNow();
        }
    }
}
