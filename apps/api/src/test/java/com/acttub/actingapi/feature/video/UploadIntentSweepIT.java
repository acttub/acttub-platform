package com.acttub.actingapi.feature.video;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.video.app.VideoRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 시한 지난 올리기 예약을 닫는 주기 작업의 저장소 쪽({@code VideoRepository.sweepExpiredIntents}). 옛 분석 워커의 정리와 함께
 * 돌던 동안의 시험은 옛 워커와 함께 지웠다(SOMA-1140). 정리는 사용자를 가리지 않으므로 같은 컨텍스트의 다른 테스트가 남긴 행도
 * 닫을 수 있다 — 그래서 이 테스트의 사용자 행만 센다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
class UploadIntentSweepIT {
    private static final Instant NOW = Instant.parse("2026-11-25T03:00:00Z");

    @Autowired JdbcTemplate jdbc;
    @Autowired VideoRepository videos;

    private UUID userId;

    @BeforeEach
    void user() {
        userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id,email,status) VALUES (?,?,'active')", userId, userId + "@example.test");
    }

    @Test
    @DisplayName("practice.record 예약 정리: 시한 지난 pending 예약만 닫고 객체 삭제를 장부에 올린다")
    void theNewSweepClosesTheSameIntentsAsTheOldOne() {
        List<UUID> expired = List.of(pending(NOW.minusSeconds(120)), pending(NOW.minusSeconds(1)));
        UUID active = pending(NOW.plusSeconds(60));
        UUID finalized = finalized();
        int ledgerBefore = ledger();

        videos.sweepExpiredIntents(NOW);

        assertThat(ledger() - ledgerBefore).isEqualTo(2);
        assertThat(status(expired.get(0))).isEqualTo("expired");
        assertThat(status(expired.get(1))).isEqualTo("expired");
        assertThat(status(active)).isEqualTo("pending");
        assertThat(status(finalized)).isEqualTo("finalized");
        // 이미 닫힌 예약은 다시 닫지 않는다.
        videos.sweepExpiredIntents(NOW);
        assertThat(ledger() - ledgerBefore).isEqualTo(2);
    }

    private UUID pending(Instant expiresAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents (id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at)
                VALUES (?,?,'pending','s3',?,'video/mp4',1,?)
                """, id, userId, key(id), expiresAt.atOffset(ZoneOffset.UTC));
        return id;
    }

    private UUID finalized() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents (id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at)
                VALUES (?,?,'finalized','s3',?,'video/mp4',1,?)
                """, id, userId, key(id), NOW.minusSeconds(60).atOffset(ZoneOffset.UTC));
        return id;
    }

    private static String key(UUID intent) {
        return "uploads/" + intent + ".mp4";
    }

    private String status(UUID intent) {
        return jdbc.queryForObject("SELECT status FROM upload_intents WHERE id=?", String.class, intent);
    }

    private int ledger() {
        return jdbc.queryForObject(
                "SELECT count(*) FROM account_cleanup_operations WHERE user_id=? AND kind='object_delete'",
                Integer.class, userId);
    }
}
