package com.acttub.actingapi.feature.memory.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.platform.schema.ActorMemoryField;
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

    private static MemoryUpdateWorker worker(RecordingQueue queue, String extracted) {
        return new MemoryUpdateWorker(
                new EmptyMemory(),
                queue,
                new ObjectMapper(),
                (system, user) -> new GeneratedText(extracted, new TokenUsage(0, 0, 0)),
                Clock.fixed(Instant.EPOCH, ZoneOffset.UTC));
    }

    /** 잡 하나를 내주고, 성공으로 닫을 때 넘어온 본문을 잡아 둔다. */
    private static final class RecordingQueue implements MemoryUpdateQueue {
        private JsonNode payload;
        private boolean claimed;

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
            payload = responsePayload;
        }

        @Override
        public void fail(UUID operationId, UUID leaseToken, String errorCode, Instant now) {
            throw new AssertionError("성공 경로에서 실패로 닫으면 안 된다: " + errorCode);
        }
    }

    /** 기억이 비어 있고 쓰는 족족 받아들이는 저장소 — 여기 관심사는 응답 바이트뿐이다. */
    private static final class EmptyMemory implements MemoryRepository {

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
}
