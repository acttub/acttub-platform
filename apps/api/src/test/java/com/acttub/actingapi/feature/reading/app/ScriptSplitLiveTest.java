package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;

import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.integration.llm.OpenAiResponsesClient;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.schema.ScriptImportFailure;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * 가짜 대본 묶음({@code src/test/resources/script-split/})을 실제 gpt-6-luna 로 나눠 기대 저장 결과와 견준다. 명시적으로 켤 때만
 * 돈다 — 운영 글은 없고 전부 지어낸 대본이다. 장부·저장소는 메모리 가짜라 모델 호출과 워커의 조립만 본다.
 *
 * <p>같은 묶음을 2026-10-06 에 로컬 서버로 여덟 판 돌린 결과(PR #512): 줄 가중 일치 93.0~100%, 지금 코드의 두 판은 99.6%·100%.
 * 모델이 판마다 다르게 읽는 자리(괄호 지문 줄·때와 장소 한 줄)가 있어 묶음마다 90% 를 하한으로 둔다.
 */
@EnabledIfEnvironmentVariable(named = "ACTTUB_SPLIT_LIVE_TEST", matches = "1")
@EnabledIfEnvironmentVariable(named = "OPENAI_API_KEY", matches = ".+")
class ScriptSplitLiveTest {
    private static final Path FIXTURES = Path.of("src/test/resources/script-split");

    static Stream<String> fixtures() throws IOException {
        try (Stream<Path> files = Files.list(FIXTURES)) {
            return files.map(Path::getFileName).map(Path::toString).filter(name -> name.endsWith(".txt"))
                    .map(name -> name.substring(0, name.length() - 4)).sorted().toList().stream();
        }
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("fixtures")
    void splitsTheFixtureLikeTheExpectedFile(String name) throws IOException {
        String raw = Files.readString(FIXTURES.resolve(name + ".txt"));
        Expected expected = Expected.read(FIXTURES.resolve(name + ".expected.tsv"));
        FakeLedger ledger = new FakeLedger();
        FakeImports imports = new FakeImports(raw);
        ScriptSplitWorker worker = new ScriptSplitWorker(ledger, imports, new OpenAiResponsesClient(StructuredJson.MAPPER),
                new RecordingLlmTelemetry(), new RecordingFailureReporter(), Clock.systemUTC());

        assertThat(worker.runOnce()).isTrue();

        if (expected.failure != null) {
            assertThat(imports.failure).as(name).isEqualTo(expected.failure);
            return;
        }
        assertThat(imports.failure).as(name + " 실패").isNull();
        assertThat(imports.saved).as(name + " 저장").isNotNull();
        List<String> got = new ArrayList<>();
        for (ScriptDraft.Line line : imports.saved.lines()) {
            got.add(key(line.kind(), line.characterIndex() == null ? "" : imports.saved.characterNames().get(line.characterIndex()), line.text()));
        }
        int same = lcs(expected.lines, got);
        int total = Math.max(expected.lines.size(), got.size());
        assertThat((double) same / total).as("%s 같은 줄 %d/%d", name, same, total).isGreaterThanOrEqualTo(0.9);
        assertThat(imports.saved.characterNames()).as(name + " 배역").isEqualTo(expected.characters);
    }

    private static String key(String kind, String speaker, String text) {
        return kind + "|" + speaker.replaceAll("\\s+", "") + "|" + text.replaceAll("\\s+", "");
    }

    private static int lcs(List<String> a, List<String> b) {
        int[][] table = new int[a.size() + 1][b.size() + 1];
        for (int i = 1; i <= a.size(); i++) {
            for (int j = 1; j <= b.size(); j++) {
                table[i][j] = a.get(i - 1).equals(b.get(j - 1)) ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
            }
        }
        return table[a.size()][b.size()];
    }

    private record Expected(String title, List<String> characters, List<String> lines, ScriptImportFailure failure) {
        static Expected read(Path path) throws IOException {
            String title = null;
            List<String> characters = List.of();
            List<String> lines = new ArrayList<>();
            ScriptImportFailure failure = null;
            for (String row : Files.readAllLines(path)) {
                if (row.isBlank()) continue;
                String[] fields = row.split("\t", -1);
                switch (fields[0]) {
                    case "title" -> title = fields[1];
                    case "characters" -> characters = List.of(fields[1].split(", "));
                    case "failure" -> failure = ScriptImportFailure.valueOf(fields[1].toUpperCase());
                    default -> lines.add(key(fields[0], fields[1], fields[2]));
                }
            }
            return new Expected(title, characters, lines, failure);
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
        @Override public void fail(UUID jobId, UUID leaseToken, UUID importId, ScriptImportFailure failure, Instant now) { this.failure = failure; }
        @Override public int sweepExpired(Instant now) { return 0; }
    }
}
