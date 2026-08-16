package com.acttub.actingapi.memory;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.schema.ActorMemoryField;
import com.acttub.actingapi.llm.TextGenerator;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 연습이 끝난 뒤 배우 기억을 뒤에서 갱신한다 (`acting-api/memory_worker.py`).
 *
 * <p>연습 마무리 응답 안에서 처리하지 않는 이유는 속도다. 그 화면은 이미 성적표를
 * 만드느라 느린데 거기에 모델 호출을 하나 더 얹으면 배우가 그만큼 더 기다린다. 분석이
 * 쓰던 작업 큐에 종류만 하나 더해 얹었다 — lease·재시도·실패 처리가 이미 거기 있다.
 *
 * <p><b>기억 갱신이 실패해도 연습은 정상이다.</b> 그래서 실패해도 연습 상태를 건드리지
 * 않는다. 배우 입장에서 기억은 있으면 좋은 것이지, 없다고 연습이 망가질 것은 아니다.
 */
@Component
public class MemoryUpdateWorker {
    static final Duration DEFAULT_LEASE = Duration.ofMinutes(5);
    private static final Logger LOG = LoggerFactory.getLogger(MemoryUpdateWorker.class);

    private final MemoryStore memory;
    private final MemoryUpdateQueue queue;
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final TextGenerator generator;
    private final Clock clock;

    public MemoryUpdateWorker(
            MemoryStore memory,
            MemoryUpdateQueue queue,
            JdbcTemplate jdbc,
            ObjectMapper mapper,
            TextGenerator generator,
            Clock clock) {
        this.memory = memory;
        this.queue = queue;
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.generator = generator;
        this.clock = clock;
    }

    public boolean runOnce() {
        return runOnce(clock.instant());
    }

    /** 큐에서 하나 집어 처리한다. 집을 게 없으면 false. */
    public boolean runOnce(Instant now) {
        UUID leaseToken = UUID.randomUUID();
        UUID operationId = queue.claimNext(leaseToken, DEFAULT_LEASE, now);
        if (operationId == null) {
            return false;
        }
        UUID sessionId = sessionId(operationId);
        try {
            List<String> written = update(sessionId, now);
            complete(operationId, leaseToken, sessionId, written, now);
        } catch (LeaseOwnershipException lost) {
            LOG.warn("기억 갱신 lease 를 잃었다: {}", operationId);
        } catch (RuntimeException failure) {
            LOG.warn("기억 갱신 실패: {}", operationId, failure);
            try {
                // 연습 자체는 건드리지 않는다 — 그 선택은 큐 계약에 적혀 있다.
                queue.fail(operationId, leaseToken, "memory_update_failed", now);
            } catch (LeaseOwnershipException lostWhileFailing) {
                LOG.warn("기억 갱신 실패 처리 중 lease 를 잃었다: {}", operationId);
            }
        }
        return true;
    }

    private List<String> update(UUID practiceSessionId, Instant now) {
        MemoryStore.MemoryUpdateMaterial material = memory.material(practiceSessionId);
        if (material == null) {
            LOG.info("기억 갱신 재료가 없다(연습이 지워졌을 수 있다): {}", practiceSessionId);
            return List.of();
        }
        Map<String, String> existing = new LinkedHashMap<>();
        memory.list(material.userId()).forEach(row -> existing.put(row.field(), row.value()));

        Map<String, String> updates = MemoryExtractor.extract(
                material,
                existing,
                (system, user) -> generator.generate(system, user).text());

        List<String> written = new ArrayList<>();
        updates.forEach((name, value) -> {
            MemoryStore.MemoryRow row = memory.writeAsAgent(
                    material.userId(),
                    ActorMemoryField.valueOf(name.toUpperCase(java.util.Locale.ROOT)),
                    value,
                    material.practiceSessionId());
            // null 이면 배우가 직접 고친 칸이라 저장 계층이 건너뛴 것이다.
            if (row != null) {
                written.add(name);
            }
        });
        return written;
    }

    private UUID sessionId(UUID operationId) {
        return jdbc.queryForObject(
                "SELECT session_id FROM external_operations WHERE id=?", UUID.class, operationId);
    }

    private void complete(
            UUID operationId, UUID leaseToken, UUID sessionId, List<String> written, Instant now) {
        ObjectNode response = mapper.createObjectNode();
        response.put("practice_session_id", sessionId.toString());
        ArrayNode fields = response.putArray("updated_fields");
        written.forEach(fields::add);
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
}
