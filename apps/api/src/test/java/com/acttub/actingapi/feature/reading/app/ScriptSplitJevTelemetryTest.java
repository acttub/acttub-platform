package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.intThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;

import com.acttub.actingapi.feature.reading.domain.LineReview;
import com.acttub.actingapi.feature.reading.domain.ScriptSplitProgress;
import com.acttub.actingapi.feature.reading.domain.ScriptSplitRules;
import com.acttub.actingapi.feature.reading.domain.SpeakerMerge;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmScore;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.platform.schema.ScriptImportFailure;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;

/** reading.script: Jev 호출은 작업당 단계별 한 건으로 남고, 대본 글은 들어가지 않는다(SOMA-1019). */
class ScriptSplitJevTelemetryTest {
    static final String TEXT = "지수: 왔어?\n민호: 응.\n지수: 밥 먹었어?\n민호: 아직.\n지수: 같이 먹자.\n민호: 좋아.\n민호씨: 그래.";
    static final String ANSWER = "대본\t예\n1\td\t지수\t지수: \n2\td\t민호\t민호: \n3\td\t지수\t지수: \n4\td\t민호\t민호: \n5\td\t지수\t지수: \n6\td\t민호\t민호: \n7\td\t민호씨\t민호씨: ";
    static final List<String> SCRIPT_WORDS = List.of("왔어", "밥 먹었어", "아직", "같이 먹자", "좋아", "그래");

    final AiJobLedger ledger = mock(AiJobLedger.class);
    final ScriptImportRepository imports = mock(ScriptImportRepository.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    final MutableClock clock = new MutableClock(Instant.parse("2026-11-03T00:00:00Z"));
    final UUID job = UUID.randomUUID();
    final UUID importId = UUID.randomUUID();
    final UUID user = UUID.randomUUID();

    /** 가짜 판단 모델 — 어떤 구현이든 model() 과 받은 집계만으로 기록된다. */
    static class FakeDecider implements LineDecider {
        final AtomicInteger decided = new AtomicInteger();
        final AtomicInteger asked = new AtomicInteger();
        Function<LineReview.Question, LineReview.Decision> decision = question -> new LineReview.Decision(null, null);

        @Override public String model() {
            return "fake-jev";
        }

        @Override public LineReview.Decision decide(LineReview.Question question, DeciderTally tally) {
            decided.incrementAndGet();
            tally.retried(true);
            tally.used(10, 2, 0.001);
            return decision.apply(question);
        }

        @Override public double speech(String text, DeciderTally tally) {
            tally.used(5, 1, 0.0005);
            return 1;
        }

        @Override public Map<String, Double> role(SpeakerMerge.Candidate candidate, boolean reversed, DeciderTally tally) {
            asked.incrementAndGet();
            tally.retried(false);
            tally.used(20, 3, 0.002);
            return Map.of("r0", 0.99);
        }
    }

    ScriptSplitWorker worker(LlmTelemetry into, TextGenerator generator, LineDecider decider) {
        return new ScriptSplitWorker(ledger, imports, generator, into, failures, clock, decider, ScriptSplitRules.REVIEW, ScriptSplitRules.SAME_SPEAKER_MIN);
    }

    void claimed(String text) {
        when(ledger.claimNext(eq(ScriptSplitWorker.KIND), any(), eq(ScriptSplitWorker.LEASE), any(), eq(true)))
                .thenReturn(new AiJobLedger.Claimed(job, user, importId, 1, null));
        when(imports.material(job, importId)).thenReturn(material(text));
        when(imports.complete(eq(job), any(), eq(importId), any(), any())).thenReturn(ScriptImportRepository.Completion.CANCELLED);
    }

    ScriptImportRepository.Material material(String text) {
        return new ScriptImportRepository.Material(user, false, UUID.randomUUID(), "fp", "제목", text, "paste", false, null);
    }

    static TextGenerator answering(String... answers) {
        List<String> left = new ArrayList<>(List.of(answers));
        return (instructions, input) -> new GeneratedText(left.size() > 1 ? left.removeFirst() : left.getFirst(), null, "test");
    }

    List<LlmCall> recorded(LlmStep step) {
        return telemetry.calls().stream().filter(call -> call.step() == step).toList();
    }

    @Test void aJobLeavesOneRecordPerStepWithItsCountsAndNoScriptText() {
        claimed(TEXT);
        FakeDecider decider = new FakeDecider();
        decider.decision = question -> {
            if (question.no() == 2) throw new IllegalStateException("decision HTTP 500");
            return question.no() == 1 ? new LineReview.Decision(new LineReview.Answer("direction", 0.99), new LineReview.Answer("none", 0.99)) : new LineReview.Decision(null, null);
        };

        assertThat(worker(telemetry, answering(ANSWER), decider).runOnce()).isTrue();

        LlmCall review = recorded(LlmStep.SCRIPT_REVIEW).getFirst();
        assertThat(recorded(LlmStep.SCRIPT_REVIEW)).hasSize(1);
        assertThat(review.practiceSessionId()).isEqualTo(job);
        assertThat(review.userId()).isEqualTo(user);
        assertThat(review.model()).isEqualTo("fake-jev");
        assertThat(review.metadata()).containsEntry("operation_id", job.toString())
                .containsEntry("questions", Integer.toString(decider.decided.get()))
                .containsEntry("changed", "1").containsEntry("failed", "1")
                .containsEntry("retries_429", Integer.toString(decider.decided.get())).containsEntry("retries_other", "0")
                .containsEntry("parallel", "16").containsEntry("review_mode", "ALL");
        assertThat(review.failed()).as("일부 실패는 수로 보고 단계는 성공이다").isFalse();
        assertThat(review.output()).contains("1번 줄").contains("DIALOGUE/지수").contains("DIRECTION");
        assertThat(review.tokens().input()).isEqualTo(10 * decider.decided.get());
        assertThat(review.cost()).isCloseTo(0.001 * decider.decided.get(), org.assertj.core.data.Offset.offset(1e-9));
        assertThat(review.prompt().name()).isEqualTo("script.review");

        LlmCall same = recorded(LlmStep.SCRIPT_SAME_SPEAKER).getFirst();
        assertThat(recorded(LlmStep.SCRIPT_SAME_SPEAKER)).hasSize(1);
        assertThat(same.metadata()).containsEntry("questions", Integer.toString(decider.asked.get()))
                .containsEntry("retries_other", Integer.toString(decider.asked.get())).containsEntry("retries_429", "0");
        assertThat(decider.asked.get()).isPositive();
        assertThat(same.output()).contains(" → ");
        assertThat(same.prompt().name()).isEqualTo("script.same-speaker");

        for (LlmCall call : List.of(review, same)) {
            String payload = call.input() + call.output() + call.metadata() + call.prompt().text();
            assertThat(payload).doesNotContain(SCRIPT_WORDS);
            assertThat(call.prompt().text()).doesNotContain("지수", "민호");
        }
    }

    @Test void aSecondSplitAndTheSpeechGateStayInTheSameReviewRecord() {
        claimed(TEXT);
        FakeDecider decider = new FakeDecider();
        // 첫 판은 배역이 없어 이름 없는 대사 규칙으로 한 번 더 나눈다.
        String noCast = "대본\t예\n1\tx\t\t\n2\tx\t\t\n3\tx\t\t\n4\tx\t\t\n5\tx\t\t\n6\tx\t\t\n7\tx\t\t";
        String named = "대본\t예\n1\td\t화자1\t\n2\td\t화자2\t\n3\td\t화자1\t\n4\td\t화자2\t\n5\td\t화자1\t\n6\td\t화자2\t\n7\td\t화자2\t";

        worker(telemetry, answering(noCast, named), decider).runOnce();

        assertThat(recorded(LlmStep.SCRIPT_REVIEW)).singleElement().satisfies(review -> {
            assertThat(review.metadata()).containsEntry("passes", "2").containsEntry("speech_check", "passed")
                    .containsEntry("questions", Integer.toString(decider.decided.get() + 1));
            assertThat(review.tokens().input()).isEqualTo(10 * decider.decided.get() + 5);
        });
    }

    @Test void whenEveryQuestionFailsTheRecordIsAnErrorButTheSplitGoesOn() {
        claimed(TEXT);
        FakeDecider decider = new FakeDecider();
        decider.decision = question -> {
            throw new IllegalStateException("decision HTTP 500");
        };

        worker(telemetry, answering(ANSWER), decider).runOnce();

        verify(imports).complete(eq(job), any(), eq(importId), any(), any());
        assertThat(recorded(LlmStep.SCRIPT_REVIEW)).singleElement().satisfies(review -> {
            assertThat(review.errorMessage()).isEqualTo("IllegalStateException");
            assertThat(review.metadata()).containsEntry("failed", review.metadata().get("questions"));
        });
    }

    @Test void aReviewThatBlowsUpIsStillRecordedAndTheJobFailsAsBefore() {
        claimed(TEXT);
        doThrow(new IllegalStateException("db down")).when(imports).percent(eq(importId), intThat(percent -> percent > ScriptSplitProgress.FILLED && percent <= ScriptSplitProgress.REVIEWED));

        worker(telemetry, answering(ANSWER), new FakeDecider()).runOnce();

        verify(imports).fail(eq(job), any(), eq(importId), eq(ScriptImportFailure.FAILED), anyBoolean(), any());
        assertThat(recorded(LlmStep.SCRIPT_REVIEW)).singleElement()
                .satisfies(review -> assertThat(review.errorMessage()).isEqualTo("IllegalStateException"));
    }

    @Test void aFailingRecorderDoesNotFailTheSplit() {
        claimed(TEXT);
        LlmTelemetry broken = new LlmTelemetry() {
            @Override public void record(LlmCall call) {
                if (call.step() == LlmStep.SCRIPT_REVIEW || call.step() == LlmStep.SCRIPT_SAME_SPEAKER) throw new IllegalStateException("telemetry down");
            }

            @Override public void score(LlmScore score) {
            }
        };

        worker(broken, answering(ANSWER), new FakeDecider()).runOnce();

        verify(imports).complete(eq(job), any(), eq(importId), any(), any());
        assertThat(failures.reports()).isEmpty();
    }

    @Test void withoutDeciderNothingIsRecordedForJev() {
        claimed(TEXT);
        new ScriptSplitWorker(ledger, imports, answering(ANSWER), telemetry, failures, clock).runOnce();
        assertThat(recorded(LlmStep.SCRIPT_REVIEW)).isEmpty();
        assertThat(recorded(LlmStep.SCRIPT_SAME_SPEAKER)).isEmpty();
    }

    @Test void twoJobsRunningAtOnceOnOneDeciderKeepTheirOwnCounts() {
        UUID other = UUID.randomUUID();
        UUID otherImport = UUID.randomUUID();
        when(ledger.claimNext(eq(ScriptSplitWorker.KIND), any(), eq(ScriptSplitWorker.LEASE), any(), eq(true)))
                .thenReturn(new AiJobLedger.Claimed(job, user, importId, 1, null), new AiJobLedger.Claimed(other, user, otherImport, 1, null));
        String otherText = TEXT.replace("지수", "철수");
        when(imports.material(job, importId)).thenReturn(material(TEXT));
        when(imports.material(other, otherImport)).thenReturn(material(otherText));
        when(imports.complete(any(), any(), any(), any(), any())).thenReturn(ScriptImportRepository.Completion.CANCELLED);
        TextGenerator generator = (instructions, input) -> new GeneratedText(input.contains("철수") ? ANSWER.replace("지수", "철수") : ANSWER, null, "test");
        // 두 작업이 모두 질문을 시작해야 답한다 — 정말 겹친 채로 센다. 한쪽은 질문마다 재시도 1번, 다른 쪽은 3번.
        CountDownLatch overlapping = new CountDownLatch(2);
        java.util.Set<String> started = java.util.concurrent.ConcurrentHashMap.newKeySet();
        Map<String, AtomicInteger> questions = Map.of("철수", new AtomicInteger(), "지수", new AtomicInteger());
        LineDecider decider = new FakeDecider() {
            @Override public LineReview.Decision decide(LineReview.Question question, DeciderTally tally) {
                String who = question.state().contains("철수") ? "철수" : "지수";
                if (started.add(who)) overlapping.countDown();
                try {
                    assertThat(overlapping.await(10, TimeUnit.SECONDS)).isTrue();
                } catch (InterruptedException interrupted) {
                    throw new IllegalStateException(interrupted);
                }
                questions.get(who).incrementAndGet();
                for (int i = 0; i < (who.equals("철수") ? 3 : 1); i++) tally.retried(true);
                return new LineReview.Decision(null, null);
            }
        };
        ScriptSplitWorker shared = worker(telemetry, generator, decider);

        CompletableFuture.allOf(CompletableFuture.runAsync(shared::runOnce), CompletableFuture.runAsync(shared::runOnce)).join();

        assertThat(recorded(LlmStep.SCRIPT_REVIEW)).hasSize(2);
        assertThat(questions.get("지수").get()).isPositive();
        assertThat(questions.get("철수").get()).isPositive();
        LlmCall jobCall = recorded(LlmStep.SCRIPT_REVIEW).stream().filter(call -> call.practiceSessionId().equals(job)).findFirst().orElseThrow();
        LlmCall otherCall = recorded(LlmStep.SCRIPT_REVIEW).stream().filter(call -> call.practiceSessionId().equals(other)).findFirst().orElseThrow();
        assertThat(jobCall.metadata()).containsEntry("retries_429", Integer.toString(questions.get("지수").get()));
        assertThat(otherCall.metadata()).containsEntry("retries_429", Integer.toString(3 * questions.get("철수").get()));
    }
}
