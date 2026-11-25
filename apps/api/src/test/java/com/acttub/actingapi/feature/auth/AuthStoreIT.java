package com.acttub.actingapi.feature.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.auth.app.AuthRepository;
import com.acttub.actingapi.feature.auth.app.GuestAccounts;
import com.acttub.actingapi.feature.auth.app.IdentityAlreadyLinkedError;
import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.platform.schema.UserStatus;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.security.AuthenticatedUsers;
import com.acttub.actingapi.support.AccountFixtures;
import org.assertj.core.api.SoftAssertions;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 인증 저장소({@code PostgresAuthRepository}·{@code RefreshTokenJpaRepository})가 내는 결과·경합·문장 수를 실제 PostgreSQL 에서
 * 고정한다. 자기 표({@code users}·{@code user_identities}·{@code refresh_tokens}·{@code user_active_days})만 쓰는 문장을 네이티브
 * SQL 에서 JPA 로 옮길 때 네이티브 구현에서 먼저 통과시킨 이 테스트가 그대로 통과해야 한다(apps/api/CONTRACT.md §5-9). 인증 확인은
 * 모든 보호 요청이 지나므로 <b>보호 요청 하나가 보내는 문장 전체</b>를 함께 고정한다.
 *
 * <p>로그인·가입·게스트·이관·로그아웃·제공자 연결 끊기는 {@code Account*IT}·{@code ProviderDisconnectCallbackIT}, 신원 잇기의
 * 멱등·토큰 회전의 판정과 잠금 대기·접속일은 {@link AuthRepositoryIT}·{@link RefreshRotationIT} 가 본다. 여기서는 그 테스트가 밟지
 * 않는 인증 확인의 게스트 판정 갈래, 옮겨진 게스트 닫기의 모든 칸과 트랜잭션 요구, 제공자 목록의 순서, 이메일 바꾸기의 대소문자,
 * 제공자 토큰 칸, 같은 신원을 두 회원이 함께 이을 때, 포트 메서드마다 나가는 문장을 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.auth.AuthStoreIT$Recorder"
})
@AutoConfigureMockMvc
// 이 클래스만 쓰는 설정(StatementInspector)이라 끝나면 닫는다.
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class AuthStoreIT {

    /** 이 스레드가 보낸 SQL 을 모은다. 경합 쪽 스레드의 문장은 섞이지 않는다. MockMvc 요청은 같은 스레드에서 돈다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    AuthRepository accounts;

    @Autowired
    AuthenticatedUsers authenticated;

    @Autowired
    GuestAccounts guests;

    @Autowired
    JwtService jwt;

    @Autowired
    MockMvc mvc;

    @Autowired
    PlatformTransactionManager transactionManager;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        Recorder.STATEMENTS.get().clear();
    }

    // ---- 인증 확인 ----

    @Test
    @DisplayName("find 는 id·이메일·상태를 읽고, 신원이 있고 전부 guest 일 때만 게스트다. 신원이 없거나 guest 가 아닌 신원이 하나라도 있으면 게스트가 아니다. 없는 id 는 null")
    void findReadsTheGuestFlagFromIdentities() {
        UUID member = user("member@example.test", "active");
        identity(member, "google", "g-1");
        UUID guest = user(null, "active");
        identity(guest, "guest", "guest-1");
        identity(guest, "guest", "guest-2");
        UUID bare = user("bare@example.test", "active");
        UUID mixed = user(null, "active");
        identity(mixed, "guest", "guest-3");
        identity(mixed, "kakao", "k-1");
        UUID closedGuest = user(null, "deactivated");
        identity(closedGuest, "guest", "guest-4");
        UUID nullUid = user(null, "active");
        hashedIdentity(nullUid, "apple");

        assertThat(authenticated.find(member)).isEqualTo(new AuthenticatedUser(member, "member@example.test", UserStatus.ACTIVE, false));
        assertThat(authenticated.find(guest)).isEqualTo(new AuthenticatedUser(guest, null, UserStatus.ACTIVE, true));
        assertThat(authenticated.find(bare)).isEqualTo(new AuthenticatedUser(bare, "bare@example.test", UserStatus.ACTIVE, false));
        assertThat(authenticated.find(mixed)).isEqualTo(new AuthenticatedUser(mixed, null, UserStatus.ACTIVE, false));
        assertThat(authenticated.find(closedGuest))
                .isEqualTo(new AuthenticatedUser(closedGuest, null, UserStatus.DEACTIVATED, true));
        assertThat(authenticated.find(nullUid)).as("uid 가 비어도 guest 가 아닌 신원이다")
                .isEqualTo(new AuthenticatedUser(nullUid, null, UserStatus.ACTIVE, false));
        assertThat(authenticated.find(UUID.randomUUID())).isNull();
    }

    // ---- 옮겨진 게스트 닫기 ----

    @Test
    @DisplayName("closeTransferredGuest 는 그 게스트만 deactivated·시각을 적고 신원을 지우며 아직 살아 있는 리프레시 토큰만 폐기한다(행은 남긴다)")
    void closeTransferredGuestTouchesOnlyThatGuest() {
        UUID guest = user(null, "active");
        identity(guest, "guest", "guest-close");
        UUID other = user(null, "active");
        identity(other, "guest", "guest-keep");
        accounts.issueRefresh(guest, "a".repeat(64), now.plusSeconds(3600), null, now.minusSeconds(60));
        accounts.issueRefresh(guest, "b".repeat(64), now.plusSeconds(3600), null, now.minusSeconds(60));
        accounts.revoke("b".repeat(64), now.minusSeconds(30));
        accounts.issueRefresh(other, "c".repeat(64), now.plusSeconds(3600), null, now.minusSeconds(60));
        Instant at = now.plusNanos(1_500);

        new TransactionTemplate(transactionManager).executeWithoutResult(status -> guests.closeTransferredGuest(guest, at));

        Instant rounded = now.plusNanos(2_000);
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, guest)).isEqualTo("deactivated");
        assertThat(instant("SELECT deactivated_at FROM users WHERE id=?", guest)).isEqualTo(rounded);
        assertThat(instant("SELECT updated_at FROM users WHERE id=?", guest)).isEqualTo(rounded);
        assertThat(jdbc.queryForList("SELECT provider_uid FROM user_identities ORDER BY provider_uid", String.class))
                .containsExactly("guest-keep");
        assertThat(accounts.getRefresh("a".repeat(64)).revokedAt()).isEqualTo(rounded);
        assertThat(accounts.getRefresh("b".repeat(64)).revokedAt()).as("이미 폐기한 토큰은 그대로").isEqualTo(now.minusSeconds(30));
        assertThat(accounts.getRefresh("c".repeat(64)).revokedAt()).isNull();
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, other)).isEqualTo("active");
    }

    @Test
    @DisplayName("closeTransferredGuest 는 자기 트랜잭션을 열지 않는다 — 트랜잭션 밖에서 부르면 거절되고 아무것도 바꾸지 않는다")
    void closeTransferredGuestNeedsTheCallersTransaction() {
        UUID guest = user(null, "active");
        identity(guest, "guest", "guest-alone");

        Throwable thrown = catchThrowable(() -> guests.closeTransferredGuest(guest, now));

        assertThat(thrown).isNotNull();
        assertThat(rootCause(thrown)).isInstanceOf(jakarta.persistence.TransactionRequiredException.class);
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, guest)).isEqualTo("active");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_identities WHERE user_id=?", Integer.class, guest)).isEqualTo(1);
    }

    // ---- 신원 ----

    @Test
    @DisplayName("providersOf 는 uid 가 있는 신원의 제공자를 마지막 사용이 늦은 것부터(같으면 이름순) 하나씩 낸다. markIdentityUsed 는 그 신원의 시각만 바꾼다")
    void providersOrderByLastUseThenName() {
        UUID user = user("p@example.test", "active");
        identity(user, "google", "g-old", now.minusSeconds(300));
        identity(user, "google", "g-new", now.minusSeconds(10));
        identity(user, "kakao", "k-1", now.minusSeconds(100));
        identity(user, "apple", "a-1", now.minusSeconds(100));
        hashedIdentity(user, "naver");
        identity(user("q@example.test", "active"), "development", "d-1", now);

        assertThat(accounts.providersOf(user)).containsExactly("google", "apple", "kakao");

        accounts.markIdentityUsed("kakao", "k-1", now.plusNanos(1_500));
        assertThat(accounts.providersOf(user)).containsExactly("kakao", "google", "apple");
        assertThat(instant("SELECT last_used_at FROM user_identities WHERE provider_uid='k-1'")).isEqualTo(now.plusNanos(2_000));
        assertThat(instant("SELECT last_used_at FROM user_identities WHERE provider_uid='a-1'")).isEqualTo(now.minusSeconds(100));
        assertThat(accounts.providersOf(UUID.randomUUID())).isEmpty();
    }

    @Test
    @DisplayName("updateEmailIfFree 는 대소문자를 가리지 않고 아무도(자기 자신도) 쓰지 않는 이메일일 때만 바꾸고 updated_at 을 트랜잭션 시각으로 적는다")
    void updateEmailOnlyWhenNobodyUsesIt() {
        UUID user = user("Me@Example.test", "active");
        user("taken@example.test", "active");

        accounts.updateEmailIfFree(user, "TAKEN@example.test");
        accounts.updateEmailIfFree(user, "me@example.TEST");
        assertThat(jdbc.queryForObject("SELECT email FROM users WHERE id=?", String.class, user)).isEqualTo("Me@Example.test");

        Boolean stamped = new TransactionTemplate(transactionManager).execute(status -> {
            accounts.updateEmailIfFree(user, "New@example.test");
            return jdbc.queryForObject("SELECT updated_at=now() FROM users WHERE id=?", Boolean.class, user);
        });
        assertThat(stamped).isTrue();
        assertThat(jdbc.queryForObject("SELECT email FROM users WHERE id=?", String.class, user)).isEqualTo("New@example.test");
        accounts.updateEmailIfFree(UUID.randomUUID(), "ghost@example.test");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM users WHERE email='ghost@example.test'", Integer.class)).isZero();
    }

    @Test
    @DisplayName("linkIdentity 는 apple·naver 이면 그 제공자의 토큰 칸에만 적고 다른 제공자는 두 칸을 비운다")
    void linkIdentityStoresTheTokenInTheProvidersColumn() {
        UUID user = user("l@example.test", "active");

        accounts.linkIdentity(user, "apple", "a-link", "k1:apple");
        accounts.linkIdentity(user, "naver", "n-link", "k1:naver");
        accounts.linkIdentity(user, "kakao", "k-link", "k1:kakao");

        assertThat(jdbc.queryForList("""
                SELECT provider || ' ' || COALESCE(apple_token_encrypted,'-') || ' ' || COALESCE(naver_token_encrypted,'-')
                FROM user_identities WHERE user_id=? ORDER BY provider
                """, String.class, user))
                .containsExactly("apple k1:apple -", "kakao - -", "naver - k1:naver");
    }

    @Test
    @DisplayName("같은 신원을 두 회원이 함께 이으면 뒤의 INSERT 가 앞의 커밋을 기다렸다가 IdentityAlreadyLinkedError 다. 앞의 것이 되돌리면 뒤의 것이 잇는다")
    void twoUsersLinkingTheSameIdentity() throws Exception {
        UUID first = user("first@example.test", "active");
        UUID second = user("second@example.test", "active");
        Race<Void> committed = holdOpen(() -> {
            accounts.linkIdentity(first, "google", "g-race", null);
            return null;
        });
        try {
            Future<?> later = committed.pool.submit(() -> accounts.linkIdentity(second, "google", "g-race", null));
            assertThat(awaitStatementWaitingOn("user_identities")).contains("insert into user_identities");
            committed.commit();
            committed.result();
            Throwable thrown = catchThrowable(() -> later.get(20, TimeUnit.SECONDS));
            assertThat(thrown.getCause()).isInstanceOf(IdentityAlreadyLinkedError.class);
        } finally {
            committed.pool.shutdownNow();
        }

        Race<Void> rolledBack = holdOpen(() -> {
            accounts.linkIdentity(first, "google", "g-undo", null);
            return null;
        });
        try {
            Future<?> later = rolledBack.pool.submit(() -> accounts.linkIdentity(second, "google", "g-undo", null));
            awaitStatementWaitingOn("user_identities");
            rolledBack.rollback();
            later.get(20, TimeUnit.SECONDS);
        } finally {
            rolledBack.pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT provider_uid || ' ' || (user_id=?) FROM user_identities ORDER BY provider_uid",
                String.class, first)).containsExactly("g-race true", "g-undo false");
    }

    @Test
    @DisplayName("lacksProviderToken·storeProviderToken 은 apple·naver 의 자기 칸만 본다. removeIdentity 는 그 신원만 지운다")
    void providerTokensAndRemoval() {
        UUID user = user("t@example.test", "active");
        identity(user, "apple", "a-tok");
        identity(user, "naver", "n-tok");
        identity(user, "kakao", "k-tok");

        assertThat(accounts.lacksProviderToken("apple", "a-tok")).isTrue();
        assertThat(accounts.lacksProviderToken("naver", "n-tok")).isTrue();
        assertThat(accounts.lacksProviderToken("apple", "missing")).isFalse();
        accounts.storeProviderToken("apple", "a-tok", "k1:a");
        assertThat(accounts.lacksProviderToken("apple", "a-tok")).isFalse();
        assertThat(accounts.lacksProviderToken("naver", "n-tok")).isTrue();
        accounts.storeProviderToken("naver", "n-tok", "k1:n");
        assertThat(jdbc.queryForList("""
                SELECT provider || ' ' || COALESCE(apple_token_encrypted,'-') || ' ' || COALESCE(naver_token_encrypted,'-')
                FROM user_identities WHERE user_id=? ORDER BY provider
                """, String.class, user))
                .containsExactly("apple k1:a -", "kakao - -", "naver - k1:n");

        accounts.removeIdentity("naver", "n-tok");
        accounts.removeIdentity("naver", "n-tok");
        assertThat(jdbc.queryForList("SELECT provider FROM user_identities WHERE user_id=? ORDER BY provider", String.class, user))
                .containsExactly("apple", "kakao");
    }

    // ---- 문장 ----

    @Test
    @DisplayName("보호 요청 하나(GET /v2/me/notification-settings)가 보내는 문장 전체. 인증 확인은 그 가운데 한 문장이다")
    void oneProtectedRequestSendsTheseStatements() throws Exception {
        UUID member = user("gate@example.test", "active");
        identity(member, "google", "g-gate");
        AccountFixtures.passGate(jdbc, member);
        String bearer = "Bearer " + jwt.issueAccessToken(member).value();

        List<String> sent = statementsOf(() -> {
            try {
                assertThat(mvc.perform(get("/v2/me/notification-settings").header("Authorization", bearer))
                        .andReturn().getResponse().getStatus()).isEqualTo(200);
            } catch (Exception failure) {
                throw new IllegalStateException(failure);
            }
            return null;
        });

        assertThat(sent).as("요청 하나의 문장 — 인증 확인(select users)이 게이트와 컨트롤러에서 한 번씩 나간다").containsExactly(
                "select users",
                "with select",
                "select user_consents",
                "select users",
                "select user_profiles");
    }

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류")
    void eachPortMethodSendsTheseStatements() {
        SoftAssertions soft = new SoftAssertions();
        UUID user = user("s@example.test", "active");
        identity(user, "apple", "a-s");
        soft.assertThat(statementsOf(() -> authenticated.find(user))).containsExactly("select users");
        soft.assertThat(statementsOf(() -> accounts.providersOf(user))).containsExactly("select user_identities");
        soft.assertThat(statementsOf(() -> {
            accounts.markIdentityUsed("apple", "a-s", now);
            return null;
        })).containsExactly("update user_identities");
        soft.assertThat(statementsOf(() -> {
            accounts.updateEmailIfFree(user, "s2@example.test");
            return null;
        })).containsExactly("update users");
        soft.assertThat(statementsOf(() -> {
            accounts.linkIdentity(user, "naver", "n-s", "k1:n");
            return null;
        })).as("새로 잇기").containsExactly("insert user_identities on conflict returning");
        soft.assertThat(statementsOf(() -> {
            accounts.linkIdentity(user, "naver", "n-s", "k1:n");
            return null;
        })).as("이미 이은 신원").containsExactly("insert user_identities on conflict returning", "select user_identities");
        soft.assertThat(statementsOf(() -> accounts.lacksProviderToken("apple", "a-s"))).containsExactly("select user_identities");
        soft.assertThat(statementsOf(() -> accounts.lacksProviderToken("kakao", "k-s"))).as("토큰 칸이 없는 제공자").isEmpty();
        soft.assertThat(statementsOf(() -> {
            accounts.storeProviderToken("apple", "a-s", "k1:a");
            return null;
        })).containsExactly("update user_identities");
        soft.assertThat(statementsOf(() -> {
            accounts.removeIdentity("naver", "n-s");
            return null;
        })).containsExactly("delete user_identities");
        soft.assertThat(statementsOf(() -> {
            accounts.issueRefresh(user, "d".repeat(64), now.plusSeconds(3600), null, now);
            return null;
        })).containsExactly("insert refresh_tokens", "insert user_active_days on conflict");
        soft.assertThat(statementsOf(() -> accounts.getRefresh("d".repeat(64)))).containsExactly("select refresh_tokens");
        soft.assertThat(statementsOf(() -> accounts.rotate("d".repeat(64), "e".repeat(64), now.plusSeconds(7200), null,
                now.plusSeconds(1))))
                .as("토큰 갱신")
                .as("옛 토큰의 교체 표시는 접속일 넣기 앞에서 내보낸다")
                .containsExactly("select refresh_tokens for update", "insert refresh_tokens", "update refresh_tokens",
                        "insert user_active_days on conflict");
        soft.assertThat(statementsOf(() -> accounts.revoke("e".repeat(64), now))).containsExactly("update refresh_tokens");
        UUID guest = user(null, "active");
        identity(guest, "guest", "guest-s");
        soft.assertThat(statementsOf(() -> {
            new TransactionTemplate(transactionManager).executeWithoutResult(status -> guests.closeTransferredGuest(guest, now));
            return null;
        })).containsExactly("update users", "delete user_identities", "update refresh_tokens");
        soft.assertAll();
    }

    // ---- 도움 ----

    private static final Pattern WITH_CHANGE = Pattern.compile("^with \\w+ as \\( ?(insert into|update|delete from) (\\w+)\\b.*");
    private static final Pattern INSERT = Pattern.compile("^insert into (\\w+)\\b.*");
    private static final Pattern UPDATE = Pattern.compile("^update (\\w+)\\b.*");
    private static final Pattern DELETE = Pattern.compile("^delete from (\\w+)\\b.*");
    private static final Pattern TABLE = Pattern.compile("^(\\w+)\\b.*");
    private static final Pattern LOCK = Pattern.compile(" for update( of \\w+)?( skip locked)?");

    /**
     * 문장을 "<종류> <표>[ 잠금][ on conflict][ returning]" 으로 줄인다. 별칭·열 목록·매개변수 표기는 두 구현이 달라 견주지 않는다.
     * SELECT 의 표는 괄호 밖 FROM 의 첫 표이고, 데이터를 바꾸지 않는 CTE 로 시작하는 조회는 "with select" 다.
     */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        String conflict = text.contains(" on conflict") ? " on conflict" : "";
        String returning = text.contains(" returning ") ? " returning" : "";
        Matcher locked = LOCK.matcher(text);
        String lock = locked.find() ? locked.group() : "";
        Matcher matcher;
        if ((matcher = WITH_CHANGE.matcher(text)).matches()) {
            return matcher.group(1).split(" ")[0] + " " + matcher.group(2) + conflict + returning;
        }
        if (text.startsWith("with ")) {
            return "with select" + lock;
        }
        if (text.startsWith("select ")) {
            return "select " + outerTable(text) + lock;
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

    private static String outerTable(String text) {
        int depth = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '(') {
                depth++;
            } else if (c == ')') {
                depth--;
            } else if (depth == 0 && text.startsWith(" from ", i)) {
                Matcher matcher = TABLE.matcher(text.substring(i + " from ".length()));
                return matcher.matches() ? matcher.group(1) : "(subquery)";
            }
        }
        return "(none)";
    }

    private List<String> statementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = Recorder.STATEMENTS.get().stream().map(AuthStoreIT::label).toList();
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

    private UUID user(String email, String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,email,status) VALUES (?,?,?)", id, email, status);
        return id;
    }

    private void identity(UUID user, String provider, String uid) {
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,?,?)",
                UUID.randomUUID(), user, provider, uid);
    }

    /** uid 없이 해시만 남은 신원(탈퇴 뒤 보존 등). {@code ck_user_identities_uid_or_hash} 가 둘 중 하나를 요구한다. */
    private void hashedIdentity(UUID user, String provider) {
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,uid_hash) VALUES (?,?,?,?)",
                UUID.randomUUID(), user, provider, "k1:" + UUID.randomUUID());
    }

    private void identity(UUID user, String provider, String uid, Instant lastUsedAt) {
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid,last_used_at) VALUES (?,?,?,?,?)",
                UUID.randomUUID(), user, provider, uid, OffsetDateTime.ofInstant(lastUsedAt, ZoneOffset.UTC));
    }

    private Instant instant(String sql, Object... args) {
        return jdbc.queryForObject(sql, OffsetDateTime.class, args).toInstant();
    }

    private static Throwable rootCause(Throwable thrown) {
        Throwable cause = thrown;
        while (cause.getCause() != null && cause.getCause() != cause) {
            cause = cause.getCause();
        }
        return cause;
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
