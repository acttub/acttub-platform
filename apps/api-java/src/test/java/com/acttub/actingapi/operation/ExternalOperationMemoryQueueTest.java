package com.acttub.actingapi.operation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 기억 갱신이 성공으로 닫힐 때 원장에 남는 <b>응답 바이트</b>를 못박는다.
 *
 * <p><b>이 자리는 계약 하네스의 사각지대다.</b> 하네스의 DB 투영은 external_operations 를
 * {@code has_response_payload}(참·거짓)로만 비교하고, 백그라운드 워커는 contract 프로파일에서
 * 아예 뜨지 않는다. 그래서 이 페이로드는 <b>전 시나리오 diff 0 을 통과해도 조용히 달라질 수
 * 있다</b> — 그런데 그 바이트는 잡이 재생될 때 그대로 응답으로 나간다.
 *
 * <p>정본은 파이썬 {@code memory_worker.py:run_once} 의
 * {@code {"practice_session_id": str(...), "updated_fields": [...]}} 이고, 키 이름과 순서까지
 * 그것과 같아야 한다. SOMA-397 11단계가 이 조립을 워커에서 원장 쪽으로 옮겼으므로, 옮긴 자리를
 * 지키는 장치가 이 검사뿐이다.
 */
class ExternalOperationMemoryQueueTest {

    private static final UUID SESSION = UUID.fromString("11111111-2222-3333-4444-555555555555");

    @Test
    @DisplayName("성공 페이로드는 연습 식별자와 갱신된 칸을 파이썬과 같은 순서로 담는다")
    void completeWritesPythonShapedPayload() {
        CapturingJdbc jdbc = new CapturingJdbc(1);
        queue(jdbc).complete(
                UUID.randomUUID(), UUID.randomUUID(), SESSION,
                List.of("goal", "speech_self"), Instant.EPOCH);

        assertThat(jdbc.payload).isEqualTo(
                "{\"practice_session_id\":\"11111111-2222-3333-4444-555555555555\","
                        + "\"updated_fields\":[\"goal\",\"speech_self\"]}");
    }

    @Test
    @DisplayName("갱신된 칸이 없어도 빈 배열로 남는다 — 키가 빠지지 않는다")
    void completeKeepsEmptyArray() {
        CapturingJdbc jdbc = new CapturingJdbc(1);
        queue(jdbc).complete(
                UUID.randomUUID(), UUID.randomUUID(), SESSION, List.of(), Instant.EPOCH);

        assertThat(jdbc.payload).isEqualTo(
                "{\"practice_session_id\":\"11111111-2222-3333-4444-555555555555\","
                        + "\"updated_fields\":[]}");
    }

    @Test
    @DisplayName("리스를 이미 뺏겼으면 성공으로 닫지 않는다")
    void completeRefusesWhenLeaseIsGone() {
        assertThatThrownBy(() -> queue(new CapturingJdbc(0)).complete(
                UUID.randomUUID(), UUID.randomUUID(), SESSION, List.of("goal"), Instant.EPOCH))
                .isInstanceOf(LeaseOwnershipException.class);
    }

    /** {@code claimer} 는 이 연산에 쓰이지 않는다 — 성공 전이는 원장을 직접 친다. */
    private static ExternalOperationMemoryQueue queue(JdbcTemplate jdbc) {
        return new ExternalOperationMemoryQueue(null, jdbc, new ObjectMapper());
    }

    /** 페이로드 인자만 잡아 두고, 갱신된 행 수는 시험이 정한다. */
    private static final class CapturingJdbc extends JdbcTemplate {
        private final int updatedRows;
        private String payload;

        private CapturingJdbc(int updatedRows) {
            this.updatedRows = updatedRows;
        }

        @Override
        public int update(String sql, Object... args) {
            payload = (String) args[0];
            return updatedRows;
        }
    }
}
