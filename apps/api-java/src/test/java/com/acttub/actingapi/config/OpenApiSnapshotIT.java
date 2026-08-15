package com.acttub.actingapi.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.nio.file.Files;
import java.nio.file.Path;

import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * springdoc 산출물을 커밋된 스냅샷에 대고 고정한다.
 *
 * <p>이 JSON이 곧 API 계약서다. 패키지를 옮기거나 DTO를 건드릴 때 스키마 이름·형상이 조용히
 * 바뀌면 {@code apps/web}의 생성 타입이 어긋난다. <b>M6에서 계약 하네스를 지우고 나면 이 테스트가
 * 스펙 회귀를 잡는 유일한 장치가 된다</b>(spec/M6-cleanup.md §B).
 *
 * <p><b>스펙이 의도적으로 바뀌었다면</b> {@code UPDATE_OPENAPI_SNAPSHOT=1 ./gradlew test
 * --tests '*OpenApiSnapshotIT*'}로 스냅샷을 다시 뜨고 <b>diff를 눈으로 확인한 뒤</b> 커밋한다.
 * 갱신 모드는 일부러 실패로 끝난다 — 갱신한 채로 초록을 받아 들고 가면 검사가 무력해진다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
class OpenApiSnapshotIT {

    private static final Path SNAPSHOT = Path.of("src/test/resources/openapi-snapshot.json");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("openapi_snapshot");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @Test
    void springdocOutputMatchesSnapshot() throws Exception {
        String body = mvc.perform(get("/v3/api-docs"))
                .andReturn()
                .getResponse()
                .getContentAsString();
        ObjectMapper mapper = new ObjectMapper();
        String actual = mapper.writerWithDefaultPrettyPrinter()
                .writeValueAsString(mapper.readTree(body)) + "\n";

        if ("1".equals(System.getenv("UPDATE_OPENAPI_SNAPSHOT"))) {
            Files.writeString(SNAPSHOT, actual);
            fail("스냅샷을 다시 떴다 (%s). diff 를 확인하고 커밋한 뒤 이 변수 없이 다시 돌려라.",
                    SNAPSHOT.toAbsolutePath());
        }

        assertThat(SNAPSHOT).as("스냅샷이 없다. UPDATE_OPENAPI_SNAPSHOT=1 로 먼저 뜬다").exists();
        assertThat(actual)
                .as("springdoc 산출물이 %s 와 달라졌다. 의도한 계약 변경이면 스냅샷을 갱신하라", SNAPSHOT)
                .isEqualTo(Files.readString(SNAPSHOT));
    }
}
