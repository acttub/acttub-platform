package com.acttub.actingapi.feature.video;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.analysis.adapter.db.PostgresAnalysisStore;
import com.acttub.actingapi.feature.video.app.VideoRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 시한 지난 올리기 예약을 닫는 두 길 — 옛 분석 워커의 정리({@code PostgresAnalysisStore.sweepExpiredUploads})와 새 주기 작업
 * ({@code VideoRepository.sweepExpiredIntents}) — 이 같은 행을 다룬다. 옛 워커를 지울 때까지 둘이 함께 돈다.
 *
 * <p>옛 쪽은 닫은 예약의 객체 키를 돌려주고(그 자리에서 객체를 지운다), 새 쪽은 객체 삭제를 장부에 올린다. 한 예약을 두 쪽이
 * 함께 닫으면 두 수의 합이 예약 수를 넘는다. 두 정리 모두 사용자를 가리지 않으므로 같은 컨텍스트의 다른 테스트가 남긴 행도
 * 닫을 수 있다 — 그래서 이 테스트의 사용자 행만 센다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
class UploadIntentSweepIT {
    private static final Instant NOW = Instant.parse("2026-11-25T03:00:00Z");

    @Autowired JdbcTemplate jdbc;
    @Autowired PostgresAnalysisStore oldSweep;
    @Autowired VideoRepository videos;

    private UUID userId;

    @BeforeEach
    void user() {
        userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id,email,status) VALUES (?,?,'active')", userId, userId + "@example.test");
    }

    @Test
    @DisplayName("practice.record 예약 정리: 새 주기 작업은 옛 정리와 같은 예약(시한 지난 pending)만 닫고 객체 삭제를 장부에 올린다")
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
        // 이미 닫힌 예약은 어느 쪽도 다시 닫지 않는다.
        videos.sweepExpiredIntents(NOW);
        assertThat(ledger() - ledgerBefore).isEqualTo(2);
        assertThat(oldSweep.sweepExpiredUploads(NOW)).doesNotContain(key(expired.get(0)), key(expired.get(1)), key(active));
    }

    @Test
    @DisplayName("practice.record 예약 정리: 옛 정리가 먼저 닫은 예약은 새 주기 작업이 건드리지 않는다")
    void theNewSweepSkipsWhatTheOldOneClosed() {
        UUID intent = pending(NOW.minusSeconds(30));
        int ledgerBefore = ledger();

        assertThat(oldSweep.sweepExpiredUploads(NOW)).contains(key(intent));
        videos.sweepExpiredIntents(NOW);

        assertThat(status(intent)).isEqualTo("expired");
        assertThat(ledger()).isEqualTo(ledgerBefore);
    }

    @RepeatedTest(5)
    @DisplayName("practice.record 예약 정리: 둘이 같은 순간에 돌아도 예약마다 한쪽만 닫고 객체 삭제도 한쪽만 맡는다")
    void bothSweepsRunningTogetherCloseEachIntentOnce() throws Exception {
        List<UUID> intents = new ArrayList<>();
        for (int i = 0; i < 60; i++) intents.add(pending(NOW.minusSeconds(60 + i)));
        int ledgerBefore = ledger();
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CompletableFuture<List<String>> old = CompletableFuture.supplyAsync(() -> {
                await(start);
                return oldSweep.sweepExpiredUploads(NOW);
            }, pool);
            CompletableFuture<List<UUID>> fresh = CompletableFuture.supplyAsync(() -> {
                await(start);
                List<UUID> all = new ArrayList<>();
                for (List<UUID> batch = videos.sweepExpiredIntents(NOW); !batch.isEmpty();
                        batch = videos.sweepExpiredIntents(NOW)) {
                    all.addAll(batch);
                }
                return all;
            }, pool);
            start.countDown();

            List<String> mine = intents.stream().map(UploadIntentSweepIT::key).toList();
            int closedByOld = (int) old.get(20, TimeUnit.SECONDS).stream().filter(mine::contains).count();
            fresh.get(20, TimeUnit.SECONDS);
            int closedByNew = ledger() - ledgerBefore;

            assertThat(closedByOld + closedByNew).isEqualTo(intents.size());
            assertThat(jdbc.queryForObject(
                    "SELECT count(*) FROM upload_intents WHERE user_id=? AND status='expired'", Integer.class, userId))
                    .isEqualTo(intents.size());
        } finally {
            pool.shutdownNow();
        }
    }

    private static void await(CountDownLatch start) {
        try {
            start.await(5, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
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
