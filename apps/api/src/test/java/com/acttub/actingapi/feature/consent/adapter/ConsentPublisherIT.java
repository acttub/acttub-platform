package com.acttub.actingapi.feature.consent.adapter;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Stream;

import com.acttub.actingapi.feature.consent.adapter.db.ConsentDocumentJpaRepository;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.RecordingFailureReporter;
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
import org.springframework.dao.DataIntegrityViolationException;
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
    ConsentDocumentJpaRepository documents;

    @Autowired
    ConsentDocumentPublisher publisher;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    ResourceLoader resources;

    @Test
    @Order(1)
    void emptyDatabaseBootPublishesWholeManifestAndRepeatIsIdempotent() throws Exception {
        // 한국어 정본 4 + 영어 번역본 2(이용약관·AI 분석) = 6. 수집·이용 동의 v5 와 보관 동의는 아직 영어판이 없다.
        assertThat(jdbc.queryForList(
                "SELECT type,version,locale,title,required,length(body) body_length "
                        + "FROM consent_documents ORDER BY type,locale"))
                .hasSize(6)
                .allSatisfy(row -> {
                    // 필수 셋과 선택 하나(탈퇴 후 영상·녹음 보관·활용).
                    assertThat(row.get("required")).isEqualTo(!"retention".equals(row.get("type")));
                    assertThat(((Number) row.get("body_length")).intValue()).isPositive();
                });
        assertThat(jdbc.queryForObject(
                "SELECT title FROM consent_documents WHERE type='privacy'", String.class))
                .as("privacy 는 동의를 받는 문서다. 처리방침은 고지라 이 목록에 없다")
                .isEqualTo("개인정보 수집·이용 동의");
        assertThat(publisher.publish()).as("같은 판이면 행이 늘지 않는다").isZero();
    }

    @Test
    @Order(2)
    void accountConsent_newerVersionInTheDeployedFilesBecomesANewRowAndTheOldOneStays(
            @TempDir Path directory) throws Exception {
        Files.writeString(directory.resolve("terms.md"), "새 약관 본문");
        Files.writeString(directory.resolve("manifest.json"), """
                [{"file":"terms.md","type":"terms","version":"v2","title":"이용약관","required":true}]
                """);

        assertThat(publisherFor(directory).publish()).isEqualTo(1);

        assertThat(jdbc.queryForList(
                // 번역본(en)은 한국어 행의 판에 딸린 것이라 판 목록은 한국어 행으로 센다 (README 「말」).
                "SELECT version FROM consent_documents WHERE type='terms' AND locale='ko' ORDER BY published_at,version",
                String.class)).containsExactly("v1", "v2");
        assertThat(publisherFor(directory).publish()).isZero();
        jdbc.update("DELETE FROM consent_documents WHERE type='terms' AND version='v2'");
    }

    @Test
    @Order(2)
    void accountConsent_sameVersionWithEditedTextIsRewrittenInPlaceWithoutReconsent(
            @TempDir Path directory) throws Exception {
        var before = jdbc.queryForMap(
                "SELECT id,published_at FROM consent_documents WHERE type='terms' AND version='v1' AND locale='ko'");
        Files.writeString(directory.resolve("terms.md"), "오탈자를 고친 약관 본문");
        Files.writeString(directory.resolve("manifest.json"), """
                [{"file":"terms.md","type":"terms","version":"v1","title":"이용약관","required":true}]
                """);

        assertThat(publisherFor(directory).publish()).as("새 판이 아니다").isZero();

        assertThat(jdbc.queryForMap("""
                SELECT id,published_at,body FROM consent_documents WHERE type='terms' AND locale='ko'
                """))
                .as("같은 행이다 — 결정이 가리키는 문서 id 가 그대로라 재동의 게이트가 뜨지 않는다")
                .containsEntry("id", before.get("id"))
                .containsEntry("published_at", before.get("published_at"))
                .containsEntry("body", "오탈자를 고친 약관 본문");
    }

    private ConsentDocumentPublisher publisherFor(Path directory) {
        return new ConsentDocumentPublisher(
                documents, mapper, resources, directory.toString(), new RecordingFailureReporter());
    }

    @Test
    @Order(2)
    void missingOrInvalidManifestNeverStopsStartup(@TempDir Path directory) throws Exception {
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ConsentDocumentPublisher missing = new ConsentDocumentPublisher(
                documents,
                mapper,
                resources,
                directory.resolve("missing").toString(),
                reporter);
        assertThatCode(() -> missing.run(new DefaultApplicationArguments()))
                .doesNotThrowAnyException();

        Files.writeString(directory.resolve("manifest.json"), "{");
        ConsentDocumentPublisher invalid = new ConsentDocumentPublisher(
                documents,
                mapper,
                resources,
                directory.toString(),
                reporter);
        assertThatCode(() -> invalid.run(new DefaultApplicationArguments()))
                .doesNotThrowAnyException();
        // 기동은 막지 않되 둘 다 조용히 넘기지 않는다 — 발행이 안 되면 API 가 옛 판을 현재 판으로
        // 돌려주고, 그러면 새 수집이 옛 동의로 켜질 수 있다.
        assertThat(reporter.reports()).hasSize(2).allSatisfy(report -> {
            assertThat(report.kind()).isEqualTo(FailureKind.UNEXPECTED);
            assertThat(report.context()).isEqualTo("ConsentDocumentPublisher.seed");
        });
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
                documents,
                mapper,
                resources,
                directory.toString(),
                new RecordingFailureReporter());
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
        ConsentDocumentPublisher other = new ConsentDocumentPublisher(
                documents,
                mapper,
                resources,
                "",
                new RecordingFailureReporter());
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Integer> first = pool.submit(publisher::publish);
            Future<Integer> second = pool.submit(other::publish);
            assertThat(first.get() + second.get()).isBetween(6, 12);
            assertThat(jdbc.queryForObject(
                    "SELECT count(*) FROM consent_documents",
                    Integer.class)).isEqualTo(6);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @Order(5)
    void publishPropagatesConstraintViolationsOtherThanTheNamedUniqueRace() {
        jdbc.update("DELETE FROM consent_documents");
        jdbc.execute("""
                ALTER TABLE consent_documents
                ADD CONSTRAINT ck_test_consent_document_title
                CHECK (title <> '이용약관')
                """);
        try {
            assertThatThrownBy(publisher::publish)
                    .isInstanceOf(DataIntegrityViolationException.class);
        } finally {
            jdbc.execute("""
                    ALTER TABLE consent_documents
                    DROP CONSTRAINT ck_test_consent_document_title
                    """);
        }
    }
}
