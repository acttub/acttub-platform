package com.acttub.actingapi.summary;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

/**
 * 프롬프트가 파이썬 원본과 <b>한 글자도 다르지 않은지</b> 확인한다.
 *
 * <p>M4 의 성패는 코드량이 아니라 "생성 요청이 Python 과 동일한가" 이고, 이 층에서 가장
 * 큰 것이 프롬프트 문자열이다. 공백·줄바꿈·조사 하나가 달라도 같은 영상에서 다른 관찰이
 * 나오는데, <b>그 차이는 어떤 스키마 검증으로도 잡히지 않는다.</b>
 *
 * <p>기대값을 커밋된 fixture 에 두지 않는다 — `/SPEC.md` §5-5 가 지적한 것과 같은 함정이다.
 * fixture 와 Java 상수가 <b>둘 다 낡아도 초록</b>이 되기 때문이다. 그래서 실행 시점에
 * <b>파이썬 소스에서 직접</b> 값을 읽어 대조한다. `FlywayBaselineTest` 가 alembic 을 실제로
 * 돌려 fingerprint 를 뽑는 것과 같은 이유다.
 *
 * <p>uv 가 없으면 건너뛴다. CI 는 `REQUIRE_ALEMBIC_CHECK=1` 로 건너뛰기를 금지한다 —
 * 그 잡이 이미 파이썬 워크스페이스를 설치한다.
 */
class PromptParityTest {

    private static final int TIMEOUT_SECONDS = 120;

    @Test
    @EnabledIf("pythonIsAvailable")
    @DisplayName("OBSERVATION_SYSTEM_PROMPT 가 파이썬 원본과 완전히 같다")
    void systemPromptMatchesPythonSource() {
        String expected = readPythonValue(
                "from acting_summary.prompt import OBSERVATION_SYSTEM_PROMPT as value");

        assertThat(ObservationPrompt.SYSTEM)
                .as("시스템 프롬프트가 파이썬과 다르다 — 공백·줄바꿈·조사까지 같아야 한다")
                .isEqualTo(expected);
    }

    @Test
    @EnabledIf("pythonIsAvailable")
    @DisplayName("buildObservationPrompt 출력이 파이썬 원본과 완전히 같다")
    void observationPromptMatchesPythonSource() {
        // 분기가 blockage_kind 로 갈리므로 세 갈래를 전부 본다.
        for (String kind : new String[] {"분석", "표현", "그 외"}) {
            String expected = readPythonValue("""
                    from acting_summary.prompt import buildObservationPrompt
                    from acting_summary.schema import ActorMaterial
                    value = buildObservationPrompt(ActorMaterial(
                        situation="연습실에서 혼자 대사를 반복한다",
                        character="오디션을 앞둔 지원자",
                        goal="담담해 보이려 한다",
                        blockage_kind="%s",
                        blockage_detail="자꾸 빨라진다",
                        duration_ms=93000,
                    ))
                    """.formatted(kind));

            ActorMaterial material = new ActorMaterial(
                    "연습실에서 혼자 대사를 반복한다",
                    "오디션을 앞둔 지원자",
                    "담담해 보이려 한다",
                    kind,
                    "자꾸 빨라진다",
                    93000L);

            assertThat(ObservationPrompt.build(material))
                    .as("blockage_kind=%s 의 프롬프트가 파이썬과 다르다", kind)
                    .isEqualTo(expected);
        }
    }

    /** 파이썬 스니펫을 돌려 `value` 변수의 내용을 그대로 받아온다. */
    private static String readPythonValue(String snippet) {
        Path python = pythonExecutable();
        // stdout 에 다른 것이 섞이지 않도록 값만 write 한다(print 는 개행을 덧붙인다).
        String program = """
                import sys
                sys.path.insert(0, "acting-summary/src")
                %s
                sys.stdout.write(value)
                """.formatted(snippet);

        ProcessBuilder builder = new ProcessBuilder(python.toString(), "-c", program);
        builder.directory(apiRoot().toFile());
        builder.environment().put("PYTHONIOENCODING", "utf-8");

        try {
            Process process = builder.start();
            String out;
            String err;
            try (var in = process.getInputStream(); var errStream = process.getErrorStream()) {
                out = new String(in.readAllBytes(), StandardCharsets.UTF_8);
                err = new String(errStream.readAllBytes(), StandardCharsets.UTF_8);
            }
            if (!process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new IllegalStateException("python prompt extraction timed out");
            }
            if (process.exitValue() != 0) {
                throw new IllegalStateException(
                        "python prompt extraction failed (exit " + process.exitValue() + ")\n" + err);
            }
            return out;
        } catch (IOException exc) {
            throw new IllegalStateException("failed to run python", exc);
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while extracting the prompt", exc);
        }
    }

    static boolean pythonIsAvailable() {
        boolean present = Files.isExecutable(pythonExecutable());
        if (!present && "1".equals(System.getenv("REQUIRE_ALEMBIC_CHECK"))) {
            throw new IllegalStateException(
                    "REQUIRE_ALEMBIC_CHECK=1 인데 apps/api 의 venv 가 없다 — `uv sync` 를 먼저 돌린다");
        }
        return present;
    }

    private static Path pythonExecutable() {
        return apiRoot().resolve(".venv/bin/python");
    }

    private static Path apiRoot() {
        return Paths.get("..", "api").toAbsolutePath().normalize();
    }
}
