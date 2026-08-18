package com.acttub.actingapi.feature.practice.app;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.domain.AnalysisStatus;
import com.acttub.actingapi.feature.practice.domain.PracticeSession;
import com.acttub.actingapi.feature.practice.domain.SessionDetail;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.CanonicalJson;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;

/**
 * 연습 세션의 규칙. HTTP 도 SQL 도 모르며, 요청 하나가 어떤 순서로 무엇을 확인하고 무엇을
 * 남기는지만 안다.
 *
 * <p>없음·충돌을 {@link ApiException} 으로 던진다. 배관(web)의 타입이지만 다른 feature 의 것이
 * 아니므로 도메인 사이의 결합은 아니다 — 이 예외를 상태코드와 본문으로 옮기는 일은
 * {@code web/ApiErrorAdvice} 하나가 맡고 있고, 그 형태가 곧 계약이다.
 */
@Service
public class PracticeSessionService {

    /** 재생 서명 주소의 수명. 파이썬과 같은 15분이고, 응답에 그대로 실린다. */
    private static final int PLAYBACK_URL_TTL_SECONDS = 15 * 60;

    private final PracticeSessionLedger operations;
    private final PracticeSessionRepository sessions;
    private final PracticePlayback playback;
    private final Clock clock;
    private final CanonicalJson canonical;

    public PracticeSessionService(
            PracticeSessionLedger operations,
            PracticeSessionRepository sessions,
            PracticePlayback playback,
            Clock clock,
            CanonicalJson canonical) {
        this.operations = operations;
        this.sessions = sessions;
        this.playback = playback;
        this.clock = clock;
        this.canonical = canonical;
    }

    /**
     * 세션을 만들고 분석을 건다.
     *
     * <p>업로드 의도의 실재를 먼저 확인하는 이유는 응답이 달라서다 — 없으면 404,
     * 있으나 아직 확정되지 않았으면 409 다.
     */
    public AnalysisOutcome create(UUID userId, NewPracticeSession command, UUID requestId) {
        if (!sessions.uploadExists(userId, command.uploadIntentId())) {
            throw new ApiException(404, "upload_intent_not_found");
        }
        // 이어받을 연습은 이 배우의 보이는 연습이어야 한다 — 남의 연습이나 숨긴 연습을
        // 지정해 그 대화를 끌어오는 길을 여기서 막는다.
        if (command.continuedFrom() != null
                && sessions.status(userId, command.continuedFrom()) == null) {
            throw new ApiException(404, "practice_session_not_found");
        }
        PracticeSessionOperation result = operations.createWithAnalysis(
                userId,
                command.uploadIntentId(),
                command.situation(),
                command.characterContext(),
                command.goal(),
                command.blockageKind(),
                command.subBranch(),
                command.blockageDetail(),
                command.continuedFrom(),
                requestId,
                createFingerprint(command));
        if (result == null) {
            throw new ApiException(409, "upload_intent_not_finalized");
        }
        return outcome(result, userId);
    }

    public List<PracticeSession> list(UUID userId) {
        return sessions.list(userId);
    }

    public AnalysisStatus status(UUID userId, UUID sessionId) {
        AnalysisStatus status = sessions.status(userId, sessionId);
        if (status == null) {
            throw new ApiException(404, "practice_session_not_found");
        }
        return status;
    }

    /**
     * 상세와 재생 주소.
     *
     * <p>요약은 분석이 끝난 세션에만 딸려 나간다. 실패했다가 재분석 중인 세션에도 지난 요약 행이
     * 남아 있어, 상태를 보지 않으면 낡은 관찰을 현재의 것처럼 실어 보내게 된다.
     */
    public PlayableSession detail(UUID userId, UUID sessionId) {
        SessionDetail detail = sessions.detail(userId, sessionId);
        if (detail == null) {
            throw new ApiException(404, "practice_session_not_found");
        }
        PracticeSession session = detail.session();
        return new PlayableSession(
                session,
                playback.url(detail.objectKey(), PLAYBACK_URL_TTL_SECONDS),
                session.analyzed() ? detail.summary() : null,
                detail.errorCode());
    }

    /**
     * 실패한 세션의 분석을 다시 건다.
     *
     * <p>원장이 작업을 만들지 못했을 때 비로소 세션을 찾아본다 — 실패 이유가 "그런 세션이 없다"와
     * "실패 상태가 아니다" 둘이고, 정상 경로에서는 둘 다 확인할 필요가 없다.
     */
    public AnalysisOutcome reanalyze(UUID userId, UUID sessionId, UUID requestId) {
        PracticeSessionOperation result = operations.createAnalysisRetry(
                userId,
                sessionId,
                requestId,
                retryFingerprint(sessionId),
                clock.instant());
        if (result == null) {
            if (sessions.find(userId, sessionId) == null) {
                throw new ApiException(404, "practice_session_not_found");
            }
            throw new ApiException(409, "session_is_not_failed");
        }
        return outcome(result, userId);
    }

    /** 목록에서 감춘다. 행은 남는다 — 분석 산출물이 세션을 참조하고 있다. */
    public void delete(UUID userId, UUID sessionId) {
        OffsetDateTime now = clock.instant().atOffset(ZoneOffset.UTC);
        if (!sessions.hide(userId, sessionId, now)) {
            throw new ApiException(404, "practice_session_not_found");
        }
    }

    /**
     * 원장에 남은 작업의 상태를 응답으로 옮긴다.
     *
     * <p>같은 요청 ID 로 다시 들어온 요청은 여기서 갈린다. 지문이 다르면 같은 ID 를 다른 내용에
     * 재사용한 것이므로 422 다.
     */
    private AnalysisOutcome outcome(PracticeSessionOperation result, UUID userId) {
        if (result.fingerprintMismatch()) {
            throw new ApiException(422, "request_fingerprint_mismatch");
        }
        if (result.created()) {
            return new AnalysisOutcome.Accepted(result.session().id());
        }
        ExternalOperationRow operation = result.operation();
        return switch (operation.status()) {
            case "succeeded" -> {
                JsonNode stored = operation.responsePayload();
                yield stored == null || stored.isEmpty()
                        ? new AnalysisOutcome.Completed(
                                result.session().id(), result.session().status())
                        : new AnalysisOutcome.Replayed(stored);
            }
            case "pending", "running" -> new AnalysisOutcome.Accepted(operation.sessionId());
            case "failed" -> {
                boolean resumed = sessions.resumeFailedOperation(
                        userId, operation.id(), clock.instant().atOffset(ZoneOffset.UTC));
                if (!resumed) {
                    throw new ApiException(409, "analysis_retry_exhausted");
                }
                yield new AnalysisOutcome.Accepted(operation.sessionId());
            }
            default -> throw new ApiException(409, "invalid_operation_state");
        };
    }

    /**
     * 요청 지문. <b>키 순서가 계약이다</b> — 파이썬이 이 순서로 만든 해시가 이미 원장에 쌓여 있어,
     * 순서를 바꾸면 같은 요청이 새 작업으로 갈린다.
     */
    private String createFingerprint(NewPracticeSession command) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("upload_intent_id", command.uploadIntentId().toString());
        payload.put("situation", command.situation());
        payload.put("character_context", command.characterContext());
        payload.put("goal", command.goal());
        payload.put("blockage_kind", command.blockageKind());
        payload.put("sub_branch", command.subBranch());
        payload.put("blockage_detail", command.blockageDetail());
        // 있을 때만 넣는다 — 무조건 넣으면 이 키가 없던 시절의 해시와 어긋나
        // 같은 요청이 새 작업으로 갈린다.
        if (command.continuedFrom() != null) {
            payload.put("continued_from", command.continuedFrom().toString());
        }
        return fingerprint(payload);
    }

    private String retryFingerprint(UUID sessionId) {
        return fingerprint(Map.of("session_id", sessionId.toString()));
    }

    private String fingerprint(Map<String, Object> payload) {
        byte[] bytes = canonical.bytes(Map.of("kind", "analyze", "payload", payload));
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
