package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;

import com.acttub.actingapi.feature.reading.domain.LineReview;
import com.acttub.actingapi.feature.reading.domain.NumberedLine;
import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.feature.reading.domain.SplitResponse;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;

/**
 * SOMA-1005: 대본 한 줄은 대본 전체 상한까지 길 수 있다. 줄을 배역·머리 칸에 그대로 옮겨 쓴 답까지 나누기 경로 전체를 돌려도 이름 정규식이 느려지지 않고,
 * 줄 글은 사라지지 않는다.
 */
class ScriptSplitLongLineTest {
    private static final String OPENING = "지수: 왔어?\n민호: 응.\n";
    private static final String ENDING = "\n지수: 끝이야.\n민호: 그래.";

    private final AiJobLedger ledger = mock(AiJobLedger.class);
    private final ScriptImportRepository imports = mock(ScriptImportRepository.class);
    private final RecordingFailureReporter failures = new RecordingFailureReporter();
    private final UUID job = UUID.randomUUID();
    private final UUID importId = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();

    /** 정규식을 제곱으로 느리게 하는 모양들. 글자가 사라졌는지 볼 수 있게 끝에 글자를 둔다. */
    private static List<String> shapes(int length) {
        return List.of(
                "가" + " ".repeat(length) + "나",
                "-".repeat(length) + "다",
                ".".repeat(length) + "라",
                "[" + "마,".repeat(length / 2) + "바",
                "사" + " ".repeat(length) + "소리아",
                "자" + " :".repeat(length / 2) + "차",
                "-카" + " ".repeat(length) + "타");
    }

    @Test
    void aFewVeryLongLinesAreFastAndKeepTheirText() {
        ScriptDraft saved = split(shapes(12_000));

        String kept = saved.lines().stream().map(ScriptDraft.Line::text).collect(Collectors.joining("\n"));
        assertThat(shapes(12_000)).allSatisfy(line -> assertThat(kept).contains(line));
    }

    @Test
    void manyLinesJustUnderTheLimitAreFastAndKeepTheirText() {
        List<String> lines = new ArrayList<>();
        for (int i = 0; i < 70; i++) {
            lines.addAll(shapes(190));
        }
        split(lines);
    }

    private ScriptDraft split(List<String> longLines) {
        String raw = OPENING + String.join("\n", longLines) + ENDING;
        assertThat(raw.length()).isLessThan(100_000);
        // 모델이 줄을 배역·머리 칸과 배역 목록에 그대로 옮겨 쓴 답
        TextGenerator echoing = (instructions, input) -> new GeneratedText(input.lines()
                .filter(line -> line.matches("^\\d+\t.*"))
                .map(line -> {
                    String[] numbered = line.split("\t", 2);
                    return numbered[0] + "\td\t" + numbered[1] + "\t" + numbered[1];
                })
                .collect(Collectors.joining("\n", "대본\t예\n", "\n" + SplitResponse.CAST_HEADER + "\n" + String.join("\n", longLines))), null, "test");
        ScriptSplitWorker worker = new ScriptSplitWorker(ledger, imports, echoing, new RecordingLlmTelemetry(), failures,
                new MutableClock(Instant.parse("2026-11-03T00:00:00Z")));
        when(ledger.claimNext(eq(ScriptSplitWorker.KIND), any(), eq(ScriptSplitWorker.LEASE), any(), eq(true)))
                .thenReturn(new AiJobLedger.Claimed(job, user, importId, 1, null));
        when(imports.material(job, importId))
                .thenReturn(new ScriptImportRepository.Material(user, false, UUID.randomUUID(), "fp", "제목", raw, "paste", false, null));
        AtomicReference<ScriptDraft> saved = new AtomicReference<>();
        when(imports.complete(eq(job), any(), eq(importId), any(), any())).thenAnswer(call -> {
            saved.set(call.getArgument(3));
            return ScriptImportRepository.Completion.SAVED;
        });

        assertTimeoutPreemptively(Duration.ofSeconds(60), () -> {
            worker.runOnce();
        });

        assertThat(failures.reports()).isEmpty();
        assertThat(saved.get()).isNotNull();
        // 줄 두 번째 의견의 질문 만들기도 같은 줄과 답을 본다
        List<NumberedLine> lines = NumberedLine.of(raw);
        String answer = lines.stream().map(line -> line.no() + "\td\t" + line.text() + "\t" + line.text()).collect(Collectors.joining("\n"));
        assertTimeoutPreemptively(Duration.ofSeconds(30), () -> LineReview.questions(lines, SplitResponse.parse(answer, lines).rows(),
                Set.of(), saved.get().characterNames(), LineReview.Mode.ALL));
        return saved.get();
    }
}
