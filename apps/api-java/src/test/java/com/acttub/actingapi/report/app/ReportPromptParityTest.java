package com.acttub.actingapi.report.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.concurrent.TimeUnit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

class ReportPromptParityTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final int TIMEOUT_SECONDS = 120;

    @Test
    @EnabledIf("pythonIsAvailable")
    void bothSystemPromptsMatchPythonSourceExactly() {
        for (String type : List.of("analysis", "expression")) {
            String constant = "analysis".equals(type)
                    ? "REPORT_ANALYSIS_PROMPT"
                    : "REPORT_EXPRESSION_PROMPT";
            String expected = readPythonValue(
                    "from acting_report.prompt import " + constant + " as value");

            assertThat(ReportPrompt.select(type)).isEqualTo(expected);
        }
    }

    @Test
    @EnabledIf("pythonIsAvailable")
    void analysisInputJsonMatchesPythonIndentationAndKorean() throws Exception {
        String expected = readPythonValue("""
                import json
                from acting_report.engine import build_report_input
                model_input = build_report_input(
                    report_type="analysis",
                    video_summary={
                        "observations":[{"start_ms":0,"end_ms":100,"label":"멈춘다","confidence":0.9,"ignored":"x"}],
                        "uncertainties":["얼굴은 안 보임"],
                        "ignored":"x",
                    },
                    confirmed_handoff={"blocked_point":"대사 의미"},
                    confirmed=True,
                    coaching_handoff_id="analysis-id",
                )
                value = json.dumps(model_input, ensure_ascii=False, indent=2)
                """);
        ReportEngine engine = new ReportEngine((instructions, input) -> null, MAPPER);
        JsonNode input = engine.buildReportInput(
                "analysis",
                MAPPER.readTree("""
                    {"observations":[{"start_ms":0,"end_ms":100,"label":"멈춘다","confidence":0.9,"ignored":"x"}],
                     "uncertainties":["얼굴은 안 보임"],"ignored":"x"}
                    """),
                MAPPER.readTree("{\"blocked_point\":\"대사 의미\"}"),
                true,
                "analysis-id",
                null);

        assertThat(engine.serializeInput(input)).isEqualTo(expected);
    }

    @Test
    @EnabledIf("pythonIsAvailable")
    void expressionInputJsonMatchesPythonFieldOrderAndNull() throws Exception {
        String expected = readPythonValue("""
                import json
                from acting_report.engine import build_report_input
                model_input = build_report_input(
                    report_type="expression",
                    video_summary={"observations":[],"uncertainties":[]},
                    confirmed_handoff={
                        "experiment":{"tested":True,"instruction":"한 번 멈춘다"},
                        "observed_change":"말이 선명해졌다",
                    },
                    confirmed=True,
                    coaching_handoff_id="expression-id",
                    analysis_handoff=None,
                )
                value = json.dumps(model_input, ensure_ascii=False, indent=2)
                """);
        ReportEngine engine = new ReportEngine((instructions, input) -> null, MAPPER);
        JsonNode handoff = MAPPER.readTree("""
                {"experiment":{"tested":true,"instruction":"한 번 멈춘다"},
                 "observed_change":"말이 선명해졌다"}
                """);
        JsonNode input = engine.buildReportInput(
                "expression",
                MAPPER.readTree("{\"observations\":[],\"uncertainties\":[]}"),
                handoff,
                true,
                "expression-id",
                null);

        assertThat(engine.serializeInput(input)).isEqualTo(expected);
    }

    private static String readPythonValue(String snippet) {
        String program = """
                import sys
                sys.path.insert(0, "acting-report/src")
                sys.path.insert(0, "acting-llm/src")
                %s
                sys.stdout.write(value)
                """.formatted(snippet);
        ProcessBuilder builder = new ProcessBuilder(pythonExecutable().toString(), "-c", program);
        builder.directory(apiRoot().toFile());
        builder.environment().put("PYTHONIOENCODING", "utf-8");
        try {
            Process process = builder.start();
            String out;
            String err;
            try (var in = process.getInputStream(); var errors = process.getErrorStream()) {
                out = new String(in.readAllBytes(), StandardCharsets.UTF_8);
                err = new String(errors.readAllBytes(), StandardCharsets.UTF_8);
            }
            if (!process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new IllegalStateException("python report prompt extraction timed out");
            }
            if (process.exitValue() != 0) {
                throw new IllegalStateException("python report prompt extraction failed\n" + err);
            }
            return out;
        } catch (IOException exception) {
            throw new IllegalStateException("failed to run python", exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while extracting report prompt", exception);
        }
    }

    static boolean pythonIsAvailable() {
        boolean present = Files.isExecutable(pythonExecutable());
        if (!present && "1".equals(System.getenv("REQUIRE_ALEMBIC_CHECK"))) {
            throw new IllegalStateException("REQUIRE_ALEMBIC_CHECK=1 인데 apps/api 의 venv 가 없다");
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
