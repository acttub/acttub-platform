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

import com.acttub.actingapi.feature.reading.adapter.decision.OpenRouterLineDecider;
import com.acttub.actingapi.feature.reading.domain.LineReview;
import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.feature.reading.domain.ScriptSplitRules;
import com.acttub.actingapi.feature.reading.domain.SpeakerMerge;
import com.acttub.actingapi.feature.reading.domain.SplitDraft;
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
 * {@code ACTTUB_REPLAY_SCRIPTS}(동시 대본 수, 기본 2), {@code ACTTUB_REPLAY_SALT}(나누기 캐시 키 소금, 없으면 기존 키). 결과는 {@code $OUT/$RUN/NNN.json}, 진행은 {@code $OUT/$RUN.log}.
 */
@EnabledIfEnvironmentVariable(named = "ACTTUB_SPLIT_REPLAY", matches = "1")
class ScriptSplitReplayTest {
    private static final ObjectMapper JSON = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
    private static final Path INPUT = Path.of(env("ACTTUB_REPLAY_INPUT"));
    private static final Path CURRENT = Path.of(env("ACTTUB_REPLAY_CURRENT"));
    private static final Path CACHE = Path.of(env("ACTTUB_REPLAY_CACHE"));
    private static final Path OUT = Path.of(env("ACTTUB_REPLAY_OUT"));
    private static final String RUN = env("ACTTUB_REPLAY_RUN");
    // 1 이면 호출마다 {단계 번호, 지시문 앞 40자, 입력, 답}을 dumpCalls 필드로 남긴다 — 답 읽기 규칙을 캐시 답으로 분석할 때(SOMA-663 H2).
    private static final boolean DUMP = "1".equals(env("ACTTUB_REPLAY_DUMP"));
    private static final String MODEL = "gpt-6-luna";
    // 캐시 소금(SOMA-663 V1). 비우면 기존 캐시 키 그대로, 주면 같은 소금끼리만 캐시를 나눠 써서 나누기 답을 새로 받는다.
    private static final String SALT = env("ACTTUB_REPLAY_SALT");
    private static final int CODEX_LIMIT = Integer.parseInt(env("ACTTUB_REPLAY_CODEX").isBlank() ? "8" : env("ACTTUB_REPLAY_CODEX"));
    private static final int SCRIPTS_AT_ONCE = Integer.parseInt(env("ACTTUB_REPLAY_SCRIPTS").isBlank() ? "2" : env("ACTTUB_REPLAY_SCRIPTS"));
    // 운영 호출 대기(90초)보다 넉넉히 — Codex 는 에이전트 프롬프트가 붙어 느리다. 걸리면 실패로 보고 워커가 다시 시도한다.
    private static final Duration CODEX_TIMEOUT = Duration.ofMinutes(10);
    private static final Pattern QUOTA = Pattern.compile("usage limit|rate limit|quota|429|too many requests", Pattern.CASE_INSENSITIVE);

    private static final Semaphore CODEX = new Semaphore(CODEX_LIMIT);
    // 줄 두 번째 의견(J1). ACTTUB_REPLAY_JEV=1 이면 켠다. 답은 ACTTUB_JEV_CACHE(키 = 모델·요청 본문)에서 찾고, ACTTUB_JEV_FRESH=1 이면
    // 캐시를 읽지 않고 실제로 불러 시간을 잰다(답은 캐시에 덮어쓴다). 키는 ACTTUB_JEV_KEY_FILE 에서 읽고 출력하지 않는다.
    private static final boolean JEV = env("ACTTUB_REPLAY_JEV").equals("1");
    private static final boolean JEV_FRESH = env("ACTTUB_JEV_FRESH").equals("1");
    // ACTTUB_JEV_REVIEW=0 이면 줄 두 번째 의견(J1)은 끄고 H1 「말하는 글」 문지기만 Jev 를 부른다.
    /** 「같은 사람인가」 합치기 하한(H4). 비면 운영 값, {@code off} 면 끈다. */
    private static final Double SAME = env("ACTTUB_JEV_SAME").equals("off") ? null
            : env("ACTTUB_JEV_SAME").isBlank() ? ScriptSplitRules.SAME_SPEAKER_MIN : Double.valueOf(env("ACTTUB_JEV_SAME"));
    private static final LineReview.Settings JEV_SETTINGS = new LineReview.Settings(
            env("ACTTUB_JEV_MODE").isBlank() ? ScriptSplitRules.REVIEW.mode() : LineReview.Mode.valueOf(env("ACTTUB_JEV_MODE")),
            env("ACTTUB_JEV_TK").isBlank() ? ScriptSplitRules.REVIEW.kindThreshold() : Double.parseDouble(env("ACTTUB_JEV_TK")),
            env("ACTTUB_JEV_TD").isBlank() ? ScriptSplitRules.REVIEW.dropThreshold() : Double.parseDouble(env("ACTTUB_JEV_TD")),
            env("ACTTUB_JEV_TS").isBlank() ? ScriptSplitRules.REVIEW.speakerThreshold() : Double.parseDouble(env("ACTTUB_JEV_TS")),
            env("ACTTUB_JEV_TE").isBlank() ? ScriptSplitRules.REVIEW.edgeThreshold() : Double.parseDouble(env("ACTTUB_JEV_TE")),
            env("ACTTUB_JEV_TP").isBlank() ? ScriptSplitRules.REVIEW.speechThreshold() : Double.parseDouble(env("ACTTUB_JEV_TP")),
            env("ACTTUB_JEV_TB").isBlank() ? ScriptSplitRules.REVIEW.blockThreshold() : Double.parseDouble(env("ACTTUB_JEV_TB")),
            env("ACTTUB_JEV_PARALLEL").isBlank() ? ScriptSplitRules.REVIEW.parallel() : Integer.parseInt(env("ACTTUB_JEV_PARALLEL")));
    private static final OpenRouterLineDecider JEV_CLIENT = !JEV ? null : new OpenRouterLineDecider(JSON,
            env("ACTTUB_JEV_MODEL").isBlank() ? ScriptSplitRules.REVIEW_MODEL : env("ACTTUB_JEV_MODEL"), readKey(), Duration.ofSeconds(60),
            env("ACTTUB_JEV_IN_FLIGHT").isBlank() ? ScriptSplitRules.REVIEW_IN_FLIGHT : Integer.parseInt(env("ACTTUB_JEV_IN_FLIGHT")));

    private static String readKey() {
        try {
            return Files.readString(Path.of(env("ACTTUB_JEV_KEY_FILE"))).strip();
        } catch (IOException missing) {
            throw new IllegalStateException("ACTTUB_JEV_KEY_FILE 을 읽지 못했다", missing);
        }
    }
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
        ReplayDecider decider = JEV ? new ReplayDecider() : null;
        ScriptSplitWorker worker = new ScriptSplitWorker(new FakeLedger(), imports, generator, new RecordingLlmTelemetry(), failures,
                Clock.systemUTC(), decider, env("ACTTUB_JEV_REVIEW").equals("0") ? null : JEV_SETTINGS, SAME);
        List<SplitDraft.Origin> origins = new ArrayList<>();
        long started = System.nanoTime();
        SplitDraft.TRACE.set(traced -> { origins.clear(); origins.addAll(traced); }); // Jev 단계가 있으면 두 번 조립한다 — 마지막 것만
        try {
            worker.runOnce();
        } finally {
            SplitDraft.TRACE.remove();
        }
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
        // 원문 줄 → 대본 줄: [원문 줄 번호, 최종 종류, 모델 종류, 모델 배역, 뗀 머리, 본문, 대본 줄 번호(1부터)]. 배역 검사에 걸린 실패도 조립까지 갔으면 남는다.
        out.set("origins", JSON.valueToTree(origins.stream().map(o -> Arrays.asList(o.no(), o.kind(), o.modelKind(), o.modelSpeaker(),
                o.header(), o.body(), o.outputLine())).toList()));
        out.set("traits", JSON.valueToTree(draft == null ? List.of() : draft.characterTraits()));
        out.put("rawLines", imports.rawText.split("\n", -1).length);
        out.put("wallMs", wallMs);
        out.put("calls", generator.calls);
        out.put("cacheHits", generator.cacheHits);
        out.put("codexMsCritical", generator.criticalMs());
        out.put("outputTokens", generator.outputTokens);
        out.set("callLog", JSON.valueToTree(generator.callLog()));
        out.put("apiMsEstimate", generator.apiMsEstimate());
        if (decider != null) decider.write(out);
        if (DUMP) out.set("dumpCalls", JSON.valueToTree(generator.dump));
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
        private final Map<String, List<long[]>> stages = new LinkedHashMap<>(); // 단계 → {첫 줄 번호, ms, 출력 토큰, 입력 토큰, 적중}
        int calls;
        int cacheHits;
        final List<List<Object>> dump = new ArrayList<>();
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
            Path cached = CACHE.resolve(sha256((SALT.isBlank() ? "" : "salt=" + SALT + "\n") + MODEL + options.reasoningEffort() + prompt) + ".json");
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
                    if (DUMP) dump.add(Arrays.asList(stage, instructions.substring(0, Math.min(40, instructions.length())), input,
                            answer.path("text").asText()));
                    stages.computeIfAbsent(stage, k -> new ArrayList<>()).add(new long[] {firstLine(input), answer.path("ms").asLong(),
                            usage.path("output_tokens").asLong(), usage.path("input_tokens").asLong(), hit ? 1 : 0});
                }
                return new GeneratedText(answer.path("text").asText(), new TokenUsage(usage.path("input_tokens").asInt(),
                        usage.path("output_tokens").asInt(), usage.path("input_tokens").asInt() + usage.path("output_tokens").asInt()), MODEL);
            } catch (IOException failure) {
                throw new IllegalStateException(failure);
            }
        }

        /** 단계 안에서는 조각 순서대로 먼저 빈 자리({@link ScriptSplitRules#PARALLEL_CALLS} 개)에 맡긴 끝 시각, 단계끼리는 합 — 운영 벽시계 어림. */
        synchronized long criticalMs() {
            return critical(call -> call[1]);
        }

        /** 운영 API 어림(공통 지침): 호출 하나 = 출력 토큰 / 106 토큰·초 + 1.5초, 배정은 {@link #criticalMs} 와 같다. */
        synchronized long apiMsEstimate() {
            return critical(call -> call[2] * 1000 / 106 + 1500);
        }

        private long critical(java.util.function.ToLongFunction<long[]> cost) {
            long total = 0;
            for (List<long[]> calls : stages.values()) {
                long[] slots = new long[Math.min(calls.size(), ScriptSplitRules.PARALLEL_CALLS)];
                calls.stream().sorted(java.util.Comparator.comparingLong(call -> call[0])).forEach(call -> {
                    int free = 0;
                    for (int i = 1; i < slots.length; i++) if (slots[i] < slots[free]) free = i;
                    slots[free] += cost.applyAsLong(call);
                });
                total += Arrays.stream(slots).max().orElse(0);
            }
            return total;
        }

        /** 단계 순서대로 호출마다 {단계 번호, 첫 줄 번호, Codex ms, 출력 토큰, 입력 토큰, 캐시 적중 1/0} — 운영 API 시간 어림(timing.py)용. */
        synchronized List<long[]> callLog() {
            List<long[]> log = new ArrayList<>();
            int stage = 0;
            for (List<long[]> calls : stages.values()) {
                for (long[] call : calls) {
                    log.add(new long[] {stage, call[0], call[1], call[2], call[3], call[4]});
                }
                stage++;
            }
            return log;
        }

        private static long firstLine(String input) {
            int end = 0;
            while (end < input.length() && Character.isDigit(input.charAt(end))) end++;
            return end == 0 ? 0 : Long.parseLong(input.substring(0, end));
        }
    }

    /** 대본 하나의 Jev 질문 — 캐시와 줄마다의 기록. */
    private static final class ReplayDecider implements LineDecider {
        private final List<ObjectNode> asked = new ArrayList<>();
        private long firstStart = Long.MAX_VALUE;
        private long lastEnd;
        private double cost;
        private int hits;
        private int failed;
        private ObjectNode speech;

        @Override
        public LineReview.Decision decide(LineReview.Question question) {
            long started = System.nanoTime();
            Answered answered;
            try {
                answered = send(JEV_CLIENT.body(question));
            } catch (RuntimeException failure) {
                synchronized (this) {
                    failed++;
                    record(question, null, (System.nanoTime() - started) / 1_000_000, false, started).put("error", failure.getMessage());
                }
                throw failure;
            }
            JsonNode response = answered.response();
            LineReview.Decision decision = OpenRouterLineDecider.parse(response);
            synchronized (this) {
                ObjectNode row = record(question, decision, answered.ms(), answered.hit(), started);
                row.put("cost", response.path("usage").path("cost").asDouble());
                row.put("tokens", response.path("usage").path("input_tokens").asInt());
            }
            return decision;
        }

        /** H1 문지기 — 답은 대본 결과의 {@code speech} 칸에 남긴다. */
        @Override
        public double speech(String text) {
            Answered answered = send(JEV_CLIENT.speechBody(text));
            double confidence = OpenRouterLineDecider.speechConfidence(answered.response());
            synchronized (this) {
                speech = JSON.createObjectNode().put("confidence", confidence).put("ms", answered.ms()).put("hit", answered.hit())
                        .put("cost", answered.response().path("usage").path("cost").asDouble());
            }
            return confidence;
        }

        private final List<ObjectNode> same = new ArrayList<>();

        /** R2 배역 후보 판단 — 후보마다 보기·답·확신을 대본 결과의 {@code same} 칸에 남긴다(문턱은 워커가 건다). */
        @Override
        public Map<String, Double> role(SpeakerMerge.Candidate candidate, boolean reversed) {
            Answered answered = send(JEV_CLIENT.roleBody(candidate, reversed));
            Map<String, Double> probabilities = OpenRouterLineDecider.roleProbabilities(answered.response());
            JsonNode answer = answered.response().path("answers").path(SpeakerMerge.QUESTION);
            synchronized (this) {
                ObjectNode row = JSON.createObjectNode().put("name", candidate.name()).put("reversed", reversed).put("wholeLine", candidate.wholeLine())
                        .put("choice", answer.path("choice").asText()).put("p", answer.path("confidence").asDouble())
                        .put("ms", answered.ms()).put("hit", answered.hit())
                        .put("cost", answered.hit() ? 0 : answered.response().path("usage").path("cost").asDouble());
                row.set("roles", JSON.valueToTree(candidate.roles()));
                if (DUMP) row.set("body", JEV_CLIENT.roleBody(candidate, reversed));
                row.set("probabilities", answered.response().path("answers").path(SpeakerMerge.QUESTION).path("probabilities"));
                same.add(row);
            }
            return probabilities;
        }

        private record Answered(JsonNode response, long ms, boolean hit) {
        }

        private Answered send(ObjectNode body) {
            long started = System.nanoTime();
            try {
                String text = JSON.writeValueAsString(body);
                Path cached = Path.of(env("ACTTUB_JEV_CACHE")).resolve(sha256(JEV_CLIENT.model() + text) + ".json");
                if (!JEV_FRESH && Files.exists(cached)) {
                    JsonNode entry = JSON.readTree(cached.toFile());
                    synchronized (this) {
                        hits++;
                    }
                    return new Answered(entry.get("response"), entry.path("ms").asLong(), true);
                }
                JsonNode response = JEV_CLIENT.send(body);
                long ms = (System.nanoTime() - started) / 1_000_000;
                ObjectNode entry = JSON.createObjectNode().put("ms", ms);
                entry.set("response", response);
                Path temp = cached.resolveSibling(cached.getFileName() + "." + UUID.randomUUID() + ".tmp");
                Files.writeString(temp, JSON.writeValueAsString(entry));
                Files.move(temp, cached, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                synchronized (this) {
                    cost += response.path("usage").path("cost").asDouble();
                }
                return new Answered(response, ms, false);
            } catch (IOException failure) {
                throw new IllegalStateException(failure);
            }
        }

        private ObjectNode record(LineReview.Question question, LineReview.Decision decision, long ms, boolean hit, long started) {
            firstStart = Math.min(firstStart, started);
            lastEnd = Math.max(lastEnd, System.nanoTime());
            ObjectNode row = JSON.createObjectNode().put("no", question.no()).put("ms", ms).put("hit", hit);
            row.set("reasons", JSON.valueToTree(question.reasons()));
            if (question.current() != null) {
                row.put("curKind", question.current().kind().name().toLowerCase()).put("curSpeaker", question.current().speaker())
                        .put("curHeader", question.current().header());
            }
            row.set("speakers", JSON.valueToTree(question.speakers().stream().map(LineReview.Choice::label).toList()));
            if (question.head() != null) row.put("head", question.head());
            if (!question.watched().isEmpty()) row.set("watched", JSON.valueToTree(question.watched()));
            if (decision != null) {
                if (decision.kind() != null) row.put("kind", decision.kind().choice()).put("kindConf", decision.kind().confidence());
                if (decision.speaker() != null) {
                    String label = question.speakers().stream().filter(c -> c.value().equals(decision.speaker().choice()))
                            .map(LineReview.Choice::label).findFirst().orElse(decision.speaker().choice());
                    row.put("speaker", label).put("speakerConf", decision.speaker().confidence());
                }
                decision.extras().forEach((key, answer) -> row.put(key, answer.choice()).put(key + "Conf", answer.confidence()));
            }
            asked.add(row);
            return row;
        }

        synchronized void write(ObjectNode out) {
            asked.sort(java.util.Comparator.comparingInt(row -> row.get("no").asInt()));
            out.set("jev", JSON.valueToTree(asked));
            out.put("jevAsked", asked.size());
            out.put("jevHits", hits);
            out.put("jevFailed", failed);
            out.put("jevCost", cost);
            out.put("jevWallMs", asked.isEmpty() ? 0 : (lastEnd - firstStart) / 1_000_000);
            out.put("jevParallel", JEV_SETTINGS.parallel());
            out.set("speech", speech);
            same.sort(java.util.Comparator.comparing((ObjectNode row) -> row.get("name").asText()).thenComparing(row -> row.get("reversed").asBoolean()));
            out.set("same", JSON.valueToTree(same));
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
            return new Material(USER, false, UUID.randomUUID(), "f".repeat(64), null, rawText, "paste", false, null);
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
