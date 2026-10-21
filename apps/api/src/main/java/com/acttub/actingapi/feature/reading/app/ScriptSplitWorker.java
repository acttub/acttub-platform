package com.acttub.actingapi.feature.reading.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.UnaryOperator;

import com.acttub.actingapi.feature.reading.app.ScriptImportRepository.Material;
import com.acttub.actingapi.feature.reading.domain.CharacterTraits;
import com.acttub.actingapi.feature.reading.domain.LineLanguage;
import com.acttub.actingapi.feature.reading.domain.LineReview;
import com.acttub.actingapi.feature.reading.domain.LineSpacing;
import com.acttub.actingapi.feature.reading.domain.NumberedLine;
import com.acttub.actingapi.feature.reading.domain.ScriptFileRules;
import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.feature.reading.domain.ScriptRules;
import com.acttub.actingapi.feature.reading.domain.ScriptSplitRules;
import com.acttub.actingapi.feature.reading.domain.SplitDraft;
import com.acttub.actingapi.feature.reading.domain.SplitResponse;
import com.acttub.actingapi.feature.reading.domain.SpeakerGroups;
import com.acttub.actingapi.feature.reading.domain.SpeakerMerge;
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
 * <p>글자마다 띄어졌거나 낱말이 붙어 버린 줄이 있으면 나누기 전에 그 줄의 띄어쓰기만 모델로 고치고, 고친 줄이 공백 말고 다르거나 호출이 실패하면
 * 그 줄은 원문으로 둔다. 줄 번호를 붙인 원문을 150줄 조각으로 동시에 보내고, 조각이 둘 이상이면 앞 400줄로 배역 목록을 먼저
 * 받는다(배역마다 성별·나이대도 — 조각이 하나면 그 호출의 답 끝 「배역」 블록으로, SOMA-670). 첫 호출의 첫 줄이 「대본이 아니다」거나 나눈 결과에 배역이 없으면 이름 없는 대사 규칙(독백은 「화자」)으로 한 번 더 나누고, 그래도 대본이 아니면 거기서 멈춘다. 배역이 빈 대사는 앞 대사에 잇고({@link SplitResponse#fillSpeakers}), 잇지 못했거나 버리거나 빠진 줄은 두 번까지 다시 묻고 그래도 남으면 지문이다. 번호 줄도 판단 줄도 없는 답(설명·다른 작업의 답)은 형식 안내를 붙여 그 호출만 한 번 더 묻는다. 호출 하나는
 * 연결 실패·붐빔·서버 실패·미완료 답에 두 번까지 다시 시도하고, 그래도 안 되면 작업은 {@code failed} 로 끝난다 — 기기 파서
 * 대비 경로는 두지 않기로 했다(계획 「정한 것」 1). 사용자가 팝업에서 기다리므로 작업을 다시 큐에 넣지 않는다.
 */
public class ScriptSplitWorker {
    private static final Logger LOG = LoggerFactory.getLogger(ScriptSplitWorker.class);
    static final String KIND = AiJobKind.SCRIPT_SPLIT.dbValue();
    /**
     * 선점 lease. 최악 경로는 호출마다 3시도×(90초+대기 3초) ≈ 4.7분이 배역 목록 1번 + 조각 두 묶음(한도 16개씩, 4,256줄은
     * 29조각) + 빠진 줄 재요청 2판 = 다섯 번 이어지는 약 24분이다(배역이 하나도 없어 이름 없는 대사 규칙으로 한 번 더 나누면 그 두 배까지
     * 간다). 보통은 1분 안에 끝난다(68편 최대 36초). lease 가 지나면
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
    private final LineDecider decider;
    private final LineReview.Settings review;
    private final Double sameSpeaker;

    public ScriptSplitWorker(AiJobLedger ledger, ScriptImportRepository imports, TextGenerator generator,
            LlmTelemetry telemetry, FailureReporter failures, Clock clock) {
        this(ledger, imports, generator, telemetry, failures, clock, null, null);
    }

    /** @param decider 줄 두 번째 의견(SOMA-663 J1). {@code null} 이면 그 단계를 건너뛴다 */
    public ScriptSplitWorker(AiJobLedger ledger, ScriptImportRepository imports, TextGenerator generator,
            LlmTelemetry telemetry, FailureReporter failures, Clock clock, LineDecider decider, LineReview.Settings review) {
        this(ledger, imports, generator, telemetry, failures, clock, decider, review, null);
    }

    /** @param sameSpeaker 「같은 사람인가」로 화자를 합치는 확신 하한(SOMA-663 H4). {@code null} 이거나 decider 가 없으면 건너뛴다 */
    public ScriptSplitWorker(AiJobLedger ledger, ScriptImportRepository imports, TextGenerator generator,
            LlmTelemetry telemetry, FailureReporter failures, Clock clock, LineDecider decider, LineReview.Settings review,
            Double sameSpeaker) {
        this.decider = decider;
        this.review = review;
        this.sameSpeaker = sameSpeaker;
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
                imports.fail(claimed.id(), token, importId, split.failure(),
                        ScriptFileRules.KEPT_SPLIT_FAILURES.contains(split.failure()), clock.instant());
                return true;
            }
            switch (imports.complete(claimed.id(), token, importId, split.draft(), clock.instant())) {
                case SCRIPT_LIMIT ->
                        imports.fail(claimed.id(), token, importId, ScriptImportFailure.SCRIPT_LIMIT, false, clock.instant());
                // 같은 request_id 로 다른 대본을 이미 저장해 둔 기기다 — 저장할 수 없으니 실패로 닫는다. 파일 탓이 아니라 원본은 두지 않는다.
                case FINGERPRINT_MISMATCH ->
                        imports.fail(claimed.id(), token, importId, ScriptImportFailure.FAILED, false, clock.instant());
                case SAVED, CANCELLED -> { }
            }
        } catch (LeaseOwnershipException lost) {
            failures.report(lost, new FailureContext("ScriptSplitWorker.complete", claimed.id()));
        } catch (RuntimeException failure) {
            // 모델 호출의 실패와 쓸 수 없는 답은 바깥 의존의 실패다.
            failures.report(failure, FailureKind.EXTERNAL, new FailureContext("ScriptSplitWorker.run", claimed.id()));
            try {
                imports.fail(claimed.id(), token, importId, ScriptImportFailure.FAILED, true, clock.instant());
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
        List<NumberedLine> lines = restoreSpacing(jobId, calls, NumberedLine.of(material.rawText()));
        Split split = split(calls, importId, material, lines, UnaryOperator.identity(), true);
        // 이름 없는 독백·대화는 첫 판이 대본 아님이라 하거나 배역 칸을 비운다 — 그때만 이름 없는 대사 규칙으로 한 번 더 나눈다.
        if (split.failure() != ScriptImportFailure.NOT_SCRIPT && split.failure() != ScriptImportFailure.NO_CHARACTERS) {
            return split;
        }
        split = split(calls, importId, material, lines, ScriptSplitPrompt::unnamed, false);
        // 다시 나눠 통과한 글도 Jev 가 「말하는 글」이라 확신하지 않으면 거절한다 — 편지·수필처럼 말투만 구어인 글을 막는다.
        if (split.failure() == null && !material.skipScriptCheck() && decider != null && !speech(calls.jobId, material.rawText())) {
            return Split.failed(ScriptImportFailure.NOT_SCRIPT);
        }
        return split;
    }

    /** Jev 가 답하지 못하면 다시 나눈 결과를 그대로 둔다 — 문지기 실패가 넣기를 막지 않게. */
    private boolean speech(UUID jobId, String text) {
        try {
            return decider.speech(text) >= ScriptSplitRules.SPEECH_MIN;
        } catch (RuntimeException failure) {
            failures.report(failure, FailureKind.EXTERNAL, new FailureContext("ScriptSplitWorker.speech", jobId));
            return true;
        }
    }

    /** @param named 원문에 배역 이름이 있는 대본으로 나누는가 — 이름 없는 대사 규칙(「화자」)이면 원문에 없는 이름이 정상이다 */
    private Split split(Calls calls, UUID importId, Material material, List<NumberedLine> lines, UnaryOperator<String> prompt, boolean named) {
        imports.progress(importId, 0, lines.size());
        List<List<NumberedLine>> chunks = NumberedLine.chunks(lines, ScriptSplitRules.CHUNK_LINES);
        Map<Integer, SplitResponse.Row> rows = new ConcurrentHashMap<>();
        Map<Integer, SplitResponse.Row> refused = new ConcurrentHashMap<>();
        List<String> roster = List.of();
        Map<String, CharacterTraits> traits = Map.of();
        AtomicInteger done = new AtomicInteger();
        boolean judge = !material.skipScriptCheck();
        if (chunks.size() == 1) {
            SplitResponse first = calls.rows(prompt.apply(ScriptSplitPrompt.split(judge, roster, true)), chunks.getFirst(), NumberedLine.format(chunks.getFirst()));
            if (judge && first.notScript()) {
                return Split.failed(ScriptImportFailure.NOT_SCRIPT);
            }
            rows.putAll(first.rows());
            refused.putAll(first.refused());
            traits = first.traits();
            imports.progress(importId, lines.size(), lines.size());
        } else {
            List<NumberedLine> head = lines.subList(0, Math.min(lines.size(), ScriptSplitRules.ROSTER_LINES));
            String answer = calls.ask(prompt.apply(ScriptSplitPrompt.roster(judge)), head, LlmStep.SCRIPT_SPLIT);
            if (judge && SplitResponse.parse(answer, List.of()).notScript()) {
                return Split.failed(ScriptImportFailure.NOT_SCRIPT);
            }
            traits = SplitResponse.rosterTraits(answer);
            roster = List.copyOf(traits.keySet());
            String instructions = prompt.apply(ScriptSplitPrompt.split(false, roster));
            inParallel(chunks, chunk -> {
                SplitResponse part = calls.rows(instructions, chunk, NumberedLine.format(chunk));
                rows.putAll(part.rows());
                refused.putAll(part.refused());
                imports.progress(importId, done.addAndGet(chunk.size()), lines.size());
            });
        }
        Set<Integer> dropped = lines.stream().map(NumberedLine::no).filter(no -> !rows.containsKey(no)).collect(Collectors.toSet());
        // 효과음은 지문으로, 이름 조각은 원문 머리의 배역으로 고치거나 빠진 줄과 함께 다시 묻는다(SOMA-709) — 끝내 답이 없으면 첫 답으로 되돌린다.
        SplitResponse.sounds(rows);
        Map<Integer, SplitResponse.Row> asked = named ? SplitResponse.fragments(lines, rows, roster) : Map.of();
        String instructions = prompt.apply(ScriptSplitPrompt.missing(roster));
        for (int round = 0; round < ScriptSplitRules.MISSING_ROUNDS; round++) {
            SplitResponse.fillSpeakers(lines, rows);
            List<NumberedLine> missing = lines.stream().filter(line -> !rows.containsKey(line.no())).toList();
            if (missing.isEmpty()) {
                break;
            }
            // 빠진 줄만 답으로 받는다 — 문맥 줄 답은 group 밖이라 parse 가 버린다.
            inParallel(NumberedLine.chunks(missing, ScriptSplitRules.CHUNK_LINES), group -> rows.putAll(calls.rows(
                    instructions, group, NumberedLine.withContext(lines, group, ScriptSplitRules.MISSING_CONTEXT_LINES)).rows()));
        }
        asked.forEach(rows::putIfAbsent);
        SplitResponse.lineage(lines, rows, refused);
        if (named) {
            SplitResponse.ground(lines, rows);
        }
        SplitResponse.fillSpeakers(lines, rows);
        if (!named) {
            SplitResponse.monologue(rows);
        }
        SplitDraft.Assembly first = SplitDraft.assembleWithSpeakers(material.title(), material.rawText(), material.source(), lines, rows, roster, traits);
        ScriptDraft draft = first.draft();
        Map<Integer, String> speakers = first.speakers();
        Map<Integer, String> heads = first.heads();
        if (decider != null && review != null) {
            Map<Integer, SplitResponse.Row> changed = first.assembledNames(review(calls.jobId, lines, rows, dropped, draft.characterNames()), rows);
            // 보기는 조립 이름(머리 이름 앞세우기 뒤 「은서」)인데 줄은 모델 이름(「강은서」)이다. Jev 가 바꾼 줄만 조립 이름이 되면 다시 조립할 때
            // 안 바뀐 줄이 모델 이름으로 남아 한 사람이 갈린다(SOMA-663 통합, 215). Jev 가 안 바꾼 대사 줄도 조립 이름으로 맞춘다 — 조립 이름으로
            // 머리도 다시 찾는다(062 「수영\t」, 모델 이름 「최수영」으로는 못 뗀다).
            if (!changed.isEmpty()) {
                first.speakers().forEach((no, name) -> {
                    SplitResponse.Row row = rows.get(no);
                    if (!changed.containsKey(no) && row != null && row.kind() == SplitResponse.Kind.DIALOGUE && !row.speaker().equals(name)) {
                        changed.put(no, new SplitResponse.Row(no, SplitResponse.Kind.DIALOGUE, name, row.header()));
                    }
                });
            }
            if (!changed.isEmpty()) {
                rows.putAll(changed);
                SplitDraft.Assembly again = SplitDraft.assembleWithSpeakers(material.title(), material.rawText(), material.source(), lines, rows, roster, traits);
                draft = again.draft();
                speakers = again.speakers();
                heads = again.heads();
            }
        }
        Map<Integer, SplitResponse.Row> grouped = SplitDraft.groupHeads(lines, rows, heads);
        if (!grouped.isEmpty()) {
            rows.putAll(grouped);
            SplitDraft.Assembly again = SplitDraft.assembleWithSpeakers(material.title(), material.rawText(), material.source(), lines, rows, roster, traits);
            draft = again.draft();
            speakers = again.speakers();
            heads = again.heads();
        }
        if (decider != null && sameSpeaker != null) {
            Set<Integer> scenes = rows.values().stream().filter(row -> row.kind() == SplitResponse.Kind.SCENE).map(SplitResponse.Row::no)
                    .collect(Collectors.toSet());
            draft = sameSpeakers(calls.jobId, lines, draft, speakers, heads, scenes);
        }
        draft = SpeakerGroups.apply(draft);
        ScriptRules.Rejection rejection = ScriptRules.check(draft);
        if (rejection == null) {
            return Split.of(languages(calls.jobId, calls, draft));
        }
        return Split.failed(switch (rejection) {
            case NO_CHARACTERS -> ScriptImportFailure.NO_CHARACTERS;
            case TOO_LONG -> ScriptImportFailure.SCRIPT_TOO_LONG;
            case INVALID_CHARACTERS -> ScriptImportFailure.FAILED;
        });
    }

    /** 두 번째 의견은 작업을 실패시키지 않는다 — 답을 못 받은 줄은 나누기 답대로 둔다. 바꿀 줄만 돌려준다. */
    private Map<Integer, SplitResponse.Row> review(UUID jobId, List<NumberedLine> lines, Map<Integer, SplitResponse.Row> rows,
            Set<Integer> dropped, List<String> characters) {
        List<LineReview.Question> questions = LineReview.questions(lines, rows, dropped, characters, review.mode());
        Map<Integer, SplitResponse.Row> changed = new ConcurrentHashMap<>();
        Map<Integer, LineReview.Decision> decisions = new ConcurrentHashMap<>();
        AtomicInteger failed = new AtomicInteger();
        Instant startedAt = clock.instant();
        try (ExecutorService executor = Executors.newFixedThreadPool(Math.max(1, Math.min(questions.size(), review.parallel())))) {
            List<Future<?>> futures = new ArrayList<>();
            for (LineReview.Question question : questions) {
                futures.add(executor.submit(() -> {
                    try {
                        LineReview.Decision decision = decider.decide(question);
                        decisions.put(question.no(), decision);
                        SplitResponse.Row row = LineReview.apply(question, decision, review);
                        if (row != null) {
                            changed.put(row.no(), row);
                        }
                    } catch (RuntimeException failure) {
                        if (failed.getAndIncrement() == 0) {
                            failures.report(failure, FailureKind.EXTERNAL, new FailureContext("ScriptSplitWorker.review", jobId));
                        }
                    }
                }));
            }
            for (Future<?> future : futures) {
                try {
                    future.get();
                } catch (ExecutionException impossible) {
                    throw new IllegalStateException(impossible.getCause());
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("script split review was interrupted", interrupted);
                }
            }
        }
        changed.putAll(LineReview.neighbors(lines, questions, decisions, changed, characters, review));
        LOG.info("script split review job={} asked={} changed={} failed={} took_ms={}", jobId, questions.size(), changed.size(),
                failed.get(), Duration.between(startedAt, clock.instant()).toMillis());
        return changed;
    }

    /**
     * 배역 후보를 원문 쓰임과 함께 Jev 로 묻고 확신이 하한 이상이면 기존 역할로 합치거나 배역을 지운다({@link SpeakerMerge}). 작업을 실패시키지
     * 않는다 — 답을 못 받은 후보는 그대로 둔다. 동시 수는 줄 두 번째 의견과 같다.
     */
    private ScriptDraft sameSpeakers(UUID jobId, List<NumberedLine> lines, ScriptDraft draft, Map<Integer, String> speakers,
            Map<Integer, String> heads, Set<Integer> scenes) {
        List<SpeakerMerge.Candidate> candidates = SpeakerMerge.candidates(draft, lines, speakers, heads, scenes);
        if (candidates.isEmpty()) {
            return draft;
        }
        Map<SpeakerMerge.Candidate, Map<String, Double>> answers = new ConcurrentHashMap<>();
        Map<SpeakerMerge.Candidate, Map<String, Double>> again = new ConcurrentHashMap<>();
        AtomicInteger failed = new AtomicInteger();
        Instant startedAt = clock.instant();
        int parallel = review == null ? ScriptSplitRules.REVIEW.parallel() : review.parallel();
        try (ExecutorService executor = Executors.newFixedThreadPool(Math.min(2 * candidates.size(), parallel))) {
            List<Future<?>> futures = new ArrayList<>();
            // 보기 순서를 바꿔 두 번 묻는다 — 같은 묶음 안이라 왕복은 늘지 않는다.
            for (SpeakerMerge.Candidate candidate : candidates) {
                for (boolean reversed : List.of(false, true)) {
                    futures.add(executor.submit(() -> {
                        try {
                            (reversed ? again : answers).put(candidate, decider.role(candidate, reversed));
                        } catch (RuntimeException failure) {
                            if (failed.getAndIncrement() == 0) {
                                failures.report(failure, FailureKind.EXTERNAL, new FailureContext("ScriptSplitWorker.sameSpeakers", jobId));
                            }
                        }
                    }));
                }
            }
            for (Future<?> future : futures) {
                try {
                    future.get();
                } catch (ExecutionException impossible) {
                    throw new IllegalStateException(impossible.getCause());
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("script split same-speaker check was interrupted", interrupted);
                }
            }
        }
        Map<SpeakerMerge.Candidate, LineReview.Answer> mean = new LinkedHashMap<>();
        candidates.forEach(candidate -> mean.put(candidate, SpeakerMerge.mean(answers.get(candidate), again.get(candidate))));
        ScriptDraft merged = SpeakerMerge.apply(draft, mean, sameSpeaker);
        LOG.info("script split same-speaker job={} asked={} removed={} failed={} took_ms={}", jobId, candidates.size(),
                draft.characterNames().size() - merged.characterNames().size(), failed.get(), Duration.between(startedAt, clock.instant()).toMillis());
        return merged;
    }

    /** 복원은 작업을 실패시키지 않는다 — 고치지 못한 줄은 띄어진 채로 나눈다. */
    private List<NumberedLine> restoreSpacing(UUID jobId, Calls calls, List<NumberedLine> lines) {
        List<NumberedLine> targets = LineSpacing.toRestore(lines);
        if (targets.isEmpty()) {
            return lines;
        }
        Map<Integer, String> restored = new ConcurrentHashMap<>();
        inParallel(NumberedLine.chunks(targets, ScriptSplitRules.CHUNK_LINES), chunk -> {
            try {
                restored.putAll(LineSpacing.parse(calls.ask(ScriptSplitPrompt.spacing(), chunk, LlmStep.SCRIPT_SPACING), chunk));
            } catch (RuntimeException failure) {
                failures.report(failure, FailureKind.EXTERNAL, new FailureContext("ScriptSplitWorker.spacing", jobId));
            }
        });
        return LineSpacing.apply(lines, restored);
    }

    /**
     * 외국 글자가 든 대사만 모델에 물어 줄마다 말과 소리 낼 글을 단다 (SOMA-751). 한국어만 있는 대본은 부르지 않는다.
     * 복원처럼 작업을 실패시키지 않는다 — 못 받은 줄은 지금처럼 읽힌다.
     */
    private ScriptDraft languages(UUID jobId, Calls calls, ScriptDraft draft) {
        List<NumberedLine> targets = draft.lines().stream()
                .filter(line -> "dialogue".equals(line.kind()) && LineLanguage.worthAsking(line.text()))
                .map(line -> new NumberedLine(line.ordinal(), line.text()))
                .toList();
        if (targets.isEmpty()) {
            return draft;
        }
        Map<Integer, LineLanguage.Result> found = new ConcurrentHashMap<>();
        inParallel(NumberedLine.chunks(targets, ScriptSplitRules.CHUNK_LINES), chunk -> {
            try {
                found.putAll(LineLanguage.parse(calls.ask(ScriptSplitPrompt.language(), chunk, LlmStep.SCRIPT_LANGUAGE), chunk));
            } catch (RuntimeException failure) {
                failures.report(failure, FailureKind.EXTERNAL, new FailureContext("ScriptSplitWorker.language", jobId));
            }
        });
        return draft.withLanguages(found);
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

        /** 나누기 호출 — 형식을 벗어난 답({@link SplitResponse#unformatted})은 형식 안내를 붙여 한 번만 다시 묻는다. */
        SplitResponse rows(String instructions, List<NumberedLine> sent, String input) {
            String answer = ask(instructions, input, LlmStep.SCRIPT_SPLIT);
            if (SplitResponse.unformatted(answer)) {
                answer = ask(ScriptSplitPrompt.formatRetry(instructions), input, LlmStep.SCRIPT_SPLIT);
            }
            return SplitResponse.parse(answer, sent);
        }

        String ask(String instructions, List<NumberedLine> chunk, LlmStep step) {
            return ask(instructions, NumberedLine.format(chunk), step);
        }

        String ask(String instructions, String input, LlmStep step) {
            RuntimeException last = null;
            for (int attempt = 0; attempt <= ScriptSplitRules.CALL_RETRIES; attempt++) {
                if (attempt > 0) {
                    pause(Duration.ofSeconds(1L << (attempt - 1)));
                }
                Instant startedAt = clock.instant();
                try {
                    GeneratedText generated = generator.generate(instructions, input, OPTIONS);
                    record(step, instructions, input, generated, startedAt, null);
                    return generated.text();
                } catch (RuntimeException failure) {
                    record(step, instructions, input, null, startedAt, failure);
                    if (!retryable(failure)) {
                        throw failure;
                    }
                    last = failure;
                }
            }
            throw last;
        }

        /** 비용·속도를 셀 수 있게 호출마다 로그 한 줄 — 로그에는 글을 남기지 않는다(관측 기록에는 원문이 그대로 실린다). */
        private void record(LlmStep step, String instructions, String input, GeneratedText generated, Instant startedAt,
                RuntimeException failure) {
            Duration took = Duration.between(startedAt, clock.instant());
            LOG.info("script split call job={} step={} model={} input_tokens={} output_tokens={} took_ms={} error={}", jobId, step.spanName(),
                    generated == null ? ScriptSplitRules.MODEL : generated.model(),
                    generated == null || generated.usage() == null ? "-" : generated.usage().prompt(),
                    generated == null || generated.usage() == null ? "-" : generated.usage().completion(),
                    took.toMillis(), failure == null ? "-" : failure.getClass().getSimpleName());
            telemetry.record(new LlmCall(
                    step,
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
