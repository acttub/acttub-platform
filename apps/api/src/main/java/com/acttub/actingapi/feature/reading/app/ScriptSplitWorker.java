package com.acttub.actingapi.feature.reading.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.feature.reading.app.ScriptImportRepository.Material;
import com.acttub.actingapi.feature.reading.domain.NumberedLine;
import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.feature.reading.domain.ScriptRules;
import com.acttub.actingapi.feature.reading.domain.ScriptSplitRules;
import com.acttub.actingapi.feature.reading.domain.SplitDraft;
import com.acttub.actingapi.feature.reading.domain.SplitResponse;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.GenerationOptions;
import com.acttub.actingapi.integration.llm.OpenAiStatusException;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.platform.observability.LlmTokens;
import com.acttub.actingapi.platform.schema.AiJobKind;
import com.acttub.actingapi.platform.schema.ScriptImportFailure;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 대본 글을 뒤에서 배역·대사로 나눠 저장한다 ({@code ai_jobs} 종류 {@code script_split}, reading.script 「나누기 작업」,
 * SOMA-593 7-2).
 *
 * <p>줄 번호를 붙인 원문을 150줄 조각으로 동시에 보내고, 조각이 둘 이상이면 앞 400줄로 배역 목록을 먼저 받는다. 첫 호출의
 * 첫 줄이 「대본이 아니다」면 거기서 멈춘다. 버리거나 빠진 줄은 두 번까지 다시 묻고 그래도 남으면 지문이다. 호출 하나는
 * 연결 실패·붐빔·서버 실패·미완료 답에 두 번까지 다시 시도하고, 그래도 안 되면 작업은 {@code failed} 로 끝난다 — 기기 파서
 * 대비 경로는 두지 않기로 했다(계획 「정한 것」 1). 사용자가 팝업에서 기다리므로 작업을 다시 큐에 넣지 않는다.
 */
public class ScriptSplitWorker {
    private static final Logger LOG = LoggerFactory.getLogger(ScriptSplitWorker.class);
    static final String KIND = AiJobKind.SCRIPT_SPLIT.dbValue();
    /**
     * 선점 lease. 최악 경로는 호출마다 3시도×(90초+대기 3초) ≈ 4.7분이 배역 목록 1번 + 조각 두 묶음(한도 16개씩, 4,256줄은
     * 29조각) + 빠진 줄 재요청 2판 = 다섯 번 이어지는 약 24분이다. 보통은 1분 안에 끝난다(68편 최대 36초). lease 가 지나면
     * 다른 워커가 다시 집고, 완료는 요청의 request_id 로 멱등이라 두 번 돌아도 대본은 하나다.
     */
    static final Duration LEASE = Duration.ofMinutes(30);
    /** 나누기 호출의 응답 대기. 실측 전체 벽시계 최대 57초(조각 동시)보다 조각 하나는 짧다. */
    static final Duration CALL_TIMEOUT = Duration.ofSeconds(90);
    private static final GenerationOptions OPTIONS = new GenerationOptions(ScriptSplitRules.MODEL,
            ScriptSplitRules.REASONING_EFFORT, ScriptSplitRules.MAX_OUTPUT_TOKENS, null, null, CALL_TIMEOUT);

    private final AiJobLedger ledger;
    private final ScriptImportRepository imports;
    private final TextGenerator generator;
    private final LlmTelemetry telemetry;
    private final FailureReporter failures;
    private final Clock clock;

    public ScriptSplitWorker(AiJobLedger ledger, ScriptImportRepository imports, TextGenerator generator,
            LlmTelemetry telemetry, FailureReporter failures, Clock clock) {
        this.ledger = ledger;
        this.imports = imports;
        this.generator = generator;
        this.telemetry = telemetry;
        this.failures = failures;
        this.clock = clock;
    }

    public boolean runOnce() {
        return runOnce(clock.instant());
    }

    /** 큐에서 하나 집어 처리한다. 집을 게 없으면 거짓. */
    public boolean runOnce(Instant now) {
        UUID token = UUID.randomUUID();
        AiJobLedger.Claimed claimed = ledger.claimNext(KIND, token, LEASE, now, true);
        if (claimed == null) {
            return false;
        }
        UUID importId = claimed.targetId();
        try {
            Material material = imports.material(claimed.id(), importId);
            if (material == null) {
                // 요청이 이미 끝났거나 계정이 닫혔다 — 나눌 것이 없다.
                ledger.fail(claimed.id(), token, "cancelled", now);
                return true;
            }
            Split split = split(claimed.id(), importId, material);
            if (split.failure() != null) {
                imports.fail(claimed.id(), token, importId, split.failure(), clock.instant());
                return true;
            }
            switch (imports.complete(claimed.id(), token, importId, split.draft(), clock.instant())) {
                case SCRIPT_LIMIT -> imports.fail(claimed.id(), token, importId, ScriptImportFailure.SCRIPT_LIMIT, clock.instant());
                // 같은 request_id 로 다른 대본을 이미 저장해 둔 기기다 — 저장할 수 없으니 실패로 닫는다.
                case FINGERPRINT_MISMATCH -> imports.fail(claimed.id(), token, importId, ScriptImportFailure.FAILED, clock.instant());
                case SAVED, CANCELLED -> { }
            }
        } catch (LeaseOwnershipException lost) {
            failures.report(lost, new FailureContext("ScriptSplitWorker.complete", claimed.id()));
        } catch (RuntimeException failure) {
            // 모델 호출의 실패와 쓸 수 없는 답은 바깥 의존의 실패다.
            failures.report(failure, FailureKind.EXTERNAL, new FailureContext("ScriptSplitWorker.run", claimed.id()));
            try {
                imports.fail(claimed.id(), token, importId, ScriptImportFailure.FAILED, clock.instant());
            } catch (LeaseOwnershipException lostWhileFailing) {
                failures.report(lostWhileFailing, new FailureContext("ScriptSplitWorker.release", claimed.id()));
            }
        }
        return true;
    }

    /** 집은 워커가 죽은 뒤 lease 와 시도 수를 다 쓴 작업을 실패로 닫는다. 스케줄러가 돌 때마다 부른다. */
    public int sweep() {
        return imports.sweepExpired(clock.instant());
    }

    private record Split(ScriptDraft draft, ScriptImportFailure failure) {
        static Split of(ScriptDraft draft) {
            return new Split(draft, null);
        }

        static Split failed(ScriptImportFailure failure) {
            return new Split(null, failure);
        }
    }

    private Split split(UUID jobId, UUID importId, Material material) {
        Calls calls = new Calls(jobId, material.userId());
        List<NumberedLine> lines = NumberedLine.of(material.rawText());
        imports.progress(importId, 0, lines.size());
        List<List<NumberedLine>> chunks = NumberedLine.chunks(lines, ScriptSplitRules.CHUNK_LINES);
        Map<Integer, SplitResponse.Row> rows = new ConcurrentHashMap<>();
        List<String> roster = List.of();
        AtomicInteger done = new AtomicInteger();
        boolean judge = !material.skipScriptCheck();
        if (chunks.size() == 1) {
            SplitResponse first = SplitResponse.parse(calls.ask(ScriptSplitPrompt.split(judge, roster), chunks.getFirst()), chunks.getFirst());
            if (judge && first.notScript()) {
                return Split.failed(ScriptImportFailure.NOT_SCRIPT);
            }
            rows.putAll(first.rows());
            imports.progress(importId, lines.size(), lines.size());
        } else {
            List<NumberedLine> head = lines.subList(0, Math.min(lines.size(), ScriptSplitRules.ROSTER_LINES));
            String answer = calls.ask(ScriptSplitPrompt.roster(judge), head);
            if (judge && SplitResponse.parse(answer, List.of()).notScript()) {
                return Split.failed(ScriptImportFailure.NOT_SCRIPT);
            }
            roster = SplitResponse.roster(answer);
            String instructions = ScriptSplitPrompt.split(false, roster);
            inParallel(chunks, chunk -> {
                rows.putAll(SplitResponse.parse(calls.ask(instructions, chunk), chunk).rows());
                imports.progress(importId, done.addAndGet(chunk.size()), lines.size());
            });
        }
        String instructions = ScriptSplitPrompt.split(false, roster);
        for (int round = 0; round < ScriptSplitRules.MISSING_ROUNDS; round++) {
            List<NumberedLine> missing = lines.stream().filter(line -> !rows.containsKey(line.no())).toList();
            if (missing.isEmpty()) {
                break;
            }
            inParallel(NumberedLine.chunks(missing, ScriptSplitRules.CHUNK_LINES),
                    group -> rows.putAll(SplitResponse.parse(calls.ask(instructions, group), group).rows()));
        }
        ScriptDraft draft = SplitDraft.assemble(material.title(), material.rawText(), material.source(), lines, rows, roster);
        ScriptRules.Rejection rejection = ScriptRules.check(draft);
        if (rejection == null) {
            return Split.of(draft);
        }
        return Split.failed(switch (rejection) {
            case NO_CHARACTERS -> ScriptImportFailure.NO_CHARACTERS;
            case TOO_LONG -> ScriptImportFailure.SCRIPT_TOO_LONG;
            case INVALID_CHARACTERS -> ScriptImportFailure.FAILED;
        });
    }

    private interface ChunkTask {
        void run(List<NumberedLine> chunk);
    }

    /** 조각을 동시에 보낸다(한 번에 {@link ScriptSplitRules#PARALLEL_CALLS} 개까지). 하나라도 끝내 실패하면 작업 전체가 실패다. */
    private static void inParallel(List<List<NumberedLine>> chunks, ChunkTask task) {
        try (ExecutorService executor = Executors.newFixedThreadPool(Math.max(1, Math.min(chunks.size(), ScriptSplitRules.PARALLEL_CALLS)))) {
            List<Future<?>> futures = new ArrayList<>();
            for (List<NumberedLine> chunk : chunks) {
                futures.add(executor.submit(() -> task.run(chunk)));
            }
            for (Future<?> future : futures) {
                try {
                    future.get();
                } catch (ExecutionException failed) {
                    if (failed.getCause() instanceof RuntimeException runtime) {
                        throw runtime;
                    }
                    throw new IllegalStateException(failed.getCause());
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("script split was interrupted", interrupted);
                }
            }
        }
    }

    /** 한 작업의 모델 호출 — 재시도와 기록을 안다. */
    private final class Calls {
        private final UUID jobId;
        private final UUID userId;

        Calls(UUID jobId, UUID userId) {
            this.jobId = jobId;
            this.userId = userId;
        }

        String ask(String instructions, List<NumberedLine> chunk) {
            String input = NumberedLine.format(chunk);
            RuntimeException last = null;
            for (int attempt = 0; attempt <= ScriptSplitRules.CALL_RETRIES; attempt++) {
                if (attempt > 0) {
                    pause(Duration.ofSeconds(1L << (attempt - 1)));
                }
                Instant startedAt = clock.instant();
                try {
                    GeneratedText generated = generator.generate(instructions, input, OPTIONS);
                    record(instructions, input, generated, startedAt, null);
                    return generated.text();
                } catch (RuntimeException failure) {
                    record(instructions, input, null, startedAt, failure);
                    if (!retryable(failure)) {
                        throw failure;
                    }
                    last = failure;
                }
            }
            throw last;
        }

        /** 비용·속도를 셀 수 있게 호출마다 로그 한 줄 — 로그에는 글을 남기지 않는다(관측 기록에는 원문이 그대로 실린다). */
        private void record(String instructions, String input, GeneratedText generated, Instant startedAt, RuntimeException failure) {
            Duration took = Duration.between(startedAt, clock.instant());
            LOG.info("script split call job={} model={} input_tokens={} output_tokens={} took_ms={} error={}", jobId,
                    generated == null ? ScriptSplitRules.MODEL : generated.model(),
                    generated == null || generated.usage() == null ? "-" : generated.usage().prompt(),
                    generated == null || generated.usage() == null ? "-" : generated.usage().completion(),
                    took.toMillis(), failure == null ? "-" : failure.getClass().getSimpleName());
            telemetry.record(new LlmCall(
                    LlmStep.SCRIPT_SPLIT,
                    jobId,
                    userId,
                    generated == null ? ScriptSplitRules.MODEL : generated.model(),
                    instructions + "\n\n" + input,
                    generated == null ? "" : generated.text(),
                    generated == null || generated.usage() == null ? LlmTokens.unknown() : LlmTokens.of(
                            generated.usage().prompt(), generated.usage().completion(), generated.usage().total()),
                    startedAt,
                    took,
                    failure == null ? null : failure.getClass().getSimpleName(),
                    LlmCall.metadata("operation_id", jobId.toString())));
        }
    }

    /** 연결 실패·붐빔·서버 실패·미완료나 빈 답은 다시 보낸다. 우리가 잘못 보낸 것(다른 4xx)은 바로 실패다. */
    private static boolean retryable(RuntimeException failure) {
        if (failure instanceof OpenAiStatusException status) {
            return status.retryable();
        }
        return true;
    }

    private static void pause(Duration duration) {
        try {
            Thread.sleep(duration);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("script split retry was interrupted", interrupted);
        }
    }
}
