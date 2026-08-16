package com.acttub.actingapi.operation;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.memory.app.MemoryUpdateQueue;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * memory 가 선언한 {@link MemoryUpdateQueue} 를 분석과 공용으로 쓰는 External Operation 원장으로
 * 채운다 (ADR-017, SOMA-397 6단계).
 *
 * <p><b>원장 쪽에 산다.</b> 쓰는 쪽이 무엇을 요구하는지 선언하고 제공하는 쪽이 그것을 구현하므로,
 * memory 는 이 클래스도 {@link ExternalOperationClaimer} 도 모른다.
 *
 * <p>작업 종류 문자열과 "연습을 실패시키지 않는다"는 선택이 여기서 고정된다. 워커는 호출할
 * 때마다 그 둘을 다시 정하지 않는다. <b>응답 페이로드의 키도 여기서 정해진다</b> — 그 바이트는
 * 원장에 남아 재생될 때 그대로 나가므로, 원장 형식을 아는 쪽이 적는 것이 맞다.
 */
@Component
class ExternalOperationMemoryQueue implements MemoryUpdateQueue {

    /** 원장의 작업 종류. {@code operation_kind_t} 의 값이며 파이썬과 같다. */
    private static final String KIND = "memory_update";

    private final ExternalOperationClaimer claimer;
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    ExternalOperationMemoryQueue(
            ExternalOperationClaimer claimer, JdbcTemplate jdbc, ObjectMapper mapper) {
        this.claimer = claimer;
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @Override
    public UUID claimNext(UUID leaseToken, Duration duration, Instant now) {
        return claimer.claimNext(KIND, leaseToken, duration, now);
    }

    @Override
    public UUID practiceSessionOf(UUID operationId) {
        return jdbc.queryForObject(
                "SELECT session_id FROM external_operations WHERE id=?", UUID.class, operationId);
    }

    @Override
    public void complete(
            UUID operationId,
            UUID leaseToken,
            UUID practiceSessionId,
            List<String> updatedFields,
            Instant now) {
        ObjectNode response = mapper.createObjectNode();
        response.put("practice_session_id", practiceSessionId.toString());
        ArrayNode fields = response.putArray("updated_fields");
        updatedFields.forEach(fields::add);
        int finished = jdbc.update("""
                UPDATE external_operations
                SET status = 'succeeded'::operation_status_t,
                    response_payload = ?::jsonb,
                    error_code = NULL,
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    updated_at = ?
                WHERE id = ?
                  AND status = 'running'::operation_status_t
                  AND lease_token = ?
                """, response.toString(), OffsetDateTime.ofInstant(now, ZoneOffset.UTC),
                operationId, leaseToken);
        if (finished == 0) {
            throw new LeaseOwnershipException("external operation lease is not owned");
        }
    }

    @Override
    public void fail(UUID operationId, UUID leaseToken, String errorCode, Instant now) {
        claimer.fail(operationId, leaseToken, errorCode, false, now);
    }
}
