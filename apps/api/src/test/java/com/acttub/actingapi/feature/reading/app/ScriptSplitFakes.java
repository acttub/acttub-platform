package com.acttub.actingapi.feature.reading.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.feature.reading.domain.ScriptSplitMode;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.schema.ScriptImportFailure;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;

/** 규칙 나누기 시험(SOMA-1090)의 가짜들 — 모델은 빈 답만 하고, 장부·저장소는 작업 하나짜리 메모리다. */
final class ScriptSplitFakes {
    /** 나누기 지시문 첫 줄({@code ScriptSplitPrompt} RULES). 첫 판·빠진 줄 호출이 모두 이 글로 시작한다. */
    static final String SPLIT_INSTRUCTIONS = "너는 연기 연습 앱의 대본 분석기다.";
    /** 빠진 줄 호출에만 붙는 글. */
    static final String MISSING_INSTRUCTIONS = "이번 입력은 앞에서 답이 빠진 줄을 다시 묻는 것이다.";

    private ScriptSplitFakes() {
    }

    /** 하이브리드 워커로 원문 하나를 나눈다. 모델 자리는 빈 답만 한다. */
    static Run run(String raw) {
        return run(raw, ScriptSplitMode.HYBRID);
    }

    /** 고른 방식의 워커로 원문 하나를 나눈다. 모델 자리는 빈 답만 한다. */
    static Run run(String raw, ScriptSplitMode mode) {
        return run(raw, mode, null);
    }

    /** 원본 파일 이름(확장자로 PDF 줄 잇기를 가른다)까지 주고 나눈다. */
    static Run run(String raw, ScriptSplitMode mode, String fileName) {
        return run(raw, mode, fileName, null);
    }

    /** 대본 제목(독백 화자를 제목에서 찾는다)까지 주고 나눈다. */
    static Run runTitled(String raw, ScriptSplitMode mode, String title) {
        return run(raw, mode, null, title);
    }

    private static Run run(String raw, ScriptSplitMode mode, String fileName, String title) {
        RecordingGenerator generator = new RecordingGenerator();
        FakeImports imports = new FakeImports(raw, fileName, title);
        ScriptSplitWorker worker = new ScriptSplitWorker(new FakeLedger(), imports, generator, new RecordingLlmTelemetry(),
                new RecordingFailureReporter(), Clock.systemUTC(), null, null, null, null, mode);
        worker.runOnce();
        return new Run(imports.saved, imports.failure, generator);
    }

    record Run(ScriptDraft saved, ScriptImportFailure failure, RecordingGenerator generator) {
        /** 저장된 줄을 「종류|배역|글」(공백 없앰) 열쇠로. */
        List<String> keys(boolean withSpeaker) {
            List<String> got = new ArrayList<>();
            if (saved == null) return got;
            for (ScriptDraft.Line line : saved.lines()) {
                String speaker = line.characterIndex() == null ? "" : saved.characterNames().get(line.characterIndex());
                got.add(key(line.kind(), withSpeaker ? speaker : "", line.text()));
            }
            return got;
        }
    }

    static String key(String kind, String speaker, String text) {
        return kind + "|" + speaker.replaceAll("\\s+", "") + "|" + text.replaceAll("\\s+", "");
    }

    /** 두 목록의 가장 긴 공통 부분열 길이. */
    static int lcs(List<String> a, List<String> b) {
        int[] previous = new int[b.size() + 1];
        int[] current = new int[b.size() + 1];
        for (int i = 1; i <= a.size(); i++) {
            for (int j = 1; j <= b.size(); j++) {
                current[j] = a.get(i - 1).equals(b.get(j - 1)) ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
            }
            int[] swap = previous;
            previous = current;
            current = swap;
        }
        return previous[b.size()];
    }

    /** 빈 답만 하고 받은 지시문을 남기는 모델 자리. */
    static final class RecordingGenerator implements TextGenerator {
        private final List<String> instructions = Collections.synchronizedList(new ArrayList<>());

        @Override
        public GeneratedText generate(String instructions, String input) {
            this.instructions.add(instructions);
            return new GeneratedText("", null);
        }

        long firstPassCalls() {
            synchronized (instructions) {
                return instructions.stream().filter(i -> i.startsWith(SPLIT_INSTRUCTIONS) && !i.contains(MISSING_INSTRUCTIONS)).count();
            }
        }

        /** 받은 지시문 전부(같은 것은 한 번). */
        java.util.Set<String> instructions() {
            synchronized (instructions) {
                return java.util.Set.copyOf(instructions);
            }
        }

        long missingCalls() {
            synchronized (instructions) {
                return instructions.stream().filter(i -> i.contains(MISSING_INSTRUCTIONS)).count();
            }
        }
    }

    /** 작업 하나짜리 장부. */
    static final class FakeLedger implements AiJobLedger {
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
    static final class FakeImports implements ScriptImportRepository {
        static final UUID USER = UUID.randomUUID();
        static final UUID IMPORT = UUID.randomUUID();
        private final String rawText;
        private final String fileName;
        private final String title;
        ScriptDraft saved;
        ScriptImportFailure failure;

        FakeImports(String rawText, String fileName, String title) {
            this.title = title;
            this.rawText = rawText;
            this.fileName = fileName;
        }

        @Override public String consent(UUID userId) { return "granted"; }
        @Override public Requested request(UUID userId, UUID requestId, String fingerprint, Submission submission, ScriptDraft sample,
                int scriptLimit, int dailyLimit, Instant now) { throw new UnsupportedOperationException(); }
        @Override public ImportView find(UUID userId, UUID importId) { throw new UnsupportedOperationException(); }
        @Override public Material material(UUID jobId, UUID importId) {
            return new Material(USER, false, UUID.randomUUID(), "f".repeat(64), title, rawText, fileName == null ? "paste" : "file", false, fileName);
        }
        @Override public void progress(UUID importId, int doneLines, int totalLines) { }
        @Override public void percent(UUID importId, int percent) { }
        @Override public Completion complete(UUID jobId, UUID leaseToken, UUID importId, ScriptDraft draft, Instant now) {
            saved = draft;
            return Completion.SAVED;
        }
        @Override public void fail(UUID jobId, UUID leaseToken, UUID importId, ScriptImportFailure failure, boolean keepFile, Instant now) { this.failure = failure; }
        @Override public int sweepExpired(Instant now) { return 0; }
    }
}
