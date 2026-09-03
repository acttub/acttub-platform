package com.acttub.actingapi.feature.memory.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.schema.ActorMemoryField;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 기억 갱신이 성공으로 닫힐 때 원장에 남는 <b>응답 바이트</b>를 못박는다.
 *
 * <p><b>이 자리는 응답을 맞대는 검사의 사각지대다.</b> 페이로드가 백그라운드에서 만들어져
 * 원장에 남았다가 <b>나중에</b> 응답으로 나가므로, 엔드포인트를 때려 보는 검사는 이것에 닿지
 * 못한다(사라진 계약 하네스도 참·거짓만 비교했다). 그래서 조용히 달라질 수 있다 — 그런데
 * 그 바이트는 잡이 재생될 때 그대로 응답으로 나간다.
 *
 * <p>정본은 파이썬 {@code memory_worker.py:run_once} 의
 * {@code {"practice_session_id": str(...), "updated_fields": [...]}} 이고, 키 이름과 순서까지
 * 그것과 같아야 한다.
 */
class MemoryUpdateWorkerPayloadTest {

    private static final UUID SESSION = UUID.fromString("11111111-2222-3333-4444-555555555555");
    private static final UUID OPERATION = UUID.fromString("99999999-8888-7777-6666-555555555555");

    @Test
    @DisplayName("성공 페이로드는 연습 식별자와 갱신된 칸을 파이썬과 같은 순서로 담는다")
    void payloadKeepsPythonShape() {
        RecordingQueue queue = new RecordingQueue();
        worker(queue, "{\"goal\":\"새 목표\",\"speech_self\":\"새 화법\"}").runOnce();

        assertThat(queue.payload.toString()).isEqualTo(
                "{\"practice_session_id\":\"11111111-2222-3333-4444-555555555555\","
                        + "\"updated_fields\":[\"goal\",\"speech_self\"]}");
    }

    @Test
    @DisplayName("갱신된 칸이 없어도 빈 배열로 남는다 — 키가 빠지지 않는다")
    void payloadKeepsEmptyArray() {
        RecordingQueue queue = new RecordingQueue();
        worker(queue, "{}").runOnce();

        assertThat(queue.payload.toString()).isEqualTo(
                "{\"practice_session_id\":\"11111111-2222-3333-4444-555555555555\","
                        + "\"updated_fields\":[]}");
    }

    @Test
    void updateFailureFailsTheOperationAndIsReported() {
        RuntimeException failure = new IllegalStateException("memory unavailable");
        RecordingQueue queue = new RecordingQueue();
        RecordingFailureReporter reporter = new RecordingFailureReporter();

        worker(queue, new FailingMemory(failure), "{}", reporter).runOnce();

        assertThat(queue.transitions).containsExactly("fail:memory_update_failed");
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(failure);
            assertThat(report.kind()).isEqualTo(FailureKind.UNEXPECTED);
            assertThat(report.context())
                    .isEqualTo("MemoryUpdateWorker.update operation_id=" + OPERATION);
        });
    }

    @Test
    void leaseOwnershipLossWhileCompletingOrFailingIsReported() {
        RecordingQueue completing = new RecordingQueue();
        LeaseOwnershipException completeLoss = new LeaseOwnershipException("complete stolen");
        completing.completeFailure = completeLoss;
        RecordingFailureReporter completeReporter = new RecordingFailureReporter();

        worker(completing, new EmptyMemory(), "{}", completeReporter).runOnce();

        assertThat(completeReporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(completeLoss);
            assertThat(report.context())
                    .isEqualTo("MemoryUpdateWorker.complete operation_id=" + OPERATION);
        });

        RuntimeException updateFailure = new IllegalStateException("memory unavailable");
        RecordingQueue failing = new RecordingQueue();
        LeaseOwnershipException failLoss = new LeaseOwnershipException("fail stolen");
        failing.failFailure = failLoss;
        RecordingFailureReporter failReporter = new RecordingFailureReporter();

        worker(failing, new FailingMemory(updateFailure), "{}", failReporter).runOnce();

        assertThat(failReporter.reports())
                .extracting(RecordingFailureReporter.Report::failure)
                .containsExactly(updateFailure, failLoss);
        assertThat(failReporter.reports())
                .extracting(RecordingFailureReporter.Report::context)
                .containsExactly(
                        "MemoryUpdateWorker.update operation_id=" + OPERATION,
                        "MemoryUpdateWorker.fail operation_id=" + OPERATION);
    }

    private static MemoryUpdateWorker worker(RecordingQueue queue, String extracted) {
        return worker(
                queue, new EmptyMemory(), extracted, new RecordingFailureReporter());
    }

    private static MemoryUpdateWorker worker(
            RecordingQueue queue,
            MemoryRepository memory,
            String extracted,
            RecordingFailureReporter reporter) {
        return new MemoryUpdateWorker(
                memory,
                queue,
                new ObjectMapper(),
                (system, user) -> new GeneratedText(extracted, new TokenUsage(0, 0, 0)),
                Clock.fixed(Instant.EPOCH, ZoneOffset.UTC),
                new MemoryExtractor(reporter),
                reporter);
    }

    /** 잡 하나를 내주고, 성공으로 닫을 때 넘어온 본문을 잡아 둔다. */
    private static final class RecordingQueue implements MemoryUpdateQueue {
        private JsonNode payload;
        private boolean claimed;
        private final List<String> transitions = new ArrayList<>();
        private RuntimeException completeFailure;
        private RuntimeException failFailure;

        @Override
        public UUID claimNext(UUID leaseToken, Duration duration, Instant now) {
            if (claimed) {
                return null;
            }
            claimed = true;
            return OPERATION;
        }

        @Override
        public UUID practiceSessionOf(UUID operationId) {
            return SESSION;
        }

        @Override
        public void complete(
                UUID operationId, UUID leaseToken, JsonNode responsePayload, Instant now) {
            if (completeFailure != null) {
                throw completeFailure;
            }
            payload = responsePayload;
        }

        @Override
        public void fail(UUID operationId, UUID leaseToken, String errorCode, Instant now) {
            transitions.add("fail:" + errorCode);
            if (failFailure != null) {
                throw failFailure;
            }
        }
    }

    /** 기억이 비어 있고 쓰는 족족 받아들이는 저장소 — 여기 관심사는 응답 바이트뿐이다. */
    private static class EmptyMemory implements MemoryRepository {

        @Override
        public List<MemoryEntry> list(UUID userId) {
            return List.of();
        }

        @Override
        public MemoryEntry writeAsActor(UUID userId, ActorMemoryField field, String value) {
            throw new AssertionError("워커는 배우 이름으로 쓰지 않는다");
        }

        @Override
        public MemoryEntry writeAsAgent(
                UUID userId, ActorMemoryField field, String value, UUID sourcePracticeSessionId) {
            return new MemoryEntry(field.dbValue(), value, false, sourcePracticeSessionId);
        }

        @Override
        public void delete(UUID userId, ActorMemoryField field) {
            throw new AssertionError("워커는 지우지 않는다");
        }

        @Override
        public MemoryUpdateMaterial material(UUID practiceSessionId) {
            return new MemoryUpdateMaterial(
                    UUID.randomUUID(), practiceSessionId, "목표", "분석", "캐릭터 분석", null,
                    List.of(), List.of());
        }
    }

    private static final class FailingMemory extends EmptyMemory {
        private final RuntimeException failure;

        private FailingMemory(RuntimeException failure) {
            this.failure = failure;
        }

        @Override
        public MemoryUpdateMaterial material(UUID practiceSessionId) {
            throw failure;
        }
    }
}
