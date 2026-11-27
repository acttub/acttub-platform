package com.acttub.actingapi.feature.practice;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
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

import com.acttub.actingapi.feature.practice.app.PracticeRepository;
import com.acttub.actingapi.feature.practice.app.PracticeRepository.CancelOutcome;
import com.acttub.actingapi.feature.practice.app.PracticeRepository.NewPractice;
import com.acttub.actingapi.feature.practice.app.PracticeRepository.Quota;
import com.acttub.actingapi.feature.practice.app.PracticeRepository.StartOutcome;
import com.acttub.actingapi.feature.practice.app.PracticeRepository.Started;
import com.acttub.actingapi.feature.practice.app.PracticeOwnership;
import com.acttub.actingapi.feature.practice.app.PracticeViews.GroupView;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 연습 회차·묶음 저장소가 내는 결과·잠금·경합·문장을 실제 PostgreSQL 에서 고정한다. 저장소를 네이티브 SQL 에서 JPA 로 옮길 때
 * 네이티브 구현에서 먼저 통과시킨 이 테스트가 그대로 통과해야 한다(apps/api/CONTRACT.md §5-9).
 *
 * <p>옮기는 문장은 {@code practices} 한 표만 쓰는 것이다 — 같은 요청 찾기, 리딩에서 시작한 회차, 이어하기의 출처·다음 차수·열린
 * 회차, 다시 분석의 단계 확인과 되돌리기, 그만두기의 회차 잠금·닫기, 묶음 속성 바꾸기, 회차 넣기, 이관. HTTP 경로(멱등·영상·한도·
 * 이어하기 경합·다시 분석 규칙·목록)는 {@link PracticeLifecycleIT}, 연습한 날은 {@link PracticeDaysIT} 가 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.practice.PracticeRepositoryIT$Recorder"
})
class PracticeRepositoryIT {

    /** 이 스레드가 보낸 SQL 을 모은다. 경합 쪽 스레드의 문장은 섞이지 않는다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    private static final String FINGERPRINT = "a".repeat(64);
    private static final String FIND = "select ai_jobs,analyses,coach_conversations,coach_messages,coach_notes,practices,videos";

    @Value("${spring.datasource.url}")
    private String databaseUrl;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PracticeRepository practices;

    @Autowired
    PracticeOwnership ownership;

    @Autowired
    PlatformTransactionManager transactionManager;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        Recorder.STATEMENTS.get().clear();
    }

    // ---- 포트 메서드마다 결과 ----

    @Test
    @DisplayName("startFromReading: 대화 단계의 첫 회차를 만들고 리딩 회차를 잇는다. 같은 리딩 회차는 다른 요청 id 로 다시 불러도 그 회차이고, 같은 요청 id 는 같은 회차다. existingFromReading 은 남의 것을 보지 않는다")
    void startFromReadingOpensOnePracticePerReadingSession() {
        UUID actor = member();
        UUID other = member();
        UUID reading = readingSession(actor);

        Started created = practices.startFromReading(actor, newPractice(UUID.randomUUID(), null, "reading"), reading, now);
        UUID id = created.practice().id();

        assertThat(created.outcome()).isEqualTo(StartOutcome.CREATED);
        assertThat(jdbc.queryForMap("""
                SELECT root_id,ordinal,stage,reading_session_id,session_purpose,face_mosaic,created_at=updated_at AS fresh
                FROM practices WHERE id=?
                """, id))
                .containsEntry("root_id", id).containsEntry("ordinal", 1).containsEntry("stage", "conversing")
                .containsEntry("reading_session_id", reading).containsEntry("session_purpose", "reading")
                .containsEntry("face_mosaic", false).containsEntry("fresh", true);
        assertThat(instant("SELECT created_at FROM practices WHERE id=?", id)).isEqualTo(now);
        assertThat(count("ai_jobs")).isZero();

        Started again = practices.startFromReading(actor, newPractice(UUID.randomUUID(), null, "reading"), reading, now);
        assertThat(again.outcome()).isEqualTo(StartOutcome.REPLAYED);
        assertThat(again.practice().id()).isEqualTo(id);
        assertThat(practices.existingFromReading(actor, reading)).isEqualTo(id);
        assertThat(practices.existingFromReading(other, reading)).isNull();
        assertThat(practices.existingFromReading(actor, UUID.randomUUID())).isNull();
        assertThat(count("practices")).isEqualTo(1);
    }

    @Test
    @DisplayName("continueGroup: 다음 차수는 묶음의 가장 큰 차수 + 1 이다. 영상을 보내지 않으면 출처 회차의 영상, 얼굴 가리기를 보내지 않으면 출처 회차의 값을 쓰고, 세션 목적은 첫 회차에서(리딩이면 평가로) 이어받는다. 남의 회차는 NOT_FOUND, 열린 회차가 있으면 IN_PROGRESS 다")
    void continueGroupTakesTheNextOrdinalAndInheritsFromTheSource() {
        UUID actor = member();
        UUID other = member();
        UUID video = video(actor);
        UUID root = practice(actor, null, 1, "closed", "conversation_closed", video);
        jdbc.update("UPDATE practices SET session_purpose='reading' WHERE id=?", root);
        UUID second = practice(actor, root, 2, "closed", "conversation_closed", video);
        jdbc.update("UPDATE practices SET face_mosaic=true WHERE id=?", second);
        practice(actor, root, 5, "closed", "conversation_closed", video);

        Started continued = practices.continueGroup(actor, second, null, newPractice(UUID.randomUUID(), null, null), null, now);

        assertThat(continued.outcome()).isEqualTo(StartOutcome.CREATED);
        UUID id = continued.practice().id();
        assertThat(jdbc.queryForMap("SELECT root_id,ordinal,video_id,face_mosaic,session_purpose,stage FROM practices WHERE id=?", id))
                .containsEntry("root_id", root).containsEntry("ordinal", 6).containsEntry("video_id", video)
                .containsEntry("face_mosaic", true).containsEntry("session_purpose", "evaluate")
                .containsEntry("stage", "analyzing");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM ai_jobs WHERE target_id=?", Integer.class, id)).isEqualTo(1);

        assertThat(practices.continueGroup(actor, second, null, newPractice(UUID.randomUUID(), null, null), null, now).outcome())
                .isEqualTo(StartOutcome.IN_PROGRESS);
        assertThat(practices.continueGroup(other, second, null, newPractice(UUID.randomUUID(), null, null), null, now).outcome())
                .isEqualTo(StartOutcome.NOT_FOUND);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM practices WHERE root_id=?", Integer.class, root)).isEqualTo(4);
    }

    @Test
    @DisplayName("retryAnalysis: 분석이 닫은·그만둔 회차만 analyzing 으로 되돌리고 close_reason 을 지우며 updated_at 은 넘긴 시각이다. 대화가 끝난·열린 회차는 NOT_FAILED, 남의 회차는 NOT_FOUND, 같은 요청 id 는 REPLAYED, 묶음에 열린 회차가 있으면 IN_PROGRESS 다")
    void retryAnalysisReopensOnlyAFailedOrCancelledPractice() {
        UUID actor = member();
        UUID other = member();
        UUID failed = practice(actor, null, 1, "closed", "analysis_failed", null);
        UUID talked = practice(actor, null, 1, "closed", "conversation_closed", null);
        UUID open = practice(actor, null, 1, "conversing", null, null);
        UUID cancelledRoot = practice(actor, null, 1, "closed", "cancelled", null);
        practice(actor, cancelledRoot, 2, "analyzing", null, null);
        UUID request = UUID.randomUUID();

        Started retried = practices.retryAnalysis(actor, failed, request, FINGERPRINT, null, now);

        assertThat(retried.outcome()).isEqualTo(StartOutcome.CREATED);
        assertThat(jdbc.queryForMap("SELECT stage,close_reason FROM practices WHERE id=?", failed))
                .containsEntry("stage", "analyzing").containsEntry("close_reason", null);
        assertThat(instant("SELECT updated_at FROM practices WHERE id=?", failed)).isEqualTo(now);
        assertThat(practices.retryAnalysis(actor, failed, request, FINGERPRINT, null, now).outcome())
                .isEqualTo(StartOutcome.REPLAYED);
        assertThat(practices.retryAnalysis(actor, talked, UUID.randomUUID(), FINGERPRINT, null, now).outcome())
                .isEqualTo(StartOutcome.NOT_FAILED);
        assertThat(practices.retryAnalysis(actor, open, UUID.randomUUID(), FINGERPRINT, null, now).outcome())
                .isEqualTo(StartOutcome.NOT_FAILED);
        assertThat(practices.retryAnalysis(other, failed, UUID.randomUUID(), FINGERPRINT, null, now).outcome())
                .isEqualTo(StartOutcome.NOT_FOUND);
        assertThat(practices.retryAnalysis(actor, cancelledRoot, UUID.randomUUID(), FINGERPRINT, null, now).outcome())
                .isEqualTo(StartOutcome.IN_PROGRESS);
        assertThat(count("ai_jobs")).isEqualTo(1);
    }

    @Test
    @DisplayName("cancel: 열린 분석 작업을 실패(cancelled)로 닫고 회차를 닫는다. 작업이 이미 끝났으면 ALREADY_DONE 이고 회차를 건드리지 않는다. 남의 회차는 NOT_FOUND 다")
    void cancelClosesTheOpenJobAndThePractice() {
        UUID actor = member();
        UUID other = member();
        UUID practice = practice(actor, null, 1, "analyzing", null, null);
        UUID job = job(actor, practice, "running");

        assertThat(practices.cancel(other, practice, now).outcome()).isEqualTo(CancelOutcome.NOT_FOUND);
        var cancelled = practices.cancel(actor, practice, now);

        assertThat(cancelled.outcome()).isEqualTo(CancelOutcome.CANCELLED);
        assertThat(cancelled.status().stage()).isEqualTo("closed");
        assertThat(jdbc.queryForMap("SELECT stage,close_reason FROM practices WHERE id=?", practice))
                .containsEntry("stage", "closed").containsEntry("close_reason", "cancelled");
        assertThat(instant("SELECT updated_at FROM practices WHERE id=?", practice)).isEqualTo(now);
        assertThat(jdbc.queryForMap("SELECT status,failure_reason,lease_token FROM ai_jobs WHERE id=?", job))
                .containsEntry("status", "failed").containsEntry("failure_reason", "cancelled").containsEntry("lease_token", null);

        jdbc.update("UPDATE practices SET updated_at=? WHERE id=?", utc(now.minusSeconds(60)), practice);
        assertThat(practices.cancel(actor, practice, now).outcome()).isEqualTo(CancelOutcome.ALREADY_DONE);
        assertThat(instant("SELECT updated_at FROM practices WHERE id=?", practice)).isEqualTo(now.minusSeconds(60));
    }

    @Test
    @DisplayName("updateGroup: 보낸 것만 바꾼다. 숨김은 처음 숨긴 시각을 지키고 풀면 지운다. 제목·즐겨찾기를 보내지 않으면 그대로다. updated_at 은 넘긴 시각이다. 첫 회차가 아니거나 남의 묶음이면 null 이다")
    void updateGroupChangesOnlyWhatWasSent() {
        UUID actor = member();
        UUID other = member();
        UUID root = practice(actor, null, 1, "closed", "conversation_closed", null);
        UUID second = practice(actor, root, 2, "closed", "conversation_closed", null);

        GroupView favored = practices.updateGroup(actor, root, true, null, "제목", now);
        assertThat(favored.favorite()).isTrue();
        assertThat(favored.title()).isEqualTo("제목");
        assertThat(favored.hiddenAt()).isNull();
        assertThat(favored.practices()).hasSize(2);

        practices.updateGroup(actor, root, null, true, null, now.plusSeconds(10));
        GroupView hiddenAgain = practices.updateGroup(actor, root, null, true, null, now.plusSeconds(20));
        assertThat(hiddenAgain.hiddenAt()).isEqualTo(now.plusSeconds(10));
        assertThat(hiddenAgain.favorite()).isTrue();
        assertThat(hiddenAgain.title()).isEqualTo("제목");
        assertThat(instant("SELECT updated_at FROM practices WHERE id=?", root)).isEqualTo(now.plusSeconds(20));

        GroupView shown = practices.updateGroup(actor, root, false, false, null, now.plusSeconds(30));
        assertThat(shown.hiddenAt()).isNull();
        assertThat(shown.favorite()).isFalse();
        assertThat(shown.title()).isEqualTo("제목");

        assertThat(practices.updateGroup(actor, second, true, null, null, now)).isNull();
        assertThat(practices.updateGroup(other, root, true, null, null, now)).isNull();
        assertThat(jdbc.queryForObject("SELECT favorite FROM practices WHERE id=?", Boolean.class, second)).isFalse();
    }

    @Test
    @DisplayName("start: 같은 요청 id 는 지문이 같으면 같은 회차, 다르면 FINGERPRINT_MISMATCH 다. 첫 회차는 제 묶음의 뿌리이고 차수 1 이다")
    void startReplaysByRequestIdAndChecksTheFingerprint() {
        UUID actor = member();
        UUID video = video(actor);
        UUID request = UUID.randomUUID();

        Started created = practices.start(actor, newPractice(request, video, null), null, now);
        Started replayed = practices.start(actor, newPractice(request, video, null), null, now);
        Started mismatched = practices.start(actor, new NewPractice(request, "b".repeat(64), video, "three_layers_v1",
                "상황", "", "목표", "분석", "캐릭터 분석", null, null, null, null), null, now);

        assertThat(created.outcome()).isEqualTo(StartOutcome.CREATED);
        assertThat(created.practice().rootId()).isEqualTo(created.practice().id());
        assertThat(created.practice().ordinal()).isEqualTo(1);
        assertThat(replayed.outcome()).isEqualTo(StartOutcome.REPLAYED);
        assertThat(replayed.practice().id()).isEqualTo(created.practice().id());
        assertThat(mismatched.outcome()).isEqualTo(StartOutcome.FINGERPRINT_MISMATCH);
        assertThat(count("practices")).isEqualTo(1);
    }

    @Test
    @DisplayName("reassign: 옛 표와 새 표의 회차를 함께 옮긴다")
    void reassignMovesPracticesOfBothFlows() {
        UUID guest = member();
        UUID memberUser = member();
        UUID root = practice(guest, null, 1, "closed", "conversation_closed", null);
        practice(guest, root, 2, "conversing", null, null);

        inTransaction(() -> {
            ownership.reassign(guest, memberUser);
            return null;
        });

        assertThat(jdbc.queryForList("SELECT user_id FROM practices", UUID.class)).containsOnly(memberUser);
    }

    // ---- 잠금 세기 ----

    @Test
    @DisplayName("이어하기·다시 분석·묶음 바꾸기는 묶음의 첫 행을, 그만두기는 그 회차 행을 FOR UPDATE 로 잡는다. 리딩에서 시작은 사용자 행을 잡는다 — 바깥 연결의 FOR KEY SHARE 뒤에서 기다린다")
    void groupAndPracticeLocksAreForUpdate() throws Exception {
        UUID actor = member();
        UUID root = practice(actor, null, 1, "closed", "analysis_failed", null);
        UUID analyzing = practice(actor, null, 1, "analyzing", null, null);
        job(actor, analyzing, "pending");
        UUID reading = readingSession(actor);
        record Case(String table, UUID row, String waitingOn, Supplier<?> write) {
        }
        List<Case> cases = List.of(
                new Case("practices", root, "from practices", () -> practices.updateGroup(actor, root, true, null, null, now)),
                new Case("practices", root, "from practices",
                        () -> practices.retryAnalysis(actor, root, UUID.randomUUID(), FINGERPRINT, null, now)),
                new Case("practices", analyzing, "from practices", () -> practices.cancel(actor, analyzing, now)),
                new Case("practices", root, "from practices",
                        () -> practices.continueGroup(actor, root, null, newPractice(UUID.randomUUID(), null, null), null, now)),
                new Case("users", actor, "from users",
                        () -> practices.startFromReading(actor, newPractice(UUID.randomUUID(), null, "reading"), reading, now)));
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            for (Case each : cases) {
                if (each.write() == cases.get(3).write()) {
                    jdbc.update("UPDATE practices SET stage='closed',close_reason='analysis_failed' WHERE root_id=? AND stage<>'closed'",
                            root);
                }
                lock(probe, "SELECT 1 FROM " + each.table() + " WHERE id=? FOR KEY SHARE", each.row());
                Future<?> waiting = pool.submit(each.write()::get);
                String statement = awaitWaiting(each.waitingOn()).toLowerCase(Locale.ROOT);
                probe.rollback();
                waiting.get(20, TimeUnit.SECONDS);
                assertThat(statement).as(each.waitingOn()).startsWith("select").contains("for update").doesNotContain("no key");
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT favorite FROM practices WHERE id=?", Boolean.class, root)).isTrue();
        assertThat(jdbc.queryForObject("SELECT stage FROM practices WHERE id=?", String.class, analyzing)).isEqualTo("closed");
    }

    // ---- 경합 ----

    @Test
    @DisplayName("같은 묶음을 두 요청이 함께 바꾸면 뒤의 것이 첫 행에서 기다렸다가 앞의 값 위에 보낸 것만 바꾼다")
    void twoGroupUpdatesAtOnce() throws Exception {
        UUID actor = member();
        UUID root = practice(actor, null, 1, "closed", "conversation_closed", null);

        Race<GroupView, GroupView> race = race(
                () -> practices.updateGroup(actor, root, null, true, null, now),
                () -> practices.updateGroup(actor, root, true, null, "나중", now.plusSeconds(5)),
                "from practices");

        assertThat(race.second().hiddenAt()).isEqualTo(now);
        assertThat(race.second().favorite()).isTrue();
        assertThat(race.second().title()).isEqualTo("나중");
    }

    @Test
    @DisplayName("같은 회차를 두 요청이 함께 그만두면 뒤의 것이 회차 행에서 기다렸다가 ALREADY_DONE 을 받는다")
    void twoCancelsAtOnce() throws Exception {
        UUID actor = member();
        UUID practice = practice(actor, null, 1, "analyzing", null, null);
        job(actor, practice, "pending");

        Race<Object, Object> race = race(
                () -> practices.cancel(actor, practice, now).outcome(),
                () -> practices.cancel(actor, practice, now).outcome(),
                "from practices");

        assertThat(race.first()).isEqualTo(CancelOutcome.CANCELLED);
        assertThat(race.second()).isEqualTo(CancelOutcome.ALREADY_DONE);
    }

    @Test
    @DisplayName("같은 리딩 회차에서 서로 다른 요청 id 로 함께 시작하면 뒤의 것이 사용자 행에서 기다렸다가 앞의 회차를 받는다")
    void twoStartsFromTheSameReadingAtOnce() throws Exception {
        UUID actor = member();
        UUID reading = readingSession(actor);

        Race<Started, Started> race = race(
                () -> practices.startFromReading(actor, newPractice(UUID.randomUUID(), null, "reading"), reading, now),
                () -> practices.startFromReading(actor, newPractice(UUID.randomUUID(), null, "reading"), reading, now),
                "from users");

        assertThat(race.first().outcome()).isEqualTo(StartOutcome.CREATED);
        assertThat(race.second().outcome()).isEqualTo(StartOutcome.REPLAYED);
        assertThat(race.second().practice().id()).isEqualTo(race.first().practice().id());
        assertThat(count("practices")).isEqualTo(1);
    }

    // ---- 문장 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류(읽고 쓰는 표의 모음으로 줄인다)")
    void eachPortMethodSendsTheseStatements() {
        UUID actor = member();
        UUID guest = member();
        UUID video = video(actor);
        UUID reading = readingSession(actor);
        UUID request = UUID.randomUUID();
        String practices1 = "select practices";

        Started[] created = new Started[1];
        assertThat(statementsOf(() -> created[0] = practices.start(actor, newPractice(request, video, null), null, now)))
                .as("영상으로 시작 — 요청이 많은 경로")
                .containsExactly(practices1, "select videos for update", "insert practices", "insert ai_jobs", FIND);
        UUID id = created[0].practice().id();
        assertThat(statementsOf(() -> practices.start(actor, newPractice(request, video, null), null, now)))
                .as("같은 요청").containsExactly(practices1, FIND);
        jdbc.update("UPDATE practices SET stage='closed',close_reason='analysis_failed' WHERE id=?", id);
        assertThat(statementsOf(() -> practices.start(actor, newPractice(UUID.randomUUID(), video, null),
                new Quota(5, now.minusSeconds(3600), Quota.Kind.SESSIONS), now)))
                .as("무료 코칭 한도가 있을 때")
                .containsExactly(practices1, "select videos for update", "select users for update",
                        "select practice_deletion_marks,practices", "insert practices", "insert ai_jobs", FIND);
        assertThat(statementsOf(() -> practices.startWithoutVideo(actor, newPractice(UUID.randomUUID(), null, null),
                new Quota(5, now.minusSeconds(3600)), now)))
                .as("게스트 분석 한도가 있을 때")
                .containsExactly(practices1, "select users for update", "select ai_jobs,external_operations",
                        "insert practices", FIND);
        assertThat(statementsOf(() -> practices.startFromReading(actor, newPractice(UUID.randomUUID(), null, "reading"),
                reading, now)))
                .containsExactly(practices1, "select users for update", practices1, "insert practices", "update practices", FIND);
        assertThat(statementsOf(() -> practices.startFromReading(actor, newPractice(UUID.randomUUID(), null, "reading"),
                reading, now)))
                .as("이미 시작했을 때").containsExactly(practices1, "select users for update", practices1, FIND);
        assertThat(statementsOf(() -> practices.existingFromReading(actor, reading))).containsExactly(practices1);
        assertThat(statementsOf(() -> practices.find(actor, id))).as("요청이 많은 경로").containsExactly(FIND);
        assertThat(statementsOf(() -> practices.status(actor, id))).containsExactly(FIND);
        assertThat(statementsOf(() -> practices.groups(actor, null, now))).as("목록 — 요청이 많은 경로").containsExactly(FIND);
        assertThat(statementsOf(() -> practices.practiceDays(actor))).containsExactly(
                "select challenge_entries,coach_conversations,coach_notes,practice_reports,practice_sessions,practices,reading_sessions");
        assertThat(statementsOf(() -> practices.retryAnalysis(actor, id, UUID.randomUUID(), FINGERPRINT, null, now)))
                .containsExactly("select ai_jobs,practices", practices1, "select practices for update", practices1, practices1,
                        practices1, "update practices", "insert ai_jobs", FIND);
        assertThat(statementsOf(() -> practices.cancel(actor, id, now)))
                .containsExactly("select practices for update", "update ai_jobs", "update practices", FIND);
        assertThat(statementsOf(() -> practices.continueGroup(actor, id, null, newPractice(UUID.randomUUID(), null, null),
                null, now)))
                .containsExactly(practices1, practices1, "select practices for update", practices1, "select videos for update",
                        practices1, "insert practices", "insert ai_jobs", FIND);
        assertThat(statementsOf(() -> practices.updateGroup(actor, id, true, true, "제목", now)))
                .as("묶음 속성은 노트가 생긴 회차 수(practiced_count, SOMA-810)와 함께 읽는다")
                .containsExactly("select practices for update", "update practices", FIND,
                        "select coach_conversations,coach_notes,practices");
        assertThat(statementsOf(() -> inTransaction(() -> {
            ownership.reassign(actor, guest);
            return null;
        }))).containsExactly("update practice_sessions", "update practices");
    }

    // ---- 도움 ----

    private static final Pattern TABLE = Pattern.compile("\\b(?:from|join|into|update)\\s+(\\w+)");

    /**
     * 문장을 "<종류> <표,…>[ for update]" 로 줄인다. 표는 FROM·JOIN·INTO·UPDATE 뒤에 나오는 이름을 모두 모아 정렬한다 — 두 구현의
     * 별칭·열 목록·잠금 절의 {@code of <별칭>} 이 달라도 같은 이름이 된다.
     */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT).replaceAll(" for update of \\w+", " for update");
        String kind = text.split("[ (]", 2)[0];
        TreeSet<String> tables = new TreeSet<>();
        Matcher matcher = TABLE.matcher(text);
        while (matcher.find()) {
            String name = matcher.group(1);
            if (!List.of("lateral", "set", "only").contains(name)) {
                tables.add(name);
            }
        }
        return kind + " " + String.join(",", tables) + (text.contains(" for update") ? " for update" : "");
    }

    private List<String> statementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = Recorder.STATEMENTS.get().stream().map(PracticeRepositoryIT::label).toList();
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    /** 앞의 것이 트랜잭션 안에서 먼저 끝나고 잡은 채 기다리는 동안 뒤의 것이 {@code waitingOn} 을 담은 문장에서 기다린다. */
    private <A, B> Race<A, B> race(Supplier<A> firstCall, Supplier<B> secondCall, String waitingOn) throws Exception {
        CountDownLatch held = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<A> first = pool.submit(() -> inTransaction(() -> {
                A result = firstCall.get();
                held.countDown();
                await(release);
                return result;
            }));
            await(held);
            Future<B> second = pool.submit(secondCall::get);
            awaitWaiting(waitingOn);
            release.countDown();
            return new Race<>(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    private record Race<A, B>(A first, B second) {
    }

    private <T> T inTransaction(Supplier<T> body) {
        return new TransactionTemplate(transactionManager).execute(status -> body.get());
    }

    private NewPractice newPractice(UUID requestId, UUID videoId, String sessionPurpose) {
        return new NewPractice(requestId, FINGERPRINT, videoId, "three_layers_v1", "상황", "", "목표", "분석", "캐릭터 분석",
                null, null, sessionPurpose, null);
    }

    private UUID member() {
        UUID userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", userId);
        return userId;
    }

    private UUID video(UUID owner) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,12000)
                """, id, owner, "videos/" + owner + "/" + id + ".mp4");
        return id;
    }

    /** @param root {@code null} 이면 제 묶음의 첫 회차다 */
    private UUID practice(UUID owner, UUID root, int ordinal, String stage, String closeReason, UUID video) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,close_reason,experience_version,
                                      blockage_kind,sub_branch,situation,goal,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,'three_layers_v1','분석','캐릭터 분석','상황','목표',?,?)
                """, id, owner, video, root == null ? id : root, ordinal, stage, closeReason, utc(now.minusSeconds(600)),
                utc(now.minusSeconds(600)));
        return id;
    }

    private UUID job(UUID owner, UUID practice, String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,status,lease_token)
                VALUES (?,?,'analyze',?,?,?,?,?)
                """, id, owner, practice, UUID.randomUUID(), FINGERPRINT, status,
                "running".equals(status) ? UUID.randomUUID() : null);
        return id;
    }

    private UUID readingSession(UUID owner) {
        UUID script = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO scripts(id,user_id,title,raw_text,raw_hash,source,request_id,request_fingerprint)
                VALUES (?,?,'대본','원문',repeat('0',64),'paste',?,?)
                """, script, owner, UUID.randomUUID(), "f".repeat(64));
        UUID line = UUID.randomUUID();
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,text) VALUES (?,?,0,'direction','지문')", line, script);
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO reading_sessions(id,script_id,user_id,request_id,my_character_ids,mode,start_line_id,end_line_id,
                                             advance,record,status,started_at,updated_at,ended_at)
                VALUES (?,?,?,?,CAST('{}' AS uuid[]),'read',?,?,'silence',true,'completed',now(),now(),now())
                """, id, script, owner, UUID.randomUUID(), line, line);
        return id;
    }

    private static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    private Instant instant(String sql, Object... args) {
        return jdbc.queryForObject(sql, OffsetDateTime.class, args).toInstant();
    }

    private Connection probe() throws Exception {
        Connection connection = DriverManager.getConnection(databaseUrl,
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
        connection.setAutoCommit(false);
        return connection;
    }

    private static void lock(Connection probe, String sql, UUID id) throws Exception {
        try (PreparedStatement statement = probe.prepareStatement(sql)) {
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

    /** 잠금을 기다리는 문장 가운데 {@code fragment} 를 담은 것. */
    private String awaitWaiting(String fragment) throws Exception {
        Instant deadline = Instant.now().plusSeconds(10);
        while (Instant.now().isBefore(deadline)) {
            List<String> waiting = jdbc.queryForList("""
                    SELECT regexp_replace(query, '\\s+', ' ', 'g') FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock'
                    """, String.class).stream()
                    .filter(query -> query.toLowerCase(Locale.ROOT).contains(fragment))
                    .toList();
            if (!waiting.isEmpty()) {
                return waiting.getFirst().strip();
            }
            Thread.sleep(10);
        }
        throw new AssertionError("'" + fragment + "' 를 담은 문장이 잠금 뒤에서 기다리지 않았다");
    }
}
