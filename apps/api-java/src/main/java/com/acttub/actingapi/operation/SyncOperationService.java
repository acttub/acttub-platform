package com.acttub.actingapi.operation;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.web.ApiException;
import com.acttub.actingapi.web.CanonicalJson;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 동기 LLM 요청의 X-Request-Id, fingerprint, 15분 lease와 canonical replay 경계.
 *
 * <p><b>HTTP 를 모른다.</b> 재생할 응답이 있는지와 그 본문이 무엇인지까지만 정하고, 상태코드와
 * 헤더로 옮기는 일은 {@code web/CanonicalJsonResponse} 가 맡는다(SOMA-397 6단계).
 */
@Service
public class SyncOperationService {

    private static final Duration SYNC_OPERATION_LEASE = Duration.ofMinutes(15);

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final CanonicalJson canonical;
    private final ExternalOperationClaimer claimer;
    private final Clock clock;
    private final TransactionTemplate transaction;

    public SyncOperationService(
            JdbcTemplate jdbc,
            ObjectMapper mapper,
            CanonicalJson canonical,
            ExternalOperationClaimer claimer,
            Clock clock,
            PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.canonical = canonical;
        this.claimer = claimer;
        this.clock = clock;
        this.transaction = new TransactionTemplate(transactionManager);
        this.transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public UUID requestId(String header) {
        if (header == null) {
            return UUID.randomUUID();
        }
        try {
            return UUID.fromString(header);
        } catch (IllegalArgumentException exception) {
            throw new ApiException(422, "invalid X-Request-Id");
        }
    }

    public String fingerprint(String kind, Object payload) {
        ObjectNode root = mapper.createObjectNode();
        root.put("kind", kind);
        root.set("payload", mapper.valueToTree(payload));
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(canonical.bytes(root)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    public SyncOperationBegin begin(
            UUID userId,
            UUID practiceSessionId,
            UUID requestId,
            String operationKind,
            String requestFingerprint) {
        ExternalOperationRow operation = transaction.execute(status ->
                getOrCreate(
                        userId,
                        practiceSessionId,
                        requestId,
                        operationKind,
                        requestFingerprint));
        if (!operation.requestFingerprint().equals(requestFingerprint)) {
            throw new ApiException(422, "request_fingerprint_mismatch");
        }
        JsonNode cached = existingPayload(operation, requestId, clock.instant());
        if (cached != null) {
            return SyncOperationBegin.replayed(cached);
        }

        UUID leaseToken = UUID.randomUUID();
        UUID claimed = claimer.claimById(
                operation.id(), leaseToken, SYNC_OPERATION_LEASE, clock.instant());
        if (claimed == null) {
            ExternalOperationRow latest = find(userId, requestId);
            cached = existingPayload(latest, requestId, clock.instant());
            if (cached != null) {
                return SyncOperationBegin.replayed(cached);
            }
            throw new ApiException(409, "request retry exhausted");
        }
        return SyncOperationBegin.claimed(
                new SyncOperationClaim(claimed, leaseToken, requestId));
    }

    public void complete(SyncOperationClaim claim, JsonNode responsePayload) {
        OffsetDateTime now = clock.instant().atOffset(ZoneOffset.UTC);
        transaction.executeWithoutResult(status -> {
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
                    """,
                    responsePayload.toString(),
                    now,
                    claim.operationId(),
                    claim.leaseToken());
            if (finished == 0) {
                throw new LeaseOwnershipException("external operation lease is not owned");
            }
        });
    }

    public void fail(SyncOperationClaim claim, String errorCode) {
        try {
            claimer.fail(
                    claim.operationId(),
                    claim.leaseToken(),
                    errorCode,
                    false,
                    clock.instant());
        } catch (LeaseOwnershipException ignored) {
            // Python fail_sync_operation도 소유권 상실을 원래 예외보다 앞세우지 않는다.
        }
    }

    public Instant now() {
        return clock.instant();
    }

    private ExternalOperationRow getOrCreate(
            UUID userId,
            UUID practiceSessionId,
            UUID requestId,
            String kind,
            String requestFingerprint) {
        List<UUID> owned = jdbc.queryForList("""
                SELECT id
                FROM practice_sessions
                WHERE id = ? AND user_id = ?
                """, UUID.class, practiceSessionId, userId);
        if (owned.isEmpty()) {
            throw new IllegalStateException("practice session not found");
        }
        UUID operationId = UUID.randomUUID();
        jdbc.query("""
                INSERT INTO external_operations (
                    id, session_id, user_id, request_id, kind, request_fingerprint
                )
                VALUES (?, ?, ?, ?, ?::operation_kind_t, ?)
                ON CONFLICT (user_id, request_id) DO NOTHING
                RETURNING id
                """, (row, number) -> row.getObject("id", UUID.class),
                operationId,
                practiceSessionId,
                userId,
                requestId,
                kind,
                requestFingerprint);
        ExternalOperationRow operation = find(userId, requestId);
        if (operation == null) {
            throw new IllegalStateException("external operation is missing");
        }
        return operation;
    }

    private ExternalOperationRow find(UUID userId, UUID requestId) {
        List<ExternalOperationRow> rows = jdbc.query("""
                SELECT
                    id, session_id, user_id, request_id,
                    kind::text AS kind, status::text AS status,
                    attempt_count, request_fingerprint, lease_token, lease_expires_at,
                    error_code, response_payload::text AS response_payload,
                    created_at, updated_at
                FROM external_operations
                WHERE user_id = ? AND request_id = ?
                """, (row, number) -> new ExternalOperationRow(
                row.getObject("id", UUID.class),
                row.getObject("session_id", UUID.class),
                row.getObject("user_id", UUID.class),
                row.getObject("request_id", UUID.class),
                row.getString("kind"),
                row.getString("status"),
                row.getInt("attempt_count"),
                row.getString("request_fingerprint"),
                row.getObject("lease_token", UUID.class),
                instant(row.getObject("lease_expires_at", OffsetDateTime.class)),
                row.getString("error_code"),
                json(row.getString("response_payload")),
                instant(row.getObject("created_at", OffsetDateTime.class)),
                instant(row.getObject("updated_at", OffsetDateTime.class))),
                userId,
                requestId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    /** 다시 실어 보낼 본문. 없으면 {@code null} 이고, 아직 처리 중이면 409 다. */
    private JsonNode existingPayload(
            ExternalOperationRow operation, UUID requestId, Instant now) {
        if (operation == null) {
            return null;
        }
        if ("succeeded".equals(operation.status())) {
            return operation.responsePayload() == null
                    ? mapper.createObjectNode()
                    : operation.responsePayload();
        }
        if ("running".equals(operation.status())
                && operation.leaseToken() != null
                && operation.leaseExpiresAt() != null
                && !operation.leaseExpiresAt().isBefore(now)) {
            throw new ApiException(
                    409,
                    "request is still processing",
                    Map.of("X-Request-Id", requestId.toString()));
        }
        return null;
    }

    private JsonNode json(String value) {
        if (value == null) {
            return null;
        }
        try {
            return mapper.readTree(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("external operation contains invalid JSON", exception);
        }
    }

    private static Instant instant(OffsetDateTime value) {
        return value == null ? null : value.toInstant();
    }
}
