package com.acttub.actingapi.platform.operation;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.memory.app.MemoryUpdateQueue;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.fasterxml.jackson.databind.JsonNode;
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
 * 때마다 그 둘을 다시 정하지 않는다. <b>응답 본문은 받아서 그대로 싣기만 한다</b> — 그 바이트가
 * 곧 계약이므로 조립은 부르는 쪽에 남는다({@code coach}·{@code report} 의 원장 포트와 같다).
 */
@Component
class ExternalOperationMemoryQueue implements MemoryUpdateQueue {

    /** 원장의 작업 종류. {@code operation_kind_t} 의 값이며 파이썬과 같다. */
    private static final String KIND = "memory_update";

    private final ExternalOperationClaimer claimer;
    private final JdbcTemplate jdbc;

    ExternalOperationMemoryQueue(ExternalOperationClaimer claimer, JdbcTemplate jdbc) {
        this.claimer = claimer;
        this.jdbc = jdbc;
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
            UUID operationId, UUID leaseToken, JsonNode responsePayload, Instant now) {
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
                """, responsePayload.toString(), OffsetDateTime.ofInstant(now, ZoneOffset.UTC),
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
