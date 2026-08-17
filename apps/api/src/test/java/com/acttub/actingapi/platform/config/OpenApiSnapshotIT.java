package com.acttub.actingapi.platform.config;

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
 * springdoc 산출물을 커밋된 {@code spec/openapi.json} 에 고정한다.
 *
 * <p><b>이 JSON 이 곧 API 계약서이고, {@code apps/web} 이 여기서 타입을 생성한다</b>
 * ({@code pnpm --filter web generate:v2-schema}). 패키지를 옮기거나 DTO 를 건드릴 때 스키마
 * 이름·형상이 조용히 바뀌면 프론트의 생성 타입이 어긋난다.
 *
 * <p>🔁 <b>웹의 타입 생성원이 여기로 넘어왔다({@code SOMA-403} 5단계).</b> 그전까지 같은
 * 경로에 있던 것은 FastAPI 가 뽑은 스펙이었고, 계약 하네스가 Java 산출물을 그것에 semantic
 * diff 로 맞대고 있었다. 하네스는 4단계에서 사라졌고 파이썬 스펙은 5단계에서 사라진다 —
 * <b>넘기기 직전에 그 대조를 한 번 실측했다: 양쪽 스펙에서 생성한 웹 타입이 키 순서를
 * 맞추면 diff 0 이었다</b>(경로 32/32 · 컴포넌트 75/75 동일, spec/M6-python-removal.md).
 *
 * <p>⚠ <b>이제 이 테스트가 보는 것은 "springdoc 산출물이 의도 없이 바뀌지 않았는가" 뿐이다.</b>
 * 대조 상대가 <b>커밋된 자기 스냅샷</b>이므로 {@code UPDATE_OPENAPI_SNAPSHOT=1} 로 다시 뜨면
 * 무엇을 바꿨든 초록이 된다. 스냅샷을 다시 뜰 때 diff 를 눈으로 보라는 아래 지시가 그래서
 * 형식이 아니다.
 *
 * <p><b>스펙이 의도적으로 바뀌었다면</b> {@code UPDATE_OPENAPI_SNAPSHOT=1 ./gradlew test
 * --tests '*OpenApiSnapshotIT*'}로 스냅샷을 다시 뜨고 <b>diff를 눈으로 확인한 뒤</b>
 * 웹 타입도 함께 재생성해 커밋한다. 갱신 모드는 일부러 실패로 끝난다 — 갱신한 채로 초록을
 * 받아 들고 가면 검사가 무력해진다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
class OpenApiSnapshotIT {

    /** 테스트의 작업 디렉토리는 {@code apps/api} 다. 웹이 {@code ../api/spec/openapi.json} 으로 읽는 그 파일. */
    private static final Path SNAPSHOT = Path.of("spec/openapi.json");

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
