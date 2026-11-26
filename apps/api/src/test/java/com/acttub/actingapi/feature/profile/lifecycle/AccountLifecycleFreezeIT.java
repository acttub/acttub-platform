package com.acttub.actingapi.feature.profile.lifecycle;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.profile.app.AccountHousekeeping;
import com.acttub.actingapi.feature.profile.lifecycle.AccountLifecycleSeed.Identity;
import com.acttub.actingapi.feature.profile.lifecycle.DatabaseChanges.UserColumn;
import com.acttub.actingapi.integration.revenuecat.RevenueCatCustomerClient;
import com.acttub.actingapi.platform.security.AccountSecrets;
import com.acttub.actingapi.support.FakeObjectStorage;
import com.acttub.actingapi.support.FrozenValue;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.StubProviders;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.ObjectMapper;

/**
 * 계정 수명 일의 지금 동작을 고정한다: 탈퇴, 만 14세 미만 계정 닫기, 탈퇴 3년 뒤 파기, 게스트 이전, 연습 삭제, 알림 끄기.
 *
 * <p>탈퇴는 되돌릴 수 없는 삭제다. 이 일들을 고치는 변경은 이 테스트를 <b>고치지 않고</b> 통과해야 한다. 고쳐야 통과한다면
 * 동작이 달라진 것이다.
 *
 * <p>시나리오마다 보는 것:
 * <ul>
 *   <li>표마다 행 수, 그 사람을 가리키는 행 수, 지워진·생긴·고쳐진 행과 달라진 칸({@link DatabaseChanges}). 지워야 할 것이
 *       빠지지 않았는지와 남겨야 할 것을 지우지 않았는지가 함께 보인다. 곁에 둔 다른 회원의 행이 달라져도 드러난다.</li>
 *   <li>정리 장부({@code account_cleanup_operations})에 올라간 일의 종류와 객체 키. 저장소와 제공자를 실패하게 해 두어
 *       커밋 뒤의 첫 시도가 끝나도 행이 남는다({@code attempt_count=1} 이면 그 일을 커밋 뒤에 시도한 것이다).</li>
 *   <li>요청이 내는 문장의 종류와 차례, 트랜잭션의 시작과 끝({@link StatementTrace}). 잠금을 잡는 차례와 한 트랜잭션의 범위가
 *       달라지면 드러난다.</li>
 * </ul>
 *
 * <p>기준 파일은 {@code src/test/resources/frozen/account-lifecycle/} 에 있고 지금 코드가 낸 값이다. 실행한 결과는
 * {@code build/account-lifecycle/} 에 같은 이름으로 남는다. 기준을 바꿔야 하면 그 차이를 읽고 손으로 옮긴다({@link FrozenValue}).
 *
 * <p>심는 자료가 표를 빠뜨리지 않았는지는 {@link #seedReachesEveryTableThatPointsAtUsers} 가 DB 카탈로그와 맞춰 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.profile.lifecycle.StatementTrace"
})
@AutoConfigureMockMvc
@Import({
    StubProviders.class,
    MutableClock.Fixture.class,
    FakeObjectStorage.Fixture.class,
    RecordingFailureReporter.Fixture.class,
    StatementTrace.Transactions.class,
    AccountLifecycleFreezeIT.RevenueCatDown.class
})
class AccountLifecycleFreezeIT {

    private static final Instant NOW = Instant.parse("2026-11-20T03:00:00Z");

    /** 사람을 가리키는 칸의 이름. {@code users} 를 가리키는 외래 키의 칸은 모두 이 모양이어야 한다. */
    private static final Pattern USER_COLUMN = Pattern.compile("(\\w+_)?user_id|(author|uploader|reporter|blocker|blocked|viewer)_id");

    /** 이름은 사람을 가리키는데 {@code users} 로 가는 외래 키가 없는 칸. 카탈로그에서 이름으로 찾은 것과 같아야 한다. */
    private static final List<UserColumn> WITHOUT_FOREIGN_KEY = List.of(
            new UserColumn("portfolio_credits", "user_id"),
            new UserColumn("portfolio_photos", "user_id"),
            new UserColumn("reading_pronunciation_reports", "user_id"),
            new UserColumn("support_inquiries", "user_id"),
            new UserColumn("user_profile_directions", "user_id"));

    /** RevenueCat 을 켠 서버로 본다. 고객 삭제는 실패해 장부에 남는다. */
    @TestConfiguration(proxyBeanMethods = false)
    static class RevenueCatDown {
        @Bean
        @Primary
        RevenueCatCustomerClient revenueCatDown() {
            return new RevenueCatCustomerClient() {
                @Override
                public boolean enabled() {
                    return true;
                }

                @Override
                public void delete(String appUserId) {
                    throw new IllegalStateException("stub revenuecat is down");
                }
            };
        }
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    JwtService jwt;

    @Autowired
    MutableClock clock;

    @Autowired
    AccountSecrets secrets;

    @Autowired
    AccountHousekeeping housekeeping;

    @Autowired
    FakeObjectStorage storage;

    @Autowired
    RecordingFailureReporter failures;

    @Autowired
    StubProviders.StubAppleTokens apple;

    @Autowired
    StubProviders.StubKakaoUsers kakao;

    @Autowired
    StubProviders.StubNaverTokens naver;

    private DatabaseChanges changes;
    private AccountLifecycleSeed seed;
    private final Map<String, UUID> people = new LinkedHashMap<>();

    @BeforeEach
    void setUp(org.junit.jupiter.api.TestInfo test) {
        jdbc.execute("TRUNCATE TABLE users,consent_documents,ads,support_inquiries,practice_migration_entries RESTART IDENTITY CASCADE");
        clock.set(NOW);
        storage.clear();
        failures.clear();
        apple.reset();
        kakao.reset();
        naver.reset();
        changes = new DatabaseChanges(jdbc);
        seed = new AccountLifecycleSeed(jdbc, secrets, NOW, test.getTestMethod().orElseThrow().getName());
        seed.shared();
        people.clear();
        people.put("지운 연습 보관 계정", AccountLifecycleSeed.DELETED_PRACTICE_OWNER);
    }

    // ---- 심는 자료 ----

    @Test
    @DisplayName("심는 자료: users 를 가리키는 외래 키의 표, 이름으로 사람을 가리키는 표, users 에서 외래 키로 닿는 표에 모두 그 사람의 행이 있다")
    void seedReachesEveryTableThatPointsAtUsers() {
        UUID self = member("본인", "declined");
        member("남", "granted");
        seed.cross("본인", "남");
        seed.cross("남", "본인");

        List<UserColumn> foreignKeys = foreignKeysToUsers();
        assertThat(foreignKeys).as("질의가 비면 아래 비교가 조용히 통과한다").hasSizeGreaterThan(60);
        assertThat(foreignKeys)
                .as("users 를 가리키는 칸의 이름이 USER_COLUMN 에 맞지 않는다. 새 이름이면 USER_COLUMN 에 더한다")
                .allMatch(reference -> USER_COLUMN.matcher(reference.column()).matches());
        List<UserColumn> namedOnly = jdbc.query("""
                SELECT table_name,column_name
                FROM information_schema.columns
                WHERE table_schema=current_schema() AND data_type='uuid' AND table_name<>'flyway_schema_history'
                ORDER BY table_name,column_name
                """, (row, n) -> new UserColumn(row.getString(1), row.getString(2))).stream()
                .filter(reference -> USER_COLUMN.matcher(reference.column()).matches())
                .filter(reference -> !foreignKeys.contains(reference))
                .toList();
        assertThat(namedOnly)
                .as("외래 키 없이 사람을 가리키는 칸이 달라졌다. WITHOUT_FOREIGN_KEY 와 심는 자료를 함께 고친다")
                .containsExactlyElementsOf(WITHOUT_FOREIGN_KEY);

        for (UserColumn reference : userColumns()) {
            assertThat(jdbc.queryForObject(
                    "SELECT count(*) FROM " + reference.table() + " WHERE " + reference.column() + "=?", Integer.class, self))
                    .as("%s.%s 에 본인을 가리키는 행이 없다. AccountLifecycleSeed 에 심는다", reference.table(), reference.column())
                    .isPositive();
        }
        List<String> reachable = reachableFromUsers();
        assertThat(reachable).hasSizeGreaterThan(75);
        for (String table : reachable) {
            assertThat(jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class))
                    .as("users 에서 외래 키로 닿는 표 %s 에 심은 행이 없다. AccountLifecycleSeed 에 심는다", table)
                    .isPositive();
        }
    }

    // ---- 탈퇴 ----

    @Test
    @DisplayName("탈퇴(보관 동의 없음): 영상·녹음을 파기하고 장부에 올린다")
    void withdrawDeclined() throws Exception {
        UUID self = member("본인", "declined");
        bystander();
        failEveryCleanup();

        assertFrozen("withdraw-declined", observe(() -> expect(200, delete("/v2/me"), self)));
    }

    @Test
    @DisplayName("탈퇴(보관 동의 있음): 영상·녹음은 남고 사진과 대본 원본만 장부에 올린다")
    void withdrawRetained() throws Exception {
        UUID self = member("본인", "granted");
        bystander();
        failEveryCleanup();

        assertFrozen("withdraw-retained", observe(() -> expect(200, delete("/v2/me"), self)));
    }

    @Test
    @DisplayName("탈퇴(게스트): 신원은 해시 없이 지운다")
    void withdrawGuest() throws Exception {
        UUID self = seed.full("본인", Identity.GUEST, "declined");
        people.put("본인", self);
        bystander();
        failEveryCleanup();

        assertFrozen("withdraw-guest", observe(() -> expect(200, delete("/v2/me"), self)));
    }

    @Test
    @DisplayName("다시 온 탈퇴: 최초 탈퇴 시각을 유지하고 파기만 다시 돈다")
    void withdrawAgain() throws Exception {
        UUID self = member("본인", "declined");
        bystander();
        failEveryCleanup();
        String first = expect(200, delete("/v2/me"), self);
        clock.advance(java.time.Duration.ofHours(1));

        String[] second = new String[1];
        assertFrozen("withdraw-again", observe(() -> second[0] = expect(200, delete("/v2/me"), self)));
        assertThat(second[0]).as("탈퇴 시각은 처음 값 그대로다").isEqualTo(first);
    }

    // ---- 만 14세 미만 계정 닫기 ----

    @Test
    @DisplayName("만 14세 미만(자료 있음): 탈퇴와 같은 절차로 닫고, 보관 동의가 있어도 영상을 파기한다")
    void underageWithHistory() throws Exception {
        UUID self = member("본인", "granted");
        bystander();
        failEveryCleanup();
        jdbc.update("UPDATE user_profiles SET goal=NULL WHERE user_id=?", self);

        assertFrozen("underage-with-history", observe(() -> assertThat(expect(422, underageProfile(), self))
                .contains("under_14_account_closed")));
    }

    @Test
    @DisplayName("만 14세 미만: users 를 지우기 막는 외래 키(ON DELETE 없음)의 칸마다 그 칸에 자료가 있는지 보거나 그 행을 지우는 주인이 있다")
    void everyForeignKeyBlockingTheAccountRowHasAnOwner() throws Exception {
        UUID self = seed.light("본인", Identity.MEMBER, "granted");
        jdbc.update("UPDATE user_profiles SET goal=NULL WHERE user_id=?", self);
        List<String> statements;
        StatementTrace.start();
        try {
            assertThat(expect(422, underageProfile(), self)).contains("under_14_account_closed");
            statements = StatementTrace.sql();
        } finally {
            StatementTrace.stop();
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM users WHERE id=?", Integer.class, self))
                .as("자료가 없는 계정이라 모든 주인에게 묻고 행째 지운다")
                .isZero();

        List<UserColumn> blocking = jdbc.query("""
                SELECT child.relname,att.attname
                FROM pg_constraint con
                JOIN pg_class child ON child.oid = con.conrelid
                JOIN pg_class parent ON parent.oid = con.confrelid
                JOIN pg_namespace ns ON ns.oid = child.relnamespace
                JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
                WHERE con.contype = 'f' AND parent.relname = 'users' AND ns.nspname = current_schema()
                  AND con.confdeltype IN ('a', 'r')
                ORDER BY 1,2
                """, (row, n) -> new UserColumn(row.getString(1), row.getString(2)));
        assertThat(blocking).as("질의가 비면 아래 비교가 조용히 통과한다").hasSizeGreaterThan(30);
        for (UserColumn reference : blocking) {
            Pattern asked = Pattern.compile("\\bfrom " + reference.table() + "\\b.*\\b" + reference.column() + "\\s*=");
            assertThat(statements)
                    .as("%s.%s 를 보는 주인이 없다. 그 표에 행이 있는 계정의 만 14세 미만 닫기가 외래 키로 실패한다. "
                            + "그 표의 주인이 AccountErasure#hasRecords 에서 세거나(남기는 자료) eraseWithAccountRow 에서 지운다(계정과 함께 지우는 행)",
                            reference.table(), reference.column())
                    .anyMatch(statement -> asked.matcher(statement).find());
        }
    }

    @Test
    @DisplayName("만 14세 미만(자료 없음): 계정 행을 지운다")
    void underageWithoutHistory() throws Exception {
        UUID self = seed.light("본인", Identity.MEMBER, "granted");
        people.put("본인", self);
        member("남", "granted");
        failEveryCleanup();
        jdbc.update("UPDATE user_profiles SET goal=NULL WHERE user_id=?", self);

        assertFrozen("underage-without-history", observe(() -> assertThat(expect(422, underageProfile(), self))
                .contains("under_14_account_closed")));
    }

    // ---- 탈퇴 3년 뒤 파기 ----

    @Test
    @DisplayName("탈퇴 3년 뒤 파기: 보관하던 영상·녹음을 장부에 올리고 신원 해시 행을 지운다")
    void retentionPurge() throws Exception {
        UUID self = member("본인", "granted");
        bystander();
        // 탈퇴가 올린 정리는 치운다. 3년 뒤의 매일 정리가 올리는 것만 남게.
        expect(200, delete("/v2/me"), self);
        jdbc.update("DELETE FROM account_cleanup_operations");
        failEveryCleanup();
        clock.set(NOW.atZone(ZoneId.of("Asia/Seoul")).plusYears(3).plusDays(1).toInstant());

        assertFrozen("retention-purge", observe(housekeeping::runDaily));
    }

    // ---- 게스트 이전 ----

    @Test
    @DisplayName("게스트 이전: 게스트의 자료 행이 회원 것이 되고 게스트 계정은 닫힌다")
    void guestTransfer() throws Exception {
        UUID guest = seed.full("게스트", Identity.GUEST, "declined");
        people.put("게스트", guest);
        UUID member = member("회원", "granted");
        member("남", "granted");
        for (String other : List.of("게스트", "회원")) {
            seed.cross(other, "남");
            seed.cross("남", other);
        }
        failEveryCleanup();
        String code = mapper.readTree(expect(201, post("/v2/guest/transfer-code"), guest)).path("code").stringValue(null);

        assertFrozen("guest-transfer", observe(() -> expect(200, post("/v2/guest-transfers")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("code", code, "memory_choice", "guest"))), member)));
    }

    // ---- 연습 삭제 ----

    @Test
    @DisplayName("연습 삭제(보관 동의 없음): 묶음을 보관 계정으로 옮기고 그 묶음만 쓰던 영상의 파일을 파기한다")
    void practiceDeleteDeclined() throws Exception {
        UUID self = member("본인", "declined");
        bystander();
        failEveryCleanup();

        assertFrozen("practice-delete-declined", observe(() -> expect(
                204, delete("/v2/practices/" + seed.id("본인/연습/묶음/1회차") + "/group"), self)));
    }

    @Test
    @DisplayName("연습 삭제(보관 동의 있음): 그 묶음만 쓰던 영상의 파일은 남기고 지운 영상으로 적어 둔다")
    void practiceDeleteRetained() throws Exception {
        UUID self = member("본인", "granted");
        bystander();
        failEveryCleanup();

        assertFrozen("practice-delete-retained", observe(() -> expect(
                204, delete("/v2/practices/" + seed.id("본인/연습/묶음/1회차") + "/group"), self)));
    }

    // ---- 알림 끄기 ----

    @Test
    @DisplayName("알림 끄기(셋 다): 토글을 끄고 그 회원의 푸시 토큰을 같은 트랜잭션에서 전부 지운다")
    void notificationsAllOff() throws Exception {
        UUID self = member("본인", "declined");
        bystander();

        assertFrozen("notifications-all-off", observe(() -> expect(200, patch("/v2/me/notification-settings")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(
                        Map.of("analysis_done", false, "challenge", false, "evening_reminder", false))), self)));
    }

    @Test
    @DisplayName("알림 끄기(하나만): 켜진 토글이 남아 있으면 푸시 토큰은 그대로다")
    void notificationsOneOff() throws Exception {
        UUID self = member("본인", "declined");
        bystander();

        assertFrozen("notifications-one-off", observe(() -> expect(200, patch("/v2/me/notification-settings")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("challenge", false))), self)));
    }

    // ---- 도구 ----

    private interface Action {
        void run() throws Exception;
    }

    private UUID member(String who, String retention) {
        UUID user = seed.full(who, Identity.MEMBER, retention);
        people.put(who, user);
        return user;
    }

    /** 곁에 두는 다른 회원. 본인과 서로 차단·좋아요·댓글·신고를 남긴다. 이 사람의 행은 달라지면 안 된다. */
    private void bystander() {
        member("남", "granted");
        seed.cross("본인", "남");
        seed.cross("남", "본인");
    }

    /** 객체 삭제와 제공자 해제를 모두 실패하게 한다. 커밋 뒤의 첫 시도가 끝나도 장부의 행이 남는다. */
    private void failEveryCleanup() {
        storage.failing.addAll(seed.objectKeys);
        apple.unavailable = true;
        kakao.unavailable = true;
        naver.unavailable = true;
    }

    private MockHttpServletRequestBuilder underageProfile() {
        Map<String, Object> profile = new LinkedHashMap<>();
        profile.put("name", "김배우");
        profile.put("gender", "female");
        profile.put("birth_date", LocalDate.now(clock.withZone(ZoneId.of("Asia/Seoul"))).minusYears(13).toString());
        profile.put("directions", List.of("media"));
        profile.put("experience", "before_start");
        profile.put("goal", "hobby");
        return put("/v2/me/profile").contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(profile));
    }

    private String expect(int status, MockHttpServletRequestBuilder request, UUID user) throws Exception {
        var response = mvc.perform(request.header("Authorization", "Bearer " + jwt.issueAccessToken(user).value()))
                .andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return response.getContentAsString();
    }

    /** 일을 하기 전과 뒤의 DB 를 견주고, 그 사이에 이 스레드가 보낸 문장을 모은다. */
    private List<String> observe(Action action) throws Exception {
        DatabaseChanges.Snapshot before = changes.read();
        List<String> statements;
        StatementTrace.start();
        try {
            action.run();
        } finally {
            statements = StatementTrace.stop();
        }
        DatabaseChanges.Snapshot after = changes.read();
        List<String> lines = new ArrayList<>();
        lines.add("== 표 ==");
        List<String> scope = new ArrayList<>(reachableFromUsers());
        WITHOUT_FOREIGN_KEY.forEach(reference -> scope.add(reference.table()));
        lines.addAll(changes.describe(
                before, after, seed.names, seed.texts, people, userColumns(), scope, clock.instant(), secrets::decrypt));
        lines.add("== 문장 ==");
        lines.addAll(statements);
        return lines;
    }

    private void assertFrozen(String scenario, List<String> actual) {
        Path written = Path.of("build", "account-lifecycle", scenario + ".txt");
        try {
            Files.createDirectories(written.getParent());
            Files.writeString(written, String.join("\n", actual));
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
        assertThat(actual)
                .as("계정 수명 일의 동작이 기준과 다르다(frozen/account-lifecycle/%s.txt). 이번 결과는 %s 에 있다", scenario, written)
                .containsExactlyElementsOf(FrozenValue.linesOf("account-lifecycle/" + scenario + ".txt"));
    }

    private List<UserColumn> userColumns() {
        List<UserColumn> columns = new ArrayList<>(foreignKeysToUsers());
        columns.addAll(WITHOUT_FOREIGN_KEY);
        return columns;
    }

    /** {@code users} 와, 거기서 외래 키를 따라 닿는 표(사람의 자료가 든 표). */
    private List<String> reachableFromUsers() {
        return jdbc.queryForList("""
                WITH RECURSIVE reach(oid) AS (
                    SELECT 'users'::regclass::oid
                    UNION
                    SELECT con.conrelid FROM pg_constraint con JOIN reach ON con.confrelid=reach.oid WHERE con.contype='f'
                )
                SELECT c.relname FROM pg_class c JOIN reach ON reach.oid=c.oid ORDER BY 1
                """, String.class);
    }

    private List<UserColumn> foreignKeysToUsers() {
        return jdbc.query("""
                SELECT child.relname,att.attname
                FROM pg_constraint con
                JOIN pg_class child ON child.oid=con.conrelid
                JOIN pg_class parent ON parent.oid=con.confrelid
                JOIN pg_namespace ns ON ns.oid=child.relnamespace
                JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=con.conkey[1]
                WHERE con.contype='f' AND parent.relname='users' AND ns.nspname=current_schema()
                ORDER BY 1,2
                """, (row, n) -> new UserColumn(row.getString(1), row.getString(2)));
    }
}
