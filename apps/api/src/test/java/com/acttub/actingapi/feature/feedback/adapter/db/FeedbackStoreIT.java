package com.acttub.actingapi.feature.feedback.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import com.acttub.actingapi.feature.feedback.app.ExitSurveyStore.Accepted;
import com.acttub.actingapi.feature.feedback.app.ExitSurveyStore.NewSurvey;
import com.acttub.actingapi.feature.feedback.app.ExitSurveyStore.SheetRow;
import com.acttub.actingapi.feature.practice.app.ErasedPracticeGroup;
import com.acttub.actingapi.feature.practice.app.PracticeGroupErasureStep;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 이탈 설문 저장소({@code practice_feedback})의 문장이 내는 결과·잠금·경합·문장 수를 실제 PostgreSQL 에서 고정한다 — 접수와
 * 재전송, 시트로 보낼 줄, 보낸 표시, 90일 연락처 비우기, 게스트 이관, 탈퇴의 연락처 비우기, 연습 삭제의 넘기기. 네이티브 SQL 을
 * JPA 로 옮기기 전에 네이티브 구현에서 먼저 통과시킨다(apps/api/CONTRACT.md §5-9).
 *
 * <p>HTTP 쪽 값 검사·한 번만 묻기·시트 전송은 {@code ExitSurveyIT} 가 본다. 여기서는 그 테스트가 밟지 않는 모든 칸, 시각의 경계와
 * 정밀도, 순번, 같은 요청을 두 번 함께 보낼 때, 포트 메서드마다 나가는 문장을 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.feedback.adapter.db.FeedbackStoreIT$Recorder"
})
// 이 클래스만 쓰는 설정이라 끝나면 닫는다(PosterRepositoryIT 와 같은 까닭).
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class FeedbackStoreIT {

    /** 이 스레드가 보낸 SQL 을 모은다. 경합 쪽 스레드의 문장은 섞이지 않는다. */
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
    PostgresExitSurveyStore surveys;

    @Autowired
    PostgresFeedbackAccountErasure erasure;

    @Autowired
    PostgresFeedbackPracticeGroupPart groupPart;

    @Autowired
    PlatformTransactionManager transactionManager;

    private final Instant now = Instant.parse("2026-11-27T03:00:00Z");
    private UUID user;
    private UUID other;
    private UUID keeper;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users CASCADE");
        user = user("active");
        other = user("active");
        keeper = user("active");
        Recorder.STATEMENTS.get().clear();
    }

    // ---- 접수(submit) ----

    @Test
    @DisplayName("submit 은 활성 계정이면 모든 칸을 적고 새로 만들었다고 낸다. 시각은 마이크로초로 반올림되고 순번 1, 보낸 표시는 비어 있다")
    void submitWritesEveryColumn() {
        UUID practice = practice(user);
        UUID request = UUID.randomUUID();
        Accepted accepted = surveys.submit(new NewSurvey(user, request, practice, "coach", "x", "본문", "a@example.test",
                "010-0000-0000"), now.plusNanos(1_500));

        assertThat(accepted.created()).isTrue();
        assertThat(jdbc.queryForObject("""
                SELECT (user_id = ?) || ':' || (practice_id = ?) || ':' || screen || ':' || trigger || ':' || body || ':'
                       || contact_email || ':' || contact_phone || ':' || (request_id = ?) || ':' || sheet_seq || ':'
                       || (sheet_synced_at IS NULL) || ':' || to_char(created_at AT TIME ZONE 'UTC', 'HH24:MI:SS.US')
                       || ':' || (updated_at = created_at)
                  FROM practice_feedback WHERE id=?
                """, String.class, user, practice, request, accepted.id()))
                .isEqualTo("true:true:coach:x:본문:a@example.test:010-0000-0000:true:1:true:03:00:00.000002:true");
    }

    @Test
    @DisplayName("submit 은 같은 (사람, 요청 id) 의 재전송이면 행을 늘리지 않고 먼저 만든 id 를 낸다. 다른 사람의 같은 요청 id 는 새로 만든다")
    void submitIsIdempotentPerUserAndRequest() {
        UUID request = UUID.randomUUID();
        Accepted first = surveys.submit(survey(user, request), now);
        Accepted again = surveys.submit(new NewSurvey(user, request, null, "report", "back", "다른 본문", null, null),
                now.plusSeconds(60));
        Accepted theirs = surveys.submit(survey(other, request), now);

        assertThat(again).isEqualTo(new Accepted(first.id(), false));
        assertThat(theirs.created()).isTrue();
        assertThat(theirs.id()).isNotEqualTo(first.id());
        assertThat(jdbc.queryForList("SELECT screen || ':' || trigger FROM practice_feedback WHERE user_id=?", String.class,
                user)).containsExactly("coach:leave");
    }

    @Test
    @DisplayName("submit 은 탈퇴한 계정과 없는 계정이면 null 이고 아무것도 넣지 않는다. 비운 칸은 NULL 이다")
    void submitOfAClosedOrMissingAccountIsNull() {
        UUID closed = user("deactivated");

        assertThat(surveys.submit(survey(closed, UUID.randomUUID()), now)).isNull();
        assertThat(surveys.submit(survey(UUID.randomUUID(), UUID.randomUUID()), now)).isNull();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM practice_feedback", Integer.class)).isZero();

        Accepted plain = surveys.submit(survey(user, UUID.randomUUID()), now);
        assertThat(jdbc.queryForMap("SELECT practice_id, body, contact_email, contact_phone FROM practice_feedback WHERE id=?",
                plain.id())).allSatisfy((column, value) -> assertThat(value).as(column).isNull());
    }

    // ---- 시트(pendingSheetRows·markSheetSynced) ----

    @Test
    @DisplayName("pendingSheetRows 는 보낸 표시가 없는 줄만 접수 시각 순(같으면 id 작은 것부터) limit 개 모든 칸과 함께 낸다")
    void pendingSheetRowsOrdersAndLimits() {
        UUID practice = practice(user);
        row(id(3), user, practice, now, null, "a@example.test", "010", 2);
        row(id(2), other, null, now, null, null, null, 1);
        row(id(1), user, null, now.plusSeconds(1), null, null, "011", 1);
        row(id(4), user, null, now.minusSeconds(1), now, "b@example.test", null, 1);

        assertThat(surveys.pendingSheetRows(10)).extracting(SheetRow::id).containsExactly(id(2), id(3), id(1));
        assertThat(surveys.pendingSheetRows(2)).extracting(SheetRow::id).containsExactly(id(2), id(3));
        assertThat(surveys.pendingSheetRows(10).get(1)).isEqualTo(new SheetRow(id(3), 2, user, practice, "coach", "leave",
                "본문", "a@example.test", "010", now));
    }

    @Test
    @DisplayName("markSheetSynced 는 순번이 같을 때만 보낸 표시와 고친 시각을 적는다. 순번이 올라갔거나 없는 id 면 그대로다")
    void markSheetSyncedOnlyForTheSameSeq() {
        row(id(1), user, null, now.minusSeconds(60), null, null, null, 2);

        surveys.markSheetSynced(id(1), 1, now);
        surveys.markSheetSynced(UUID.randomUUID(), 2, now);
        assertThat(jdbc.queryForObject("SELECT sheet_synced_at IS NULL FROM practice_feedback", Boolean.class)).isTrue();

        surveys.markSheetSynced(id(1), 2, now.plusNanos(1_500));
        assertThat(jdbc.queryForList("SELECT sheet_synced_at FROM practice_feedback UNION ALL SELECT updated_at FROM practice_feedback",
                OffsetDateTime.class)).extracting(OffsetDateTime::toInstant)
                .containsExactly(now.plus(2, ChronoUnit.MICROS), now.plus(2, ChronoUnit.MICROS));
    }

    // ---- 90일 연락처 비우기(purgeExpiredContacts) ----

    @Test
    @DisplayName("purgeExpiredContacts 는 cutoff 보다 먼저 접수했고 연락처가 하나라도 있는 줄만 비우고 순번을 올리고 보낸 표시를 지운다. 같은 시각은 남긴다")
    void purgeExpiredContactsBeforeCutoff() {
        row(id(1), user, null, now.minusSeconds(1), now, "a@example.test", "010", 1);
        row(id(2), user, null, now.minusSeconds(1), now, null, "010", 3);
        row(id(3), user, null, now.minusSeconds(1), now, null, null, 1);
        row(id(4), user, null, now, now, "b@example.test", null, 1);

        assertThat(surveys.purgeExpiredContacts(now, now.plusSeconds(60))).isEqualTo(2);
        assertThat(surveys.purgeExpiredContacts(now, now.plusSeconds(60))).isZero();
        assertThat(jdbc.queryForList("""
                SELECT coalesce(contact_email,'-') || ':' || coalesce(contact_phone,'-') || ':' || sheet_seq || ':'
                       || (sheet_synced_at IS NULL) || ':' || (updated_at = ?)
                  FROM practice_feedback ORDER BY id
                """, String.class, timestamp(now.plusSeconds(60))))
                .containsExactly("-:-:2:true:true", "-:-:4:true:true", "-:-:1:false:false",
                        "b@example.test:-:1:false:false");
    }

    // ---- 이관(reassign) ----

    @Test
    @DisplayName("reassign 은 그 사람의 줄을 모두 회원에게 옮기고 고친 시각을 트랜잭션 시각으로 둔다. 다른 사람의 줄은 그대로다")
    void reassignMovesEveryRowOfThatUser() {
        row(id(1), user, null, now, null, null, null, 1);
        row(id(2), user, null, now, now, "a@example.test", null, 2);
        row(id(3), other, null, now, null, null, null, 1);

        Instant[] started = new Instant[1];
        new TransactionTemplate(transactionManager).executeWithoutResult(tx -> {
            started[0] = jdbc.queryForObject("SELECT now()", OffsetDateTime.class).toInstant();
            surveys.reassign(user, keeper);
        });

        assertThat(jdbc.queryForList("SELECT user_id FROM practice_feedback ORDER BY id", UUID.class))
                .containsExactly(keeper, keeper, other);
        assertThat(jdbc.queryForList("SELECT updated_at FROM practice_feedback WHERE user_id=?", OffsetDateTime.class, keeper))
                .extracting(OffsetDateTime::toInstant).containsOnly(started[0]);
        assertThat(jdbc.queryForObject("SELECT updated_at FROM practice_feedback WHERE id=?", OffsetDateTime.class, id(3))
                .toInstant()).isEqualTo(now);
    }

    // ---- 탈퇴(PostgresFeedbackAccountErasure) ----

    @Test
    @DisplayName("탈퇴의 erase 는 그 사람의 연락처가 있는 줄만 비우고 순번을 올리고 보낸 표시를 지운다")
    void accountErasureClearsContactsOfThatUser() {
        row(id(1), user, null, now, now, "a@example.test", null, 1);
        row(id(2), user, null, now, now, null, null, 1);
        row(id(3), other, null, now, now, "b@example.test", "010", 1);

        List<UUID> keys = new TransactionTemplate(transactionManager).execute(tx -> erasure.erase(
                AccountErasureStep.PRACTICE_FEEDBACK, closing(user, now.plusNanos(1_500))));
        assertThat(keys).as("지울 객체 키가 없다").isEmpty();

        assertThat(jdbc.queryForList("""
                SELECT coalesce(contact_email,'-') || ':' || coalesce(contact_phone,'-') || ':' || sheet_seq || ':'
                       || (sheet_synced_at IS NULL) || ':' || to_char(updated_at AT TIME ZONE 'UTC', 'HH24:MI:SS.US')
                  FROM practice_feedback ORDER BY id
                """, String.class))
                .containsExactly("-:-:2:true:03:00:00.000002", "-:-:1:false:03:00:00.000000",
                        "b@example.test:010:1:false:03:00:00.000000");
    }

    // ---- 연습 삭제(PostgresFeedbackPracticeGroupPart) ----

    @Test
    @DisplayName("연습 삭제의 erase 는 그 회차들의 줄을 모두(연락처가 없어도) 보관 계정에 넘기고 연락처를 비우고 순번을 올린다. 다른 회차와 회차 없는 줄은 그대로다")
    void practiceGroupErasureHandsOverTheGroupRows() {
        UUID first = practice(user);
        UUID second = practice(user);
        UUID outside = practice(user);
        row(id(1), user, first, now, now, "a@example.test", "010", 1);
        row(id(2), user, second, now, now, null, null, 4);
        row(id(3), user, outside, now, now, "b@example.test", null, 1);
        row(id(4), user, null, now, now, "c@example.test", null, 1);

        new TransactionTemplate(transactionManager).executeWithoutResult(tx -> groupPart.erase(
                PracticeGroupErasureStep.PRACTICE_FEEDBACK,
                new ErasedPracticeGroup(user, first, List.of(first, second), keeper, now.plusSeconds(60))));

        assertThat(jdbc.queryForList("""
                SELECT (user_id = ?) || ':' || coalesce(contact_email,'-') || ':' || coalesce(contact_phone,'-') || ':'
                       || sheet_seq || ':' || (sheet_synced_at IS NULL) || ':' || (updated_at = ?)
                  FROM practice_feedback ORDER BY id
                """, String.class, keeper, timestamp(now.plusSeconds(60))))
                .containsExactly("true:-:-:2:true:true", "true:-:-:5:true:true",
                        "false:b@example.test:-:1:false:false", "false:c@example.test:-:1:false:false");
    }

    // ---- 잠금 ----

    @Test
    @DisplayName("주인을 바꾸는 문장(연습 삭제의 넘기기)은 유니크 키의 칸을 고쳐 FOR UPDATE 세기라 바깥 FOR KEY SHARE 뒤에서 기다리고, 보낸 표시는 FOR NO KEY UPDATE 세기라 지난다")
    void ownerChangesLockTheKeyAndSheetMarksDoNot() throws Exception {
        UUID practice = practice(user);
        row(id(1), user, practice, now, null, null, null, 1);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            lock(probe, id(1), "FOR KEY SHARE");
            pool.submit(() -> surveys.markSheetSynced(id(1), 1, now)).get(20, TimeUnit.SECONDS);

            Future<?> blocked = pool.submit(() -> new TransactionTemplate(transactionManager).executeWithoutResult(tx ->
                    groupPart.erase(PracticeGroupErasureStep.PRACTICE_FEEDBACK,
                            new ErasedPracticeGroup(user, practice, List.of(practice), keeper, now))));
            String waiting = awaitStatementWaitingOn("practice_feedback");
            probe.rollback();

            assertThat(waiting.toLowerCase(Locale.ROOT)).startsWith("update practice_feedback");
            blocked.get(20, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT user_id FROM practice_feedback", UUID.class)).isEqualTo(keeper);
    }

    // ---- 경합 ----

    @Test
    @DisplayName("같은 요청을 두 번 함께 보내면 뒤의 것이 앞의 커밋을 기다렸다가 먼저 만든 id 를 받는다. 앞의 것이 되돌리면 뒤의 것이 만든다")
    void twoSubmitsOfTheSameRequestTheLaterWaits() throws Exception {
        UUID request = UUID.randomUUID();
        Race<Accepted> committed = new Race<>(() -> surveys.submit(survey(user, request), now));
        try {
            Future<Accepted> later = committed.pool.submit(() -> surveys.submit(survey(user, request), now));
            awaitStatementWaitingOn("practice_feedback");
            committed.commit();

            Accepted first = committed.result();
            assertThat(first.created()).isTrue();
            assertThat(later.get(20, TimeUnit.SECONDS)).isEqualTo(new Accepted(first.id(), false));
        } finally {
            committed.pool.shutdownNow();
        }

        UUID undone = UUID.randomUUID();
        Race<Accepted> rolledBack = new Race<>(() -> surveys.submit(survey(user, undone), now));
        try {
            Future<Accepted> later = rolledBack.pool.submit(() -> surveys.submit(survey(user, undone), now));
            awaitStatementWaitingOn("practice_feedback");
            rolledBack.rollback();
            assertThat(later.get(20, TimeUnit.SECONDS).created()).isTrue();
        } finally {
            rolledBack.pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM practice_feedback", Integer.class)).isEqualTo(2);
    }

    // ---- 문장 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류")
    void eachPortMethodSendsTheseStatements() {
        UUID request = UUID.randomUUID();
        UUID practice = practice(user);
        assertThat(statementsOf(() -> surveys.submit(survey(user, request), now)))
                .as("새로 만들면 넣는 문장 하나다").containsExactly("insert practice_feedback users on conflict");
        assertThat(statementsOf(() -> surveys.submit(survey(user, request), now)))
                .as("재전송은 먼저 만든 행을 다시 읽는다").containsExactly("insert practice_feedback users on conflict",
                        "select practice_feedback");
        assertThat(statementsOf(() -> surveys.pendingSheetRows(10))).containsExactly("select practice_feedback");
        assertThat(statementsOf(() -> {
            surveys.markSheetSynced(UUID.randomUUID(), 1, now);
            return null;
        })).containsExactly("update practice_feedback");
        assertThat(statementsOf(() -> surveys.purgeExpiredContacts(now, now))).containsExactly("update practice_feedback");
        assertThat(statementsOf(() -> new TransactionTemplate(transactionManager).execute(tx -> {
            surveys.reassign(other, keeper);
            return null;
        }))).containsExactly("update practice_feedback", "update users");
        assertThat(statementsOf(() -> new TransactionTemplate(transactionManager).execute(tx ->
                erasure.erase(AccountErasureStep.PRACTICE_FEEDBACK, closing(other, now)))))
                .containsExactly("update practice_feedback");
        assertThat(statementsOf(() -> new TransactionTemplate(transactionManager).execute(tx -> {
            groupPart.erase(PracticeGroupErasureStep.PRACTICE_FEEDBACK,
                    new ErasedPracticeGroup(user, practice, List.of(practice), keeper, now));
            return null;
        }))).containsExactly("update practice_feedback");
    }

    // ---- 도움 ----

    private static final Pattern KIND = Pattern.compile("^(?:with \\w+ as \\( ?)?(select|insert|update|delete)\\b.*");
    private static final Pattern TABLE = Pattern.compile("\\b(?:from|join|into|update) (?!set\\b)(\\w+)\\b");

    /**
     * 문장을 "<종류> <문장에 나오는 표(가나다 순)>[ on conflict]" 로 줄인다. 데이터를 바꾸는 CTE 는 안쪽 문장의 종류로 본다. 별칭·열
     * 목록·매개변수 표기는 두 구현이 달라 견주지 않는다.
     */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        Matcher kind = KIND.matcher(text);
        if (!kind.matches()) {
            return text;
        }
        TreeSet<String> tables = new TreeSet<>();
        Matcher table = TABLE.matcher(text);
        while (table.find()) {
            if (!table.group(1).equals("inserted")) {
                tables.add(table.group(1));
            }
        }
        return kind.group(1) + " " + String.join(" ", tables) + (text.contains(" on conflict") ? " on conflict" : "");
    }

    private List<String> statementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = Recorder.STATEMENTS.get().stream().map(FeedbackStoreIT::label).toList();
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    /** 첫 요청: 트랜잭션 안에서 포트를 부르고, 커밋하거나 되돌릴 때까지 열어 둔다. */
    private final class Race<T> {
        final ExecutorService pool = Executors.newFixedThreadPool(2);
        private final CountDownLatch done = new CountDownLatch(1);
        private final CountDownLatch release = new CountDownLatch(1);
        private volatile boolean rollback;
        private final Future<T> result;

        Race(Supplier<T> call) {
            TransactionTemplate transaction = new TransactionTemplate(transactionManager);
            result = pool.submit(() -> transaction.execute((TransactionStatus tx) -> {
                T value = call.get();
                done.countDown();
                await(release);
                if (rollback) {
                    tx.setRollbackOnly();
                }
                return value;
            }));
            await(done);
        }

        void commit() {
            release.countDown();
        }

        void rollback() {
            rollback = true;
            release.countDown();
        }

        T result() throws Exception {
            return result.get(20, TimeUnit.SECONDS);
        }
    }

    private static NewSurvey survey(UUID userId, UUID requestId) {
        return new NewSurvey(userId, requestId, null, "coach", "leave", null, null, null);
    }

    private static ClosingAccount closing(UUID userId, Instant at) {
        return new ClosingAccount(userId, false, at, LocalDate.ofInstant(at, ZoneOffset.UTC));
    }

    private UUID user(String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,?)", id, status);
        return id;
    }

    private UUID practice(UUID owner) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,root_id,ordinal,stage,experience_version,blockage_kind,sub_branch)
                VALUES (?,?,?,1,'conversing','legacy','표현','감정')
                """, id, owner, id);
        return id;
    }

    private void row(UUID id, UUID userId, UUID practiceId, Instant createdAt, Instant syncedAt, String email,
            String phone, int seq) {
        jdbc.update("""
                INSERT INTO practice_feedback(id,user_id,practice_id,screen,trigger,body,contact_email,contact_phone,
                                              request_id,sheet_seq,sheet_synced_at,created_at,updated_at)
                VALUES (?,?,?,'coach','leave','본문',?,?,?,?,?,?,?)
                """, id, userId, practiceId, email, phone, UUID.randomUUID(), seq, timestamp(syncedAt), timestamp(createdAt),
                timestamp(createdAt));
    }

    private static OffsetDateTime timestamp(Instant value) {
        return value == null ? null : value.atOffset(ZoneOffset.UTC);
    }

    private static UUID id(int n) {
        return UUID.fromString("00000000-0000-0000-0000-%012d".formatted(n));
    }

    private Connection probe() throws SQLException {
        Connection probe = DriverManager.getConnection(databaseUrl,
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
        probe.setAutoCommit(false);
        return probe;
    }

    private static void lock(Connection probe, UUID id, String strength) throws SQLException {
        try (PreparedStatement statement = probe.prepareStatement("SELECT 1 FROM practice_feedback WHERE id=? " + strength)) {
            statement.setObject(1, id);
            statement.execute();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(20, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exc);
        }
    }

    private String awaitStatementWaitingOn(String table) throws Exception {
        Instant deadline = Instant.now().plusSeconds(10);
        while (Instant.now().isBefore(deadline)) {
            List<String> waiting = jdbc.queryForList("""
                    SELECT query FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock'
                      AND query ILIKE ?
                    """, String.class, "%" + table + "%");
            if (!waiting.isEmpty()) {
                return waiting.getFirst().strip();
            }
            Thread.sleep(10);
        }
        throw new AssertionError("뒤의 요청이 앞의 잠금 뒤에서 기다리지 않았다");
    }
}
