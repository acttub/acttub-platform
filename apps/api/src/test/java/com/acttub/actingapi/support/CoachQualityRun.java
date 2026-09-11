package com.acttub.actingapi.support;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import com.acttub.actingapi.feature.coach.app.CoachEngine;
import com.acttub.actingapi.feature.coach.app.CoachResult;
import com.acttub.actingapi.feature.coach.app.CoachSessionSnapshot;
import com.acttub.actingapi.integration.llm.OpenAiResponsesClient;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** 실호출 기록. 계약 검사와 사람의 의미 검토를 분리하고, 재실행 결과를 덮어쓰지 않는다. */
public final class CoachQualityRun implements AutoCloseable {
    public static final ObjectMapper MAPPER = new ObjectMapper().findAndRegisterModules();
    private static final String RUN_ID = Instant.now().toString().replace(':', '-') + "-" + UUID.randomUUID();
    private final String id;
    public final ObjectNode output = MAPPER.createObjectNode();
    public final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    private final List<String> failures = new CopyOnWriteArrayList<>();
    public final FailureReporter reporter = (failure, kind, context) ->
            failures.add(kind + ":" + context.tagValue() + ":" + failure.getClass().getSimpleName());

    public CoachQualityRun(String id) {
        this.id = id;
        output.put("id", id);
        output.put("started_at", Instant.now().toString());
        output.put("contract_checks", "failed");
        output.put("semantic_review", "pending");
        output.put("commit", System.getenv("ACTTUB_COACH_EVAL_COMMIT"));
        output.putArray("calls");
        output.putArray("steps");
    }

    public TextGenerator generator(String phase) {
        TextGenerator client = new OpenAiResponsesClient(MAPPER);
        return (system, input) -> {
            ObjectNode call = output.withArray("calls").addObject();
            call.put("phase", phase);
            call.put("system", system);
            call.put("input", input);
            long started = System.nanoTime();
            try {
                var generated = client.generate(system, input);
                call.put("response", generated.text());
                call.set("usage", MAPPER.valueToTree(generated.usage()));
                return generated;
            } catch (RuntimeException failure) {
                call.put("failure_type", failure.getClass().getSimpleName());
                throw failure;
            } finally {
                call.put("elapsed_ms", (System.nanoTime() - started) / 1_000_000);
            }
        };
    }

    /** actorText=null은 운영의 start 경로. 이후에는 반환된 session을 그대로 넘긴다. */
    public CoachResult step(CoachEngine engine, CoachSessionSnapshot session, String actorText, int maxChars) {
        assertThat(session.status()).as("종료된 대화에 후속 응답을 만들지 않는다").isEqualTo("open");
        CoachResult result = actorText == null
                ? engine.start(session, UUID.randomUUID())
                : engine.reply(session, actorText, UUID.randomUUID());
        String message = result.reply().message();
        ObjectNode step = output.withArray("steps").addObject();
        step.put("entry", actorText == null ? "start" : "reply");
        step.put("actor", actorText);
        step.set("reply", MAPPER.valueToTree(result.reply()));
        step.put("message_chars", message.codePointCount(0, message.length()));
        step.put("question_marks", message.codePoints().filter(c -> c == '?' || c == '？').count());
        output.set("dialogue", MAPPER.valueToTree(result.session().turns()));
        assertThat(message).isNotBlank();
        assertThat(telemetry.scores()).as("안전 문구로 대체된 답은 품질 통과가 아니다")
                .noneMatch(score -> score.name().equals("coach.fallback_used") && Double.valueOf(1).equals(score.value()));
        if (maxChars > 0) {
            assertThat(step.path("message_chars").asInt()).as("짧은 응답의 글자 수").isLessThanOrEqualTo(maxChars);
            assertThat(step.path("question_marks").asInt()).as("질문은 한 번에 최대 하나").isLessThanOrEqualTo(1);
        }
        assertThat(failures).as("모델/파싱 오류를 별도 실패로 남긴다").isEmpty();
        // 운영에서는 저장 어댑터가 reply.status를 반영한다. 여기서는 DB 없이 같은 종료 경계를 지킨다.
        return new CoachResult(result.session().withStatus(
                "complete".equals(result.reply().status()) ? "complete" : "open"), result.reply());
    }

    public void passed() {
        assertThat(failures).isEmpty();
        output.put("contract_checks", "passed");
    }

    @Override
    public void close() throws IOException {
        output.set("failures", MAPPER.valueToTree(failures));
        output.set("telemetry_calls", MAPPER.valueToTree(telemetry.calls()));
        output.set("scores", MAPPER.valueToTree(telemetry.scores()));
        output.put("finished_at", Instant.now().toString());
        String configured = System.getenv("ACTTUB_COACH_EVAL_OUTPUT_DIR");
        Path directory = configured == null || configured.isBlank()
                ? Path.of("build", "coach-quality-eval", RUN_ID) : Path.of(configured);
        Files.createDirectories(directory);
        MAPPER.writerWithDefaultPrettyPrinter().writeValue(directory.resolve(id + ".json").toFile(), output);
    }
}
