package com.acttub.actingapi.feature.reading.app;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.feature.reading.domain.ScriptSplitRules;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.GenerationOptions;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.schema.ScriptImportFailure;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * 실험용 재생 하네스(SOMA-663). 운영 나누기 경로({@link ScriptSplitWorker} → {@code SplitDraft.assemble})를 그대로 돌리되 모델 호출만
 * 「캐시 → 없으면 Codex 구독의 gpt-6-luna」로 바꾼다. 캐시 키가 모델·effort·지시문·입력 전체라, 조립 코드만 고친 판은 같은 캐시로 모델
 * 호출 없이 재생된다. 명시적으로 켤 때만 돈다 — CI 에서는 돌지 않는다.
 *
 * <p>환경변수: {@code ACTTUB_REPLAY_INPUT}(NNN.txt 폴더), {@code ACTTUB_REPLAY_CURRENT}(같은 index 의 운영 결과 NNN.json 폴더 —
 * index·id8·split·file·stage 를 옮겨 적는다), {@code ACTTUB_REPLAY_OUT}, {@code ACTTUB_REPLAY_CACHE}, {@code ACTTUB_REPLAY_RUN},
 * {@code ACTTUB_REPLAY_ONLY}(쉼표로 index, 없으면 전부), {@code ACTTUB_REPLAY_CODEX}(동시 codex 상한, 기본 8),
 * {@code ACTTUB_REPLAY_SCRIPTS}(동시 대본 수, 기본 2). 결과는 {@code $OUT/$RUN/NNN.json}, 진행은 {@code $OUT/$RUN.log}.
 */
@EnabledIfEnvironmentVariable(named = "ACTTUB_SPLIT_REPLAY", matches = "1")
class ScriptSplitReplayTest {
    private static final ObjectMapper JSON = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
    private static final Path INPUT = Path.of(env("ACTTUB_REPLAY_INPUT"));
    private static final Path CURRENT = Path.of(env("ACTTUB_REPLAY_CURRENT"));
    private static final Path CACHE = Path.of(env("ACTTUB_REPLAY_CACHE"));
    private static final Path OUT = Path.of(env("ACTTUB_REPLAY_OUT"));
    private static final String RUN = env("ACTTUB_REPLAY_RUN");
    private static final String MODEL = "gpt-6-luna";
    private static final int CODEX_LIMIT = Integer.parseInt(env("ACTTUB_REPLAY_CODEX").isBlank() ? "8" : env("ACTTUB_REPLAY_CODEX"));
    private static final int SCRIPTS_AT_ONCE = Integer.parseInt(env("ACTTUB_REPLAY_SCRIPTS").isBlank() ? "2" : env("ACTTUB_REPLAY_SCRIPTS"));
    // 운영 호출 대기(90초)보다 넉넉히 — Codex 는 에이전트 프롬프트가 붙어 느리다. 걸리면 실패로 보고 워커가 다시 시도한다.
    private static final Duration CODEX_TIMEOUT = Duration.ofMinutes(10);
    private static final Pattern QUOTA = Pattern.compile("usage limit|rate limit|quota|429|too many requests", Pattern.CASE_INSENSITIVE);

    private static final Semaphore CODEX = new Semaphore(CODEX_LIMIT);
    private static final AtomicBoolean STOPPED = new AtomicBoolean();

    private static String env(String name) {
        String value = System.getenv(name);
        return value == null ? "" : value;
    }

    @Test
    void replaysEveryScript() throws Exception {
        Files.createDirectories(CACHE);
        Path runDir = Files.createDirectories(OUT.resolve(RUN));
        Path log = OUT.resolve(RUN + ".log");
        List<Integer> only = env("ACTTUB_REPLAY_ONLY").isBlank() ? null
                : Arrays.stream(env("ACTTUB_REPLAY_ONLY").split(",")).map(String::strip).map(Integer::valueOf).toList();
        List<Path> inputs;
        try (Stream<Path> files = Files.list(INPUT)) {
            inputs = files.filter(p -> p.getFileName().toString().endsWith(".txt")).sorted()
                    .filter(p -> only == null || only.contains(index(p))).toList();
        }
        try (ExecutorService scripts = Executors.newFixedThreadPool(SCRIPTS_AT_ONCE)) {
            List<Future<?>> futures = new ArrayList<>();
            for (Path input : inputs) {
                futures.add(scripts.submit(() -> {
                    if (STOPPED.get()) return null;
                    String line;
                    try {
                        line = replay(input, runDir);
                    } catch (Exception broken) {
                        line = input.getFileName() + " ERROR " + broken;
                    }
                    synchronized (ScriptSplitReplayTest.class) {
                        Files.writeString(log, Instant.now() + " " + line + "\n", StandardCharsets.UTF_8,
                                java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
                    }
                    return null;
                }));
            }
            for (Future<?> future : futures) future.get();
        }
        if (STOPPED.get()) throw new IllegalStateException("Codex 사용량 한도로 멈췄다 — " + log);
    }

    private static int index(Path input) {
        String name = input.getFileName().toString();
        return Integer.parseInt(name.substring(0, name.indexOf('.')));
    }

    private static String replay(Path input, Path runDir) throws IOException {
        String stem = input.getFileName().toString().replace(".txt", "");
        ReplayGenerator generator = new ReplayGenerator(Thread.currentThread());
        FakeImports imports = new FakeImports(Files.readString(input));
        RecordingFailureReporter failures = new RecordingFailureReporter();
        ScriptSplitWorker worker = new ScriptSplitWorker(new FakeLedger(), imports, generator, new RecordingLlmTelemetry(), failures,
                Clock.systemUTC());
        long started = System.nanoTime();
        worker.runOnce();
        long wallMs = (System.nanoTime() - started) / 1_000_000;

        ObjectNode out = JSON.createObjectNode();
        Path current = CURRENT.resolve(stem + ".json");
        if (Files.exists(current)) {
            JsonNode known = JSON.readTree(current.toFile());
            for (String field : List.of("index", "id8", "split", "file", "stage")) out.set(field, known.get(field));
        } else {
            out.put("index", index(input));
        }
        out.put("failure", imports.failure == null ? null : imports.failure.name().toLowerCase());
        if (!failures.reports().isEmpty()) {
            out.set("reports", JSON.valueToTree(failures.reports().stream()
                    .map(r -> r.context() + ": " + r.failure().getClass().getSimpleName() + ": " + r.failure().getMessage()).toList()));
        }
        ScriptDraft draft = imports.saved;
        Map<String, Integer> bySpeaker = new LinkedHashMap<>();
        List<List<String>> lines = new ArrayList<>();
        if (draft != null) {
            for (ScriptDraft.Line line : draft.lines()) {
                String speaker = line.characterIndex() == null ? "" : draft.characterNames().get(line.characterIndex());
                lines.add(List.of(line.kind(), speaker, line.text()));
                if (line.kind().equals("dialogue")) bySpeaker.merge(speaker, 1, Integer::sum);
            }
        }
        out.put("title", draft == null ? null : draft.title());
        out.set("characters", JSON.valueToTree(draft == null ? List.of() : draft.characterNames()));
        out.set("dialogueBySpeaker", JSON.valueToTree(bySpeaker));
        out.set("lines", JSON.valueToTree(lines));
        out.set("traits", JSON.valueToTree(draft == null ? List.of() : draft.characterTraits()));
        out.put("rawLines", imports.rawText.split("\n", -1).length);
        out.put("wallMs", wallMs);
        out.put("calls", generator.calls);
        out.put("cacheHits", generator.cacheHits);
        out.put("codexMsCritical", generator.criticalMs());
        out.put("outputTokens", generator.outputTokens);
        Files.writeString(runDir.resolve(stem + ".json"), JSON.writeValueAsString(out));
        return stem + " failure=" + out.get("failure").asText() + " characters=" + out.get("characters").size()
                + " calls=" + generator.calls + " hits=" + generator.cacheHits + " wallMs=" + wallMs;
    }

    /**
     * 대본 하나의 모델 호출. 답은 전역 캐시에서 찾고, 없으면 Codex 를 부른다. 단계 구분은 스레드로 한다 — 워커는 단계마다 새 스레드 풀을
     * 열고(이름 {@code pool-N-thread-M}), 첫 호출·배역 목록 호출은 대본 스레드에서 부른다. 단계 안에서 어느 스레드가 어느 조각을
     * 맡았는지는 그때그때 달라, 시간 어림은 조각 순서대로 다시 배정해 계산한다(재생해도 같은 값).
     */
    private static final class ReplayGenerator implements TextGenerator {
        private final Thread scriptThread;
        private final Map<String, List<long[]>> stages = new LinkedHashMap<>(); // 단계 → {첫 줄 번호, ms}
        int calls;
        int cacheHits;
        long outputTokens;

        ReplayGenerator(Thread scriptThread) {
            this.scriptThread = scriptThread;
        }

        @Override
        public GeneratedText generate(String instructions, String input) {
            throw new UnsupportedOperationException();
        }

        @Override
        public GeneratedText generate(String instructions, String input, GenerationOptions options) {
            String prompt = instructions + "\n\n" + input;
            Path cached = CACHE.resolve(sha256(MODEL + options.reasoningEffort() + prompt) + ".json");
            try {
                boolean hit = Files.exists(cached);
                JsonNode answer = hit ? JSON.readTree(cached.toFile()) : callCodex(prompt, options.reasoningEffort(), cached);
                JsonNode usage = answer.path("usage");
                synchronized (this) {
                    calls++;
                    if (hit) cacheHits++;
                    outputTokens += usage.path("output_tokens").asLong();
                    Thread thread = Thread.currentThread();
                    String stage = thread == scriptThread ? "script#" + stages.size()
                            : thread.getName().replaceAll("-thread-\\d+$", "");
                    stages.computeIfAbsent(stage, k -> new ArrayList<>()).add(new long[] {firstLine(input), answer.path("ms").asLong()});
                }
                return new GeneratedText(answer.path("text").asText(), new TokenUsage(usage.path("input_tokens").asInt(),
                        usage.path("output_tokens").asInt(), usage.path("input_tokens").asInt() + usage.path("output_tokens").asInt()), MODEL);
            } catch (IOException failure) {
                throw new IllegalStateException(failure);
            }
        }

        /** 단계 안에서는 조각 순서대로 먼저 빈 자리({@link ScriptSplitRules#PARALLEL_CALLS} 개)에 맡긴 끝 시각, 단계끼리는 합 — 운영 벽시계 어림. */
        synchronized long criticalMs() {
            long total = 0;
            for (List<long[]> calls : stages.values()) {
                long[] slots = new long[Math.min(calls.size(), ScriptSplitRules.PARALLEL_CALLS)];
                calls.stream().sorted(java.util.Comparator.comparingLong(call -> call[0])).forEach(call -> {
                    int free = 0;
                    for (int i = 1; i < slots.length; i++) if (slots[i] < slots[free]) free = i;
                    slots[free] += call[1];
                });
                total += Arrays.stream(slots).max().orElse(0);
            }
            return total;
        }

        private static long firstLine(String input) {
            int end = 0;
            while (end < input.length() && Character.isDigit(input.charAt(end))) end++;
            return end == 0 ? 0 : Long.parseLong(input.substring(0, end));
        }
    }

    private static JsonNode callCodex(String prompt, String effort, Path cached) throws IOException {
        if (STOPPED.get()) throw new IllegalStateException("stopped: usage limit");
        Path work = Files.createTempDirectory("codex-replay");
        Path answerFile = work.resolve("answer.txt");
        Path events = work.resolve("events.jsonl");
        Path errors = work.resolve("stderr.txt");
        Path empty = Files.createDirectories(work.resolve("empty"));
        ProcessBuilder builder = new ProcessBuilder("codex", "exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only",
                "-C", empty.toString(), "-m", MODEL, "-c", "model_reasoning_effort=" + effort, "--json", "-o", answerFile.toString(), "-")
                .directory(empty.toFile()).redirectOutput(events.toFile()).redirectError(errors.toFile());
        builder.environment().remove("OPENAI_API_KEY");
        builder.environment().remove("ANTHROPIC_API_KEY");
        CODEX.acquireUninterruptibly();
        try {
            long started = System.nanoTime();
            Process process = builder.start();
            try (var stdin = process.getOutputStream()) {
                stdin.write(prompt.getBytes(StandardCharsets.UTF_8));
            }
            boolean finished = process.waitFor(CODEX_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
            long ms = (System.nanoTime() - started) / 1_000_000;
            if (!finished) {
                process.destroyForcibly();
                throw new IllegalStateException("codex timed out after " + ms + "ms");
            }
            String eventText = Files.readString(events);
            if (process.exitValue() != 0 || !Files.exists(answerFile)) {
                String detail = Files.readString(errors) + "\n" + eventText;
                if (QUOTA.matcher(detail).find()) STOPPED.set(true);
                throw new IllegalStateException("codex exit " + process.exitValue() + ": " + tail(detail));
            }
            JsonNode usage = JSON.createObjectNode();
            for (String line : eventText.split("\n")) {
                if (line.contains("\"turn.completed\"")) usage = JSON.readTree(line).path("usage");
            }
            ObjectNode entry = JSON.createObjectNode();
            entry.put("model", MODEL);
            entry.put("effort", effort);
            entry.put("text", Files.readString(answerFile));
            entry.put("ms", ms);
            entry.set("usage", usage);
            Path temp = cached.resolveSibling(cached.getFileName() + "." + UUID.randomUUID() + ".tmp");
            Files.writeString(temp, JSON.writeValueAsString(entry));
            Files.move(temp, cached, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            return entry;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        } finally {
            CODEX.release();
            try (Stream<Path> files = Files.walk(work)) {
                files.sorted(java.util.Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
            }
        }
    }

    private static String tail(String text) {
        String stripped = text.strip();
        return stripped.length() <= 600 ? stripped : stripped.substring(stripped.length() - 600);
    }

    private static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    /** 작업 하나짜리 장부. */
    private static final class FakeLedger implements AiJobLedger {
        private final Deque<UUID> pending = new ArrayDeque<>(List.of(UUID.randomUUID()));
        private int attempts;

        @Override public Claimed claimNext(String kind, UUID leaseToken, Duration lease, Instant now, boolean reclaimExpired) {
            UUID id = pending.poll();
            return id == null ? null : new Claimed(id, FakeImports.USER, FakeImports.IMPORT, ++attempts, null);
        }

        @Override public boolean succeed(UUID jobId, UUID leaseToken, Instant now) { return true; }
        @Override public boolean fail(UUID jobId, UUID leaseToken, String reason, Instant now) { return true; }
        @Override public void release(UUID jobId, UUID leaseToken, String reason, Instant now) { }
        @Override public int sweepMaxAttempts(Instant now) { return 0; }
        @Override public List<UUID> failExpired(String kind, Instant now) { return List.of(); }
    }

    /** 요청 하나짜리 저장소 — 조립된 대본과 실패 이유만 받아 둔다. */
    private static final class FakeImports implements ScriptImportRepository {
        static final UUID USER = UUID.randomUUID();
        static final UUID IMPORT = UUID.randomUUID();
        private final String rawText;
        ScriptDraft saved;
        ScriptImportFailure failure;

        FakeImports(String rawText) { this.rawText = rawText; }

        @Override public String consent(UUID userId) { return "granted"; }
        @Override public Requested request(UUID userId, UUID requestId, String fingerprint, Submission submission, ScriptDraft sample,
                int scriptLimit, int dailyLimit, Instant now) { throw new UnsupportedOperationException(); }
        @Override public ImportView find(UUID userId, UUID importId) { throw new UnsupportedOperationException(); }
        @Override public Material material(UUID jobId, UUID importId) {
            return new Material(USER, false, UUID.randomUUID(), "f".repeat(64), null, rawText, "paste", false);
        }
        @Override public void progress(UUID importId, int doneLines, int totalLines) { }
        @Override public Completion complete(UUID jobId, UUID leaseToken, UUID importId, ScriptDraft draft, Instant now) {
            saved = draft;
            return Completion.SAVED;
        }
        @Override public void fail(UUID jobId, UUID leaseToken, UUID importId, ScriptImportFailure failure, boolean keepFile, Instant now) { this.failure = failure; }
        @Override public int sweepExpired(Instant now) { return 0; }
    }
}
