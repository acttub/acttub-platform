package com.acttub.actingapi.admin;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.admin.app.AdminMetrics.AdminCloseReasonCount;
import com.acttub.actingapi.admin.app.AdminMetrics.AdminFunnelStep;
import com.acttub.actingapi.admin.app.AdminMetrics.AdminStats;
import com.fasterxml.jackson.databind.BeanDescription;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

/** 관리자 응답 모델이 커밋 fixture가 아니라 Python 정본을 직접 따라가는지 검사한다. */
class AdminSchemaParityTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    @EnabledIf("pythonIsAvailable")
    void statsAndNestedModelsHaveExactlyThePythonFieldsInOrder() {
        assertFields("AdminStats", AdminStats.class);
        assertFields("AdminFunnelStep", AdminFunnelStep.class);
        assertFields("AdminCloseReasonCount", AdminCloseReasonCount.class);
    }

    private static void assertFields(String pythonClass, Class<?> javaClass) {
        BeanDescription description = MAPPER.getSerializationConfig()
                .introspect(MAPPER.constructType(javaClass));
        List<String> actual = description.findProperties().stream()
                .map(property -> property.getName())
                .toList();
        assertThat(actual).as(pythonClass).containsExactlyElementsOf(readPythonFields(pythonClass));
    }

    private static List<String> readPythonFields(String className) {
        String program = """
                import ast, pathlib, sys
                tree = ast.parse(pathlib.Path('acting-api/src/acting_api/admin.py').read_text())
                model = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == %s)
                fields = [n.target.id for n in model.body
                          if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)]
                sys.stdout.write('\\n'.join(fields))
                """.formatted(pythonLiteral(className));
        ProcessBuilder builder = new ProcessBuilder(pythonExecutable().toString(), "-c", program);
        builder.directory(apiRoot().toFile());
        try {
            Process process = builder.start();
            String out = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            String err = new String(process.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
            if (!process.waitFor(30, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new IllegalStateException("python admin model extraction timed out");
            }
            if (process.exitValue() != 0) {
                throw new IllegalStateException("python admin model extraction failed: " + err);
            }
            return out.lines().toList();
        } catch (IOException exception) {
            throw new IllegalStateException("failed to run python", exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while extracting admin fields", exception);
        }
    }

    private static String pythonLiteral(String value) {
        return "'" + value.replace("'", "\\'") + "'";
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
