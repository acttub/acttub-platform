package com.acttub.actingapi.feature.profile.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.portfolio.app.PortfolioPhotoCleanup;
import com.acttub.actingapi.feature.profile.app.AccountCleanup;
import com.acttub.actingapi.feature.profile.app.AccountCleanupRepository;
import com.acttub.actingapi.feature.reading.app.ReadingRecordingCleanup;
import com.acttub.actingapi.feature.video.app.VideoObjectCleanup;
import com.acttub.actingapi.platform.security.AccountSecrets;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 정리 장부({@code account_cleanup_operations})에 행을 올리는 한 자리. 탈퇴·3년 파기·사진 교체(프로필)와
 * 사진 삭제(포트폴리오), 리딩 녹음 객체 삭제(대본·회차 삭제), 영상 삭제·파일만 파기·만료된 미확정 업로드(보관함)가
 * 같은 문장을 쓴다.
 *
 * <p>⚠ <b>트랜잭션을 열지 않는다.</b> 키를 덮거나 행을 지우는 쪽의 트랜잭션에 참여해야 한다 — 따로
 * 커밋되면 "키는 사라졌는데 장부에는 없는" 객체가 다시 생긴다. 부르는 쪽에 트랜잭션이 없으면
 * {@code executeUpdate} 가 거절한다.
 */
@Repository
class PostgresObjectCleanupLedger implements PortfolioPhotoCleanup, ReadingRecordingCleanup, VideoObjectCleanup {
    private static final ObjectMapper JSON = new ObjectMapper();

    private final EntityManager entityManager;
    private final AccountSecrets secrets;
    private final AccountCleanup cleanup;

    PostgresObjectCleanupLedger(EntityManager entityManager, AccountSecrets secrets, AccountCleanup cleanup) {
        this.entityManager = entityManager;
        this.secrets = secrets;
        this.cleanup = cleanup;
    }

    @Override
    public UUID schedule(UUID userId, List<String> objectKeys, Instant now, Instant notBefore) {
        return enqueue(userId, "object_delete", secrets.encrypt(json(objectKeys)), now, notBefore);
    }

    /** 리딩 녹음 객체. 올리기 주소가 없는 객체라(서버 경유 저장) 바로 지워도 된다. */
    @Override
    public UUID schedule(UUID userId, List<String> objectKeys, Instant now) {
        return enqueue(userId, "reading_recording_delete", secrets.encrypt(json(objectKeys)), now, now);
    }

    /** 영상 객체. 올리기 주소가 아직 살아 있으면 그 시한 뒤에 지운다(practice.record). */
    @Override
    public UUID scheduleObjectDelete(UUID userId, List<String> objectKeys, Instant now, Instant notBefore) {
        return schedule(userId, objectKeys, now, notBefore);
    }

    @Override
    public void attemptObjectDelete(List<UUID> operationIds) {
        cleanup.attempt(operationIds);
    }

    @Override
    public void attempt(List<UUID> operationIds) {
        cleanup.attempt(operationIds);
    }

    /** @param payloadEncrypted 이미 암호문이다. 평문을 넣지 않는다 */
    UUID enqueue(UUID userId, String kind, String payloadEncrypted, Instant now, Instant notBefore) {
        UUID id = UUID.randomUUID();
        Instant firstAttempt = notBefore.isAfter(now) ? notBefore : now;
        entityManager.createNativeQuery("""
                INSERT INTO account_cleanup_operations(
                    id,user_id,kind,payload_encrypted,next_attempt_at,expires_at,created_at,updated_at)
                VALUES (:id,:userId,:kind,:payload,:firstAttempt,:expiresAt,:now,:now)
                """)
                .setParameter("id", id)
                .setParameter("userId", userId)
                .setParameter("kind", kind)
                .setParameter("payload", payloadEncrypted)
                .setParameter("firstAttempt", firstAttempt.atOffset(ZoneOffset.UTC))
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("expiresAt",
                        firstAttempt.plus(AccountCleanupRepository.RETRY_WINDOW).atOffset(ZoneOffset.UTC))
                .executeUpdate();
        return id;
    }

    private static String json(List<String> values) {
        try {
            return JSON.writeValueAsString(values);
        } catch (Exception failure) {
            throw new IllegalStateException("failed to write object keys", failure);
        }
    }
}
