package com.acttub.actingapi.feature.transfer;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.transfer.app.TransferCodeRepository;
import com.acttub.actingapi.feature.transfer.app.TransferCodeRepository.LiveCode;
import com.acttub.actingapi.platform.security.TransferredGuests;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 이관 코드 저장소의 다섯 문장이 지금 내는 결과·잠금·문장 수를 실제 PostgreSQL 에서 고정한다. 저장소를 네이티브 SQL 에서
 * JPA 로 옮길 때 같은 테스트가 그대로 통과해야 한다(apps/api/CONTRACT.md §5-9).
 *
 * <p>요청을 겹쳐 보내는 경합(같은 코드를 두 회원이 넣음, 두 탭의 동시 발급, 같은 해시의 동시 발급)과 도중 실패의 롤백은
 * {@link GuestTransferIT} 가 HTTP 로 본다. 여기서는 그 테스트가 밟지 않는 순차 충돌·시한 경계·쓰인 코드의 보존·잠금 세기·
 * 포트 메서드마다 나가는 문장을 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.transfer.TransferCodeRepositoryIT$Recorder"
})
class TransferCodeRepositoryIT {

    /** 이 스레드가 보낸 SQL 을 모은다. 잠금 경합 쪽 스레드의 문장은 섞이지 않는다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    @Value("${spring.datasource.url}")
    private String databaseUrl;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    TransferCodeRepository codes;

    @Autowired
    TransferredGuests transferred;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        Recorder.STATEMENTS.get().clear();
    }

    @Test
    @DisplayName("발급은 그 게스트의 쓰지 않은 코드를 지우고 쓰인 코드는 남긴다")
    void issueReplacesTheUnusedCodeAndKeepsTheUsedOne() {
        UUID guest = user();
        assertThat(codes.issue(guest, "used", now, now.plus(Duration.ofMinutes(10)))).isTrue();
        LiveCode used = codes.inTransaction(() -> codes.lockLive("used", now));
        codes.inTransaction(() -> {
            codes.markUsed(used.id(), now);
            return null;
        });

        assertThat(codes.issue(guest, "first", now, now.plus(Duration.ofMinutes(10)))).isTrue();
        assertThat(codes.issue(guest, "second", now, now.plus(Duration.ofMinutes(10)))).isTrue();

        assertThat(rows(guest)).containsExactly("second live", "used used");
    }

    @Test
    @DisplayName("다른 게스트에게 살아 있는 같은 해시가 있으면 발급은 false 이고 아무것도 적지 않는다 — 앞의 코드를 지운 것도 되돌린다")
    void aLiveCodeOfAnotherGuestBlocksTheIssueAndRollsBackTheDelete() {
        UUID owner = user();
        UUID other = user();
        assertThat(codes.issue(owner, "taken", now, now.plus(Duration.ofMinutes(10)))).isTrue();
        assertThat(codes.issue(other, "earlier", now, now.plus(Duration.ofMinutes(10)))).isTrue();

        assertThat(codes.issue(other, "taken", now.plusSeconds(60), now.plus(Duration.ofMinutes(11)))).isFalse();

        assertThat(rows(owner)).containsExactly("taken live");
        assertThat(rows(other)).as("지운 앞의 코드가 돌아왔다").containsExactly("earlier live");
    }

    @Test
    @DisplayName("시한 경계: 시한과 같은 시각에 코드는 죽었고(lockLive 는 null) 같은 해시를 다른 게스트가 받을 수 있다. 1초 전에는 살아 있다")
    void theExpiryInstantIsTheFirstDeadInstant() {
        UUID owner = user();
        UUID other = user();
        Instant expiry = now.plus(Duration.ofMinutes(10));
        assertThat(codes.issue(owner, "edge", now, expiry)).isTrue();

        assertThat(codes.inTransaction(() -> codes.lockLive("edge", expiry.minusSeconds(1))).guestId()).isEqualTo(owner);
        assertThat(codes.issue(other, "edge", expiry.minusSeconds(1), expiry.plus(Duration.ofMinutes(10)))).isFalse();
        assertThat(codes.inTransaction(() -> codes.lockLive("edge", expiry))).isNull();
        assertThat(codes.issue(other, "edge", expiry, expiry.plus(Duration.ofMinutes(10)))).isTrue();

        assertThat(rows(owner)).as("시한 지난 남의 같은 해시는 지운다").isEmpty();
        assertThat(codes.inTransaction(() -> codes.lockLive("edge", expiry)).guestId()).isEqualTo(other);
    }

    @Test
    @DisplayName("lockLive 는 살아 있는 코드의 행 id 와 게스트를 돌려준다. 쓰인 코드·시한 지난 코드·없는 해시는 null 이다")
    void lockLiveFindsOnlyTheLiveCode() {
        UUID guest = user();
        UUID late = user();
        assertThat(codes.issue(guest, "live", now, now.plus(Duration.ofMinutes(10)))).isTrue();
        assertThat(codes.issue(late, "late", now.minus(Duration.ofMinutes(20)), now.minus(Duration.ofMinutes(10))))
                .isTrue();
        UUID row = jdbc.queryForObject("SELECT id FROM guest_transfer_codes WHERE code_hash='live'", UUID.class);

        assertThat(codes.inTransaction(() -> codes.lockLive("live", now))).isEqualTo(new LiveCode(row, guest));
        assertThat(codes.inTransaction(() -> codes.lockLive("late", now))).isNull();
        assertThat(codes.inTransaction(() -> codes.lockLive("missing", now))).isNull();
        codes.inTransaction(() -> {
            codes.markUsed(row, now);
            return null;
        });
        assertThat(codes.inTransaction(() -> codes.lockLive("live", now))).isNull();
    }

    @Test
    @DisplayName("markUsed 는 넘긴 시각을 마이크로초로 반올림해 적고 다른 행은 건드리지 않는다. 없는 id 는 아무 일도 없다. 그 뒤 transferredGuest 가 true 다")
    void markUsedWritesTheInstantAndMarksTheGuestTransferred() {
        UUID guest = user();
        UUID other = user();
        Instant usedAt = now.plusNanos(123_456_789);
        assertThat(codes.issue(guest, "mark", now, now.plus(Duration.ofMinutes(10)))).isTrue();
        assertThat(codes.issue(other, "keep", now, now.plus(Duration.ofMinutes(10)))).isTrue();
        UUID row = jdbc.queryForObject("SELECT id FROM guest_transfer_codes WHERE code_hash='mark'", UUID.class);
        assertThat(transferred.transferredGuest(guest)).as("쓰지 않은 코드만 있다").isFalse();

        codes.inTransaction(() -> {
            codes.markUsed(row, usedAt);
            codes.markUsed(UUID.randomUUID(), usedAt);
            return null;
        });

        assertThat(jdbc.queryForObject("SELECT used_at FROM guest_transfer_codes WHERE id=?", OffsetDateTime.class, row)
                .toInstant()).isEqualTo(now.plus(123_457, ChronoUnit.MICROS));
        assertThat(rows(other)).containsExactly("keep live");
        assertThat(transferred.transferredGuest(guest)).isTrue();
        assertThat(transferred.transferredGuest(other)).isFalse();
        assertThat(transferred.transferredGuest(UUID.randomUUID())).isFalse();
    }

    @Test
    @DisplayName("lockLive 의 잠금은 FOR UPDATE 다 — 바깥 연결이 FOR KEY SHARE 로 잡은 코드 행에서 기다린다")
    void lockLiveTakesForUpdate() throws Exception {
        UUID guest = user();
        assertThat(codes.issue(guest, "locked", now, now.plus(Duration.ofMinutes(10)))).isTrue();
        UUID row = jdbc.queryForObject("SELECT id FROM guest_transfer_codes WHERE code_hash='locked'", UUID.class);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = DriverManager.getConnection(databaseUrl,
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword())) {
            probe.setAutoCommit(false);
            try (PreparedStatement statement = probe.prepareStatement(
                    "SELECT 1 FROM guest_transfer_codes WHERE id=? FOR KEY SHARE")) {
                statement.setObject(1, row);
                statement.execute();
            }

            Future<LiveCode> locking = pool.submit(() -> codes.inTransaction(() -> codes.lockLive("locked", now)));
            String waiting = awaitStatementWaitingOn("guest_transfer_codes");
            probe.rollback();

            assertThat(waiting.toLowerCase()).contains("for update").doesNotContain("no key");
            assertThat(locking.get(20, TimeUnit.SECONDS)).isEqualTo(new LiveCode(row, guest));
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("포트 메서드마다 나가는 문장: 발급은 DELETE 와 대상 없는 ON CONFLICT DO NOTHING INSERT, 나머지는 한 문장씩이다")
    void eachPortMethodSendsTheSameStatements() {
        UUID guest = user();

        assertThat(statementsOf(() -> codes.issue(guest, "trace", now, now.plus(Duration.ofMinutes(10)))))
                .satisfiesExactly(
                        delete -> assertThat(delete).matches("(?is)delete\\s+from\\s+guest_transfer_codes\\b.*"),
                        insert -> assertThat(insert)
                                .matches("(?is)insert\\s+into\\s+guest_transfer_codes\\b.*\\son\\s+conflict\\s+do\\s+nothing\\s*"));
        LiveCode live = codes.inTransaction(() -> {
            List<String> lock = statementsOf(() -> codes.lockLive("trace", now));
            assertThat(lock).singleElement().satisfies(sql -> assertThat(sql)
                    .matches("(?is)select\\s.*\\sfrom\\s+guest_transfer_codes\\b.*\\sfor\\s+update\\b.*"));
            return codes.lockLive("trace", now);
        });
        codes.inTransaction(() -> {
            assertThat(statementsOf(() -> {
                codes.markUsed(live.id(), now);
                return null;
            })).singleElement().satisfies(sql -> assertThat(sql).matches("(?is)update\\s+guest_transfer_codes\\b.*"));
            return null;
        });
        assertThat(statementsOf(() -> transferred.transferredGuest(guest)))
                .singleElement().satisfies(sql -> assertThat(sql).matches("(?is)select\\s.*\\sfrom\\s+guest_transfer_codes\\b.*"));
    }

    private List<String> statementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = List.copyOf(Recorder.STATEMENTS.get());
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    private String awaitStatementWaitingOn(String table) throws Exception {
        Instant deadline = Instant.now().plusSeconds(10);
        while (Instant.now().isBefore(deadline)) {
            List<String> waiting = jdbc.queryForList("""
                    SELECT query FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock'
                      AND query ILIKE ?
                    """, String.class, "%from " + table + "%");
            if (!waiting.isEmpty()) {
                return waiting.getFirst();
            }
            Thread.sleep(10);
        }
        throw new AssertionError("잠금이 FOR KEY SHARE 뒤에서 기다리지 않았다 — FOR UPDATE 가 아니다");
    }

    private UUID user() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        return id;
    }

    /** 그 사용자의 코드 행: "<해시> live|used", 해시 순. */
    private List<String> rows(UUID userId) {
        return jdbc.queryForList("""
                SELECT code_hash, used_at IS NOT NULL AS used FROM guest_transfer_codes WHERE user_id=? ORDER BY code_hash
                """, userId).stream()
                .map((Map<String, Object> row) -> row.get("code_hash") + (Boolean.TRUE.equals(row.get("used")) ? " used" : " live"))
                .toList();
    }
}
