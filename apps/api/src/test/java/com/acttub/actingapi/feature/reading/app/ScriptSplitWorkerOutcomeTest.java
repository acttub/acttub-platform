package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.ScriptImportFailure;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.OpenAiStatusException;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;

/** reading.import: 나누기 작업이 끝나는 길마다 요청을 어떻게 닫는지 — 취소, 한도, 지문 충돌, 대본 아님, lease 를 잃음. */
class ScriptSplitWorkerOutcomeTest {
    final AiJobLedger ledger = mock(AiJobLedger.class);
    final ScriptImportRepository imports = mock(ScriptImportRepository.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final MutableClock clock = new MutableClock(Instant.parse("2026-10-20T00:00:00Z"));
    final List<String> answers = new ArrayList<>();
    final TextGenerator generator = (instructions, input) -> new GeneratedText(answers.isEmpty() ? "" : answers.removeFirst(), null, "test");
    final ScriptSplitWorker worker = new ScriptSplitWorker(ledger, imports, generator, new RecordingLlmTelemetry(), failures, clock);
    final UUID job = UUID.randomUUID();
    final UUID importId = UUID.randomUUID();
    final UUID user = UUID.randomUUID();
    static final String SHORT = "지수: 왔어?\n민호: 응.";
    static final String SHORT_ANSWER = "대본\t예\n1\td\t지수\t지수: \n2\td\t민호\t민호: ";

    void claimed(String rawText) {
        when(ledger.claimNext(eq(ScriptSplitWorker.KIND), any(), eq(ScriptSplitWorker.LEASE), any(), eq(true)))
                .thenReturn(new AiJobLedger.Claimed(job, user, importId, 1, null));
        when(imports.material(job, importId)).thenReturn(rawText == null ? null
                : new ScriptImportRepository.Material(user, false, UUID.randomUUID(), "fp", "제목", rawText, "paste", false, null));
    }

    @Test void nothingToClaimMeansNoWork() {
        assertThat(worker.runOnce()).isFalse();
    }

    @Test void aRequestThatEndedMeanwhileIsCancelled() {
        claimed(null);
        assertThat(worker.runOnce()).isTrue();
        verify(ledger).fail(eq(job), any(), eq("cancelled"), eq(clock.instant()));
        verify(imports, never()).complete(any(), any(), any(), any(), any());
    }

    @Test void aFullScriptShelfAndAFingerprintClashCloseTheRequestWithoutKeepingTheFile() {
        claimed(SHORT);
        answers.add(SHORT_ANSWER);
        when(imports.complete(eq(job), any(), eq(importId), any(), any())).thenReturn(ScriptImportRepository.Completion.SCRIPT_LIMIT);
        worker.runOnce();
        verify(imports).fail(eq(job), any(), eq(importId), eq(ScriptImportFailure.SCRIPT_LIMIT), eq(false), any());

        answers.add(SHORT_ANSWER);
        when(imports.complete(eq(job), any(), eq(importId), any(), any())).thenReturn(ScriptImportRepository.Completion.FINGERPRINT_MISMATCH);
        worker.runOnce();
        verify(imports).fail(eq(job), any(), eq(importId), eq(ScriptImportFailure.FAILED), eq(false), any());
        assertThat(failures.reports()).isEmpty();
    }

    @Test void aLongTextThatIsNotAScriptIsRejectedFromTheRosterCall() {
        StringBuilder text = new StringBuilder();
        for (int i = 0; i < 160; i++) text.append("오늘의 장보기 목록 ").append(i).append(" 번째 줄입니다\n");
        claimed(text.toString());
        answers.add("대본\t아니오");
        answers.add("대본\t아니오"); // 이름 없는 대사 규칙으로 한 번 더 나눠도 아니오
        worker.runOnce();
        verify(imports).fail(eq(job), any(), eq(importId), eq(ScriptImportFailure.NOT_SCRIPT), eq(true), any());
    }

    @Test void losingTheLeaseWhileSavingIsReportedOnly() {
        claimed(SHORT);
        answers.add(SHORT_ANSWER);
        when(imports.complete(eq(job), any(), eq(importId), any(), any())).thenThrow(new LeaseOwnershipException("lost"));
        assertThat(worker.runOnce()).isTrue();
        assertThat(failures.contexts()).singleElement().asString().startsWith("ScriptSplitWorker.complete");
        verify(imports, never()).fail(any(), any(), any(), any(), anyBoolean(), any());
    }

    @Test void aRejectedModelCallFailsTheRequestAndALostLeaseThenIsReportedToo() {
        claimed(SHORT);
        TextGenerator refusing = (instructions, input) -> { throw new OpenAiStatusException(400, "bad request"); };
        var strict = new ScriptSplitWorker(ledger, imports, refusing, new RecordingLlmTelemetry(), failures, clock);
        doThrow(new LeaseOwnershipException("lost")).when(imports).fail(eq(job), any(), eq(importId), eq(ScriptImportFailure.FAILED), eq(true), any());
        assertThat(strict.runOnce()).isTrue();
        assertThat(failures.contexts()).hasSize(2);
        assertThat(failures.contexts().get(0)).startsWith("ScriptSplitWorker.run");
        assertThat(failures.contexts().get(1)).startsWith("ScriptSplitWorker.release");
    }
}
