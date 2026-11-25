package com.acttub.actingapi.feature.push;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.push.app.PracticeReminderPolicy;
import com.acttub.actingapi.feature.push.app.PracticeReminderRepository;
import com.acttub.actingapi.feature.push.app.PracticeReminderRepository.Candidate;
import com.acttub.actingapi.feature.push.app.PushOpenRepository;
import com.acttub.actingapi.feature.push.app.PushTarget;
import com.acttub.actingapi.feature.push.app.PushTokenRepository;
import com.acttub.actingapi.feature.push.app.ReminderCopy;
import com.acttub.actingapi.feature.push.app.ReminderKind;
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
 * 푸시 저장소 셋(연습 알림·토큰·푸시 열기)이 내는 결과·잠금·경합·문장 수를 실제 PostgreSQL 에서 고정한다. 자기 표만 쓰는 문장
 * (보낼 자리 선점, 종류별 횟수, 최근 문구, 후보의 토큰 읽기)을 네이티브 SQL 에서 JPA 로 옮길 때 네이티브 구현에서 먼저 통과시킨
 * 이 테스트가 그대로 통과했다(apps/api/CONTRACT.md §5-9). 문장 테스트만 달라졌다 — 선점의 {@code RETURNING} 이 빠지고 영향 행
 * 수로 판정한다(문장 수는 같다). 다른 기능의 표를 읽는 문장은 네이티브로 남겨 문장 테스트에서만 본다.
 *
 * <p>후보 고르기·이어 하기·숙제·연속 일수·올려 둔 영상·안 읽은 대본의 결과는 {@link PracticeReminderRepositoryIT}, 토큰 등록·
 * 소유자 교체·토글과의 경합은 {@link PushTokenLifecycleIT}·{@link AccountNotificationIT}, 푸시 열기 기록은 {@link PushOpenIT}
 * 가 본다. 여기서는 그 테스트가 밟지 않는 선점의 모든 칸과 시각, 선점 경합(같은 칸, 같은 대화), 선점의 FK 잠금, 횟수·문구의
 * 날짜 경계와 다른 회원, 토큰의 순서와 앱 버전 거르기, 포트 메서드마다 나가는 문장을 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.push.PushRepositoryIT$Recorder"
})
// 이 클래스만 쓰는 설정(StatementInspector)이라 끝나면 닫는다.
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PushRepositoryIT {

    /** 이 스레드가 보낸 SQL 을 모은다. 경합 쪽 스레드의 문장은 섞이지 않는다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 21);
    private static final Instant WINDOW = TODAY.minusDays(7).atStartOfDay(PracticeReminderPolicy.SEOUL).toInstant();

    @Value("${spring.datasource.url}")
    private String databaseUrl;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PracticeReminderRepository reminders;

    @Autowired
    PushTokenRepository tokens;

    @Autowired
    PushOpenRepository opens;

    @Autowired
    PlatformTransactionManager transactionManager;

    @BeforeEach
    void setUp() {
        Recorder.STATEMENTS.get().clear();
    }

    // ---- 보낼 자리 선점 ----

    @Test
    @DisplayName("claim 은 넘긴 칸을 모두 적고 sent_at 은 DB 기본값(트랜잭션 시작 시각)이다. 대화가 없으면 conversation_id 는 NULL 이다")
    void claimWritesEveryColumnAndSentAtIsTheTransactionTime() {
        UUID user = member("claim-columns");
        UUID conversation = UUID.randomUUID();
        ReminderCopy resume = new ReminderCopy(ReminderKind.RESUME, 3, "resume.a", "제목", "본문", conversation,
                UUID.randomUUID());
        ReminderCopy streak = new ReminderCopy(ReminderKind.STREAK, 0, "streak.b", "제목", "본문", null, null);

        Boolean sentAtIsNow = inTransaction(() -> {
            assertThat(reminders.claim(user, TODAY, resume)).isTrue();
            return jdbc.queryForObject("SELECT sent_at=now() FROM practice_reminder_sends WHERE user_id=? AND slot='practice'",
                    Boolean.class, user);
        });
        assertThat(sentAtIsNow).isTrue();
        assertThat(reminders.claim(user, TODAY, streak)).isTrue();

        assertThat(jdbc.queryForList("""
                SELECT day || ' ' || slot || ' ' || kind || ' ' || skipped_days || ' ' || template_id || ' '
                       || COALESCE(CAST(conversation_id AS text), '-')
                FROM practice_reminder_sends WHERE user_id=? ORDER BY slot
                """, String.class, user))
                .containsExactly(
                        "2026-10-21 practice resume 3 resume.a " + conversation,
                        "2026-10-21 streak streak 0 streak.b -");
    }

    @Test
    @DisplayName("claim 이 겹치면(같은 회원·날·칸, 또는 다른 날의 같은 대화) false 이고 먼저 적힌 행을 건드리지 않는다. 대화 없는 선점끼리는 겹치지 않는다")
    void aConflictingClaimIsFalseAndKeepsTheFirstRow() {
        UUID user = member("claim-conflict");
        UUID conversation = UUID.randomUUID();
        assertThat(reminders.claim(user, TODAY, copy(ReminderKind.RESUME, "resume.first", conversation))).isTrue();

        assertThat(reminders.claim(user, TODAY, copy(ReminderKind.GENERAL, "general.second", null))).isFalse();
        assertThat(reminders.claim(user, TODAY.plusDays(1), copy(ReminderKind.RESUME, "resume.again", conversation)))
                .isFalse();
        assertThat(reminders.claim(member("claim-other"), TODAY, copy(ReminderKind.RESUME, "resume.other", conversation)))
                .as("다른 회원이어도 같은 대화면 겹친다").isFalse();
        assertThat(reminders.claim(user, TODAY.plusDays(2), copy(ReminderKind.GENERAL, "general.later", null))).isTrue();
        assertThat(reminders.claim(user, TODAY.plusDays(3), copy(ReminderKind.GENERAL, "general.later", null))).isTrue();

        assertThat(jdbc.queryForList(
                "SELECT day || ' ' || kind || ' ' || template_id FROM practice_reminder_sends WHERE user_id=? ORDER BY day",
                String.class, user))
                .containsExactly("2026-10-21 resume resume.first", "2026-10-23 general general.later",
                        "2026-10-24 general general.later");
    }

    @Test
    @DisplayName("같은 칸을 두 요청이 함께 선점하면 뒤의 INSERT 가 앞의 커밋을 기다렸다가 false 다. 앞의 것이 되돌리면 뒤의 것이 선점한다")
    void twoClaimsOfTheSameSlot() throws Exception {
        UUID user = member("claim-race");
        Race<Boolean> committed = holdOpen(() -> reminders.claim(user, TODAY, copy(ReminderKind.GENERAL, "general.a", null)));
        try {
            Future<Boolean> later = committed.pool.submit(() ->
                    reminders.claim(user, TODAY, copy(ReminderKind.HOMEWORK, "homework.b", null)));
            assertThat(awaitStatementWaitingOn("practice_reminder_sends")).contains("insert into practice_reminder_sends");
            committed.commit();

            assertThat(committed.result()).isTrue();
            assertThat(later.get(20, TimeUnit.SECONDS)).isFalse();
        } finally {
            committed.pool.shutdownNow();
        }

        Race<Boolean> rolledBack = holdOpen(() ->
                reminders.claim(user, TODAY.plusDays(1), copy(ReminderKind.GENERAL, "general.undo", null)));
        try {
            Future<Boolean> later = rolledBack.pool.submit(() ->
                    reminders.claim(user, TODAY.plusDays(1), copy(ReminderKind.HOMEWORK, "homework.kept", null)));
            awaitStatementWaitingOn("practice_reminder_sends");
            rolledBack.rollback();

            assertThat(rolledBack.result()).isTrue();
            assertThat(later.get(20, TimeUnit.SECONDS)).isTrue();
        } finally {
            rolledBack.pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT day || ' ' || template_id FROM practice_reminder_sends WHERE user_id=? ORDER BY day",
                String.class, user)).containsExactly("2026-10-21 general.a", "2026-10-22 homework.kept");
    }

    @Test
    @DisplayName("다른 날에 같은 대화를 두 요청이 함께 선점하면 부분 유니크 인덱스에서 뒤의 것이 기다렸다가 false 다. 앞의 것이 되돌리면 뒤의 것이 선점한다")
    void twoClaimsOfTheSameConversation() throws Exception {
        UUID user = member("conversation-race");
        UUID conversation = UUID.randomUUID();
        Race<Boolean> committed = holdOpen(() ->
                reminders.claim(user, TODAY, copy(ReminderKind.RESUME, "resume.a", conversation)));
        try {
            Future<Boolean> later = committed.pool.submit(() ->
                    reminders.claim(user, TODAY.plusDays(1), copy(ReminderKind.RESUME, "resume.b", conversation)));
            awaitStatementWaitingOn("practice_reminder_sends");
            committed.commit();

            assertThat(committed.result()).isTrue();
            assertThat(later.get(20, TimeUnit.SECONDS)).isFalse();
        } finally {
            committed.pool.shutdownNow();
        }

        UUID other = UUID.randomUUID();
        Race<Boolean> rolledBack = holdOpen(() ->
                reminders.claim(user, TODAY.plusDays(2), copy(ReminderKind.RESUME, "resume.undo", other)));
        try {
            Future<Boolean> later = rolledBack.pool.submit(() ->
                    reminders.claim(user, TODAY.plusDays(3), copy(ReminderKind.RESUME, "resume.kept", other)));
            awaitStatementWaitingOn("practice_reminder_sends");
            rolledBack.rollback();
            assertThat(later.get(20, TimeUnit.SECONDS)).isTrue();
        } finally {
            rolledBack.pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT day || ' ' || template_id FROM practice_reminder_sends WHERE user_id=? ORDER BY day",
                String.class, user)).containsExactly("2026-10-21 resume.a", "2026-10-24 resume.kept");
    }

    @Test
    @DisplayName("claim 은 FK 로 users 행에 FOR KEY SHARE 를 건다: 바깥이 그 회원 행을 FOR UPDATE 로 잡으면 기다리고, FOR NO KEY UPDATE 면 지난다")
    void claimTakesTheForeignKeyLockOnTheUserRow() throws Exception {
        UUID user = member("claim-lock");
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            lockUser(probe, user, "FOR NO KEY UPDATE");
            assertThat(pool.submit(() -> reminders.claim(user, TODAY, copy(ReminderKind.GENERAL, "general.a", null)))
                    .get(20, TimeUnit.SECONDS)).isTrue();
            probe.rollback();

            lockUser(probe, user, "FOR UPDATE");
            Future<Boolean> blocked = pool.submit(() ->
                    reminders.claim(user, TODAY, copy(ReminderKind.STREAK, "streak.a", null)));
            String waiting = awaitStatementWaitingOn("practice_reminder_sends");
            probe.rollback();

            assertThat(waiting).contains("insert into practice_reminder_sends");
            assertThat(blocked.get(20, TimeUnit.SECONDS)).isTrue();
        } finally {
            pool.shutdownNow();
        }
    }

    // ---- 종류별 횟수와 최근 문구 ----

    @Test
    @DisplayName("sentCountsByKind 는 since 날을 넣고 그 앞날은 빼며, 다른 회원의 기록은 세지 않는다. 칸이 달라도 종류로 센다")
    void sentCountsByKindIncludesTheSinceDayAndOnlyThisUser() {
        UUID user = member("counts");
        UUID other = member("counts-other");
        send(user, TODAY.minusDays(7), "practice", "pending_video", "video.a");
        send(user, TODAY.minusDays(6), "practice", "pending_video", "video.b");
        send(user, TODAY.minusDays(6), "streak", "streak", "streak.a");
        send(user, TODAY, "practice", "pending_video", "video.c");
        send(user, TODAY, "streak", "streak", "streak.b");
        send(other, TODAY, "practice", "pending_video", "video.d");

        assertThat(reminders.sentCountsByKind(user, TODAY.minusDays(6)))
                .isEqualTo(Map.of("pending_video", 2, "streak", 2));
        assertThat(reminders.sentCountsByKind(user, TODAY.plusDays(1))).isEmpty();
    }

    @Test
    @DisplayName("recentTemplates 는 문구마다 since 날부터 마지막으로 보낸 날을 내고, 그 앞날과 다른 회원의 기록은 보지 않는다")
    void recentTemplatesIncludesTheSinceDayAndOnlyThisUser() {
        UUID user = member("templates");
        UUID other = member("templates-other");
        send(user, TODAY.minusDays(15), "practice", "general", "general.old");
        send(user, TODAY.minusDays(14), "practice", "general", "general.edge");
        send(user, TODAY.minusDays(14), "streak", "streak", "streak.a");
        send(user, TODAY.minusDays(3), "streak", "streak", "streak.a");
        send(user, TODAY.minusDays(1), "practice", "general", "holdout:general.edge");
        send(other, TODAY, "practice", "general", "general.old");

        assertThat(reminders.recentTemplates(user, TODAY.minusDays(14))).isEqualTo(Map.of(
                "general.edge", TODAY.minusDays(14),
                "streak.a", TODAY.minusDays(3),
                "holdout:general.edge", TODAY.minusDays(1)));
        assertThat(reminders.recentTemplates(user, TODAY)).isEmpty();
    }

    // ---- 후보의 토큰 ----

    @Test
    @DisplayName("candidates 의 단말은 회원마다 created_at 순서이고, 앱 버전이 모자라거나 모르는 토큰은 빠지며 말(locale)은 토큰의 것이다. 남는 단말이 없는 회원은 후보가 아니다")
    void candidateTargetsFollowCreatedAtAndSkipOldVersions() {
        UUID many = member("many");
        token(many, "many-newest", "en", "0.2.0", "2026-10-20T09:00");
        token(many, "many-oldest", "ko", "0.1.2", "2026-10-18T09:00");
        token(many, "many-old-app", "ko", "0.1.1", "2026-10-17T09:00");
        token(many, "many-unknown-app", "ko", null, "2026-10-16T09:00");
        token(many, "many-middle", "ja", "1.0.0", "2026-10-19T09:00");
        UUID single = member("single");
        token(single, "single-only", "ko", "0.1.2", "2026-10-19T09:00");
        UUID stale = member("stale");
        token(stale, "stale-only", "ko", "0.1.1", "2026-10-19T09:00");

        List<Candidate> all = reminders.candidates(TODAY, WINDOW, "0.1.2");

        assertThat(find(all, many).targets()).containsExactly(
                new PushTarget("many-oldest", "ko"), new PushTarget("many-middle", "ja"),
                new PushTarget("many-newest", "en"));
        assertThat(find(all, single).targets()).containsExactly(new PushTarget("single-only", "ko"));
        assertThat(find(all, stale)).isNull();
        assertThat(all).extracting(candidate -> candidate.userId().toString())
                .as("PostgreSQL 의 uuid 정렬(바이트 순서)은 소문자 16진 문자열 순서와 같다").isSorted();
    }

    // ---- 문장 ----

    @Test
    @DisplayName("연습 알림 포트 메서드마다 나가는 문장의 수와 종류")
    void eachReminderPortMethodSendsTheseStatements() {
        assertThat(statementsOf(() -> reminders.candidates(TODAY, Instant.parse("2100-01-01T00:00:00Z"), "0.1.2")))
                .as("후보가 없으면(창이 미래라 아무도 들지 않는다) 토큰을 읽지 않는다").containsExactly("with select");
        UUID user = member("statements");
        token(user, "statements-token", "ko", "0.1.2", "2026-10-19T09:00");

        assertThat(statementsOf(() -> reminders.candidates(TODAY, WINDOW, "0.1.2")))
                .containsExactly("with select", "select push_tokens");
        assertThat(statementsOf(() -> reminders.countedPracticeDays(user, TODAY.minusDays(30))))
                .containsExactly("select (subquery)");
        assertThat(statementsOf(() -> reminders.latestOpenQuestion(user))).containsExactly("select coach_conversations");
        assertThat(statementsOf(() -> reminders.latestHomework(user))).containsExactly("select coach_notes");
        assertThat(statementsOf(() -> reminders.latestPendingVideo(user, WINDOW))).containsExactly("select videos");
        assertThat(statementsOf(() -> reminders.latestUnreadScript(user, WINDOW))).containsExactly("select scripts");
        assertThat(statementsOf(() -> reminders.sentCountsByKind(user, TODAY))).containsExactly("select practice_reminder_sends");
        assertThat(statementsOf(() -> reminders.recentTemplates(user, TODAY))).containsExactly("select practice_reminder_sends");
        assertThat(statementsOf(() -> reminders.claim(user, TODAY, copy(ReminderKind.GENERAL, "general.a", null))))
                .as("RETURNING 대신 영향 행 수로 선점했는지 안다").containsExactly("insert practice_reminder_sends on conflict");
        assertThat(statementsOf(() -> reminders.claim(user, TODAY, copy(ReminderKind.GENERAL, "general.a", null))))
                .as("겹쳐도 한 문장이다").containsExactly("insert practice_reminder_sends on conflict");

        UUID practice = practice(user, "숙제 연습");
        note(conversation(practice));
        assertThat(statementsOf(() -> reminders.latestHomework(user)))
                .as("대본이 없으면 잠금 화면에서 지울 말은 대본 제목 조회 하나로 끝난다")
                .containsExactly("select coach_notes", "select scripts");
        script(user, "대본 제목");
        assertThat(statementsOf(() -> reminders.latestHomework(user)))
                .containsExactly("select coach_notes", "select scripts", "select script_characters", "select script_lines");
    }

    @Test
    @DisplayName("토큰·푸시 열기 포트 메서드마다 나가는 문장의 수와 종류")
    void eachTokenAndOpenPortMethodSendsTheseStatements() {
        UUID user = member("token-statements");
        assertThat(statementsOf(() -> {
            tokens.register(user, "ExponentPushToken[statements]", "ios", "0.1.2");
            return null;
        })).containsExactly("select users for update", "insert push_tokens on conflict returning");
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", user);
        assertThat(statementsOf(() -> {
            tokens.register(user, "ExponentPushToken[inactive]", "ios", "0.1.2");
            return null;
        })).as("활성 계정이 아니면 잠금 조회만 나간다").containsExactly("select users for update");
        assertThat(statementsOf(() -> {
            tokens.unregister("ExponentPushToken[statements]");
            return null;
        })).containsExactly("delete push_tokens");
        assertThat(statementsOf(() -> tokens.analysisDoneTargets(UUID.randomUUID()))).containsExactly("select push_tokens");
        assertThat(statementsOf(() -> tokens.scriptSplitTargets(user))).containsExactly("select push_tokens");
        assertThat(statementsOf(() -> {
            opens.record(user, "evening_reminder", "general", "general.a", "ios", "0.1.2");
            return null;
        })).containsExactly("insert push_opens");
    }

    // ---- 도움 ----

    private static final Pattern WITH_CHANGE = Pattern.compile("^with \\w+ as \\( ?(insert into|update|delete from) (\\w+)\\b.*");
    private static final Pattern INSERT = Pattern.compile("^insert into (\\w+)\\b.*");
    private static final Pattern UPDATE = Pattern.compile("^update (\\w+)\\b.*");
    private static final Pattern DELETE = Pattern.compile("^delete from (\\w+)\\b.*");
    private static final Pattern TABLE = Pattern.compile("^(\\w+)\\b.*");

    /**
     * 문장을 "<종류> <표>[ 덧붙임]" 으로 줄인다. 별칭·열 목록·매개변수 표기는 두 구현이 달라 견주지 않는다. SELECT 의 표는 바깥
     * FROM 의 첫 표이고, 바깥 FROM 이 서브쿼리면 "(subquery)" 다. 데이터를 바꾸지 않는 CTE 로 시작하는 조회는 "with select" 다.
     */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        String conflict = text.contains(" on conflict") ? " on conflict" : "";
        String returning = text.contains(" returning ") ? " returning" : "";
        Matcher matcher;
        if ((matcher = WITH_CHANGE.matcher(text)).matches()) {
            return matcher.group(1).split(" ")[0] + " " + matcher.group(2) + conflict + returning;
        }
        if (text.startsWith("with ")) {
            return "with select";
        }
        if (text.startsWith("select ")) {
            return "select " + outerTable(text) + (text.contains(" for update") ? " for update" : "");
        }
        if ((matcher = INSERT.matcher(text)).matches()) {
            return "insert " + matcher.group(1) + conflict + returning;
        }
        if ((matcher = UPDATE.matcher(text)).matches()) {
            return "update " + matcher.group(1) + returning;
        }
        if ((matcher = DELETE.matcher(text)).matches()) {
            return "delete " + matcher.group(1) + returning;
        }
        return text;
    }

    /** 괄호 밖에 있는 첫 " from " 뒤의 표 이름. */
    private static String outerTable(String text) {
        int depth = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '(') {
                depth++;
            } else if (c == ')') {
                depth--;
            } else if (depth == 0 && text.startsWith(" from ", i)) {
                String rest = text.substring(i + " from ".length());
                Matcher matcher = TABLE.matcher(rest);
                return matcher.matches() ? matcher.group(1) : "(subquery)";
            }
        }
        return "?";
    }

    private List<String> statementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = Recorder.STATEMENTS.get().stream().map(PushRepositoryIT::label).toList();
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

    private <T> Race<T> holdOpen(Supplier<T> call) {
        return new Race<>(call);
    }

    private <T> T inTransaction(Supplier<T> body) {
        return new TransactionTemplate(transactionManager).execute(status -> body.get());
    }

    private static ReminderCopy copy(ReminderKind kind, String templateId, UUID conversationId) {
        return new ReminderCopy(kind, 1, templateId, "제목", "본문", conversationId, null);
    }

    private static Timestamp kst(String dateTime) {
        return Timestamp.from(LocalDateTime.parse(dateTime).atZone(PracticeReminderPolicy.SEOUL).toInstant());
    }

    /** 리마인드 토글을 켠 활성 회원. 가입이 이틀 전이라 연습 전 회원으로 후보가 된다(토큰이 있으면). */
    private UUID member(String name) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,email,status,created_at) VALUES (?,?,'active',?)",
                id, name + "-" + id + "@test.invalid", kst("2026-10-19T10:00"));
        jdbc.update("INSERT INTO user_profiles(user_id,name,notify_evening_reminder) VALUES (?,?,true)", id, name);
        return id;
    }

    private void token(UUID userId, String token, String locale, String appVersion, String createdAt) {
        jdbc.update("""
                INSERT INTO push_tokens(user_id,token,platform,locale,app_version,created_at,updated_at)
                VALUES (?,?,'ios',?,?,?,?)
                """, userId, token, locale, appVersion, kst(createdAt), kst(createdAt));
    }

    private void send(UUID userId, LocalDate day, String slot, String kind, String templateId) {
        jdbc.update("INSERT INTO practice_reminder_sends(user_id,day,slot,kind,skipped_days,template_id) VALUES (?,?,?,?,1,?)",
                userId, java.sql.Date.valueOf(day), slot, kind, templateId);
    }

    /** 영상 + 끝난 첫 회차 연습. */
    private UUID practice(UUID userId, String title) {
        UUID videoId = UUID.randomUUID();
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms,created_at) VALUES (?,?,?,'video/mp4',1,1,now())",
                videoId, userId, "video/" + videoId);
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,blockage_kind,sub_branch,title,created_at,close_reason)
                VALUES (?,?,?,?,1,'closed','three_layers_v1','분석','캐릭터 분석',?,now(),'conversation_closed')
                """, id, userId, videoId, id, title);
        return id;
    }

    private UUID conversation(UUID practiceId) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO coach_conversations(id,practice_id,start_request_id,status,created_at) VALUES (?,?,?,'closed',now())",
                id, practiceId, UUID.randomUUID());
        return id;
    }

    private void note(UUID conversationId) {
        jdbc.update("""
                INSERT INTO coach_notes(id,conversation_id,format,kind,source_revision,next_take,fallback,created_at)
                VALUES (?,?,'v2','action',1,'다음 촬영에서 천천히 해 보세요.',false,now())
                """, UUID.randomUUID(), conversationId);
    }

    private void script(UUID userId, String title) {
        UUID scriptId = UUID.randomUUID();
        jdbc.update("INSERT INTO scripts(id,user_id,title,raw_text,raw_hash,source,request_fingerprint,created_at,updated_at) VALUES (?,?,?,'r',repeat('0',64),'paste',?,now(),now())",
                scriptId, userId, title, "f".repeat(64));
        UUID characterId = UUID.randomUUID();
        jdbc.update("INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (?,?,'역할',0)", characterId, scriptId);
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,text,character_id) VALUES (?,?,0,'dialogue','안녕하세요 반갑습니다',?)",
                UUID.randomUUID(), scriptId, characterId);
    }

    private static Candidate find(List<Candidate> list, UUID userId) {
        return list.stream().filter(candidate -> candidate.userId().equals(userId)).findFirst().orElse(null);
    }

    private Connection probe() throws SQLException {
        Connection probe = DriverManager.getConnection(databaseUrl,
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
        probe.setAutoCommit(false);
        return probe;
    }

    private static void lockUser(Connection probe, UUID id, String strength) throws SQLException {
        try (PreparedStatement statement = probe.prepareStatement("SELECT 1 FROM users WHERE id=? " + strength)) {
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

    /** 그 표를 쓰는 문장이 잠금을 기다리면 그 문장을 소문자로 낸다. */
    private String awaitStatementWaitingOn(String table) throws Exception {
        Instant deadline = Instant.now().plusSeconds(10);
        while (Instant.now().isBefore(deadline)) {
            List<String> waiting = jdbc.queryForList("""
                    SELECT query FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock'
                      AND query ILIKE ?
                    """, String.class, "%" + table + "%");
            if (!waiting.isEmpty()) {
                return waiting.getFirst().strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
            }
            Thread.sleep(10);
        }
        throw new AssertionError("뒤의 요청이 앞의 잠금 뒤에서 기다리지 않았다");
    }
}
