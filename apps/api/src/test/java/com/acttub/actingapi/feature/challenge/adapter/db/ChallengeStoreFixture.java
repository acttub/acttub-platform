package com.acttub.actingapi.feature.challenge.adapter.db;

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
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.challenge.app.EntryMedia;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 챌린지 저장소 고정 테스트({@link ChallengeStoreTest})가 함께 쓰는 도구: 보낸 SQL 모으기, 문장 줄여 견주기, 바깥 연결,
 * 잠금을 기다리는 문장 잡기, 행 만들기. 설정이 같아 이 테스트들은 Spring 컨텍스트 하나를 함께 쓴다.
 */
@TestConfiguration(proxyBeanMethods = false)
public class ChallengeStoreFixture {

    /** 이 스레드가 보낸 SQL 을 모은다. 경합 쪽 스레드의 문장은 섞이지 않는다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    /** 재생 주소는 키를 그대로 붙인다 — 어떤 키로 주소를 만들었는지 결과에서 보인다. */
    @Bean
    @Primary
    EntryMedia challengeStoreMedia() {
        return new EntryMedia() {
            @Override
            public int durationMs(String objectKey) {
                return 30_000;
            }

            @Override
            public String playbackUrl(String objectKey) {
                return "media://" + objectKey;
            }
        };
    }

    @Value("${spring.datasource.url}")
    private String databaseUrl;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PlatformTransactionManager transactionManager;

    void reset() {
        jdbc.execute("TRUNCATE TABLE users, challenges, ai_jobs, account_cleanup_operations RESTART IDENTITY CASCADE");
        Recorder.STATEMENTS.get().clear();
    }

    // ---- 행 만들기 ----

    /** 활성 회원. 프로필 이름은 {@code name} 이고 챌린지 알림은 켜져 있다. */
    UUID member(String name) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        AccountFixtures.completeProfile(jdbc, id);
        jdbc.update("UPDATE user_profiles SET name=? WHERE user_id=?", name, id);
        return id;
    }

    void device(UUID user, String token) {
        jdbc.update("INSERT INTO push_tokens(user_id,token,platform,locale) VALUES (?,?,'ios','ko')", user, token);
    }

    /** 운영이 연 챌린지. */
    UUID challenge(Instant startsAt, Instant endsAt) {
        return challenge(UUID.randomUUID(), startsAt, endsAt);
    }

    UUID challenge(UUID id, Instant startsAt, Instant endsAt) {
        jdbc.update("""
                INSERT INTO challenges(id,line,work,duration_days,origin,request_id,request_fingerprint,starts_at,ends_at)
                VALUES (?,?,'창작',7,'team',?,?,?,?)
                """, id, "대사 " + id, UUID.randomUUID(), "0".repeat(64), utc(startsAt), utc(endsAt));
        return id;
    }

    /** 회원이 연 챌린지. */
    UUID memberChallenge(UUID host, Instant startsAt, Instant endsAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenges(id,line,work,duration_days,origin,host_user_id,request_id,request_fingerprint,starts_at,ends_at)
                VALUES (?,?,'창작',7,'member',?,?,?,?,?)
                """, id, "대사 " + id, host, UUID.randomUUID(), "0".repeat(64), utc(startsAt), utc(endsAt));
        return id;
    }

    /** 그 회원의 확정된 영상. 객체 키는 {@code videos/<id>} 다. */
    UUID video(UUID owner) {
        UUID video = UUID.randomUUID();
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms) VALUES (?,?,?,'video/mp4',100,30000)",
                video, owner, "videos/" + video);
        return video;
    }

    /** 공개된 참여작과 그 영상. 만든 시각과 공개 시각은 {@code at} 이다. */
    UUID entry(UUID challenge, UUID owner, Instant at) {
        UUID video = video(owner);
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenge_entries(id,challenge_id,user_id,video_id,visibility,status,request_id,request_fingerprint,
                    published_at,created_at,updated_at)
                VALUES (?,?,?,?,'public','visible',?,?,?,?,?)
                """, id, challenge, owner, video, UUID.randomUUID(), "0".repeat(64), utc(at), utc(at), utc(at));
        return id;
    }

    static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    Instant instant(String sql, Object... args) {
        OffsetDateTime value = jdbc.queryForObject(sql, OffsetDateTime.class, args);
        return value == null ? null : value.toInstant();
    }

    int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    // ---- 문장 ----

    private static final Pattern CTE = Pattern.compile("^with \\w+ as \\( ?(update|delete from|select .*? from) (\\w+)\\b.*");
    private static final Pattern COUNT = Pattern.compile("^select count\\(.*?\\) from (\\w+)\\b.*");
    private static final Pattern SELECT = Pattern.compile("^select .*? from (\\w+)\\b.*");
    private static final Pattern INSERT = Pattern.compile("^insert into (\\w+)\\b.*");
    private static final Pattern UPDATE = Pattern.compile("^update (\\w+)\\b.*");
    private static final Pattern DELETE = Pattern.compile("^delete from (\\w+)\\b.*");

    /**
     * 문장을 "<종류> <표>[ 덧붙임]" 으로 줄인다. 별칭·열 목록·매개변수 표기는 네이티브 SQL 과 HQL 이 달라 견주지 않는다
     * (apps/api/CONTRACT.md §5-9). 잠금 절({@code for update}·{@code for share}·{@code skip locked})과 {@code on conflict} 는 남긴다.
     */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        if (text.contains("pg_advisory_xact_lock")) {
            return "advisory lock";
        }
        Matcher matcher;
        if ((matcher = CTE.matcher(text)).matches()) {
            String kind = matcher.group(1).split(" ")[0];
            return "with " + kind + " " + matcher.group(2) + lock(text) + (text.contains(" returning ") ? " returning" : "");
        }
        if ((matcher = COUNT.matcher(text)).matches()) {
            return "count " + matcher.group(1);
        }
        if ((matcher = SELECT.matcher(text)).matches()) {
            return "select " + matcher.group(1) + lock(text);
        }
        if ((matcher = INSERT.matcher(text)).matches()) {
            return "insert " + matcher.group(1) + (text.contains(" on conflict") ? " on conflict" : "");
        }
        if ((matcher = UPDATE.matcher(text)).matches()) {
            return "update " + matcher.group(1);
        }
        if ((matcher = DELETE.matcher(text)).matches()) {
            return "delete " + matcher.group(1);
        }
        return text;
    }

    private static String lock(String text) {
        String strength = text.contains(" for update") ? " for update" : text.contains(" for share") ? " for share" : "";
        return strength + (text.contains(" skip locked") ? " skip locked" : "");
    }

    /** {@code call} 이 이 스레드에서 보낸 문장(줄인 꼴). */
    List<String> statementsOf(Runnable call) {
        Recorder.STATEMENTS.get().clear();
        call.run();
        List<String> sent = Recorder.STATEMENTS.get().stream().map(ChallengeStoreFixture::label).toList();
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    /** {@code call} 이 이 스레드에서 보낸 문장(글자 그대로, 공백만 하나로). */
    List<String> rawStatementsOf(Runnable call) {
        Recorder.STATEMENTS.get().clear();
        call.run();
        List<String> sent = Recorder.STATEMENTS.get().stream().map(sql -> sql.strip().replaceAll("\\s+", " ")).toList();
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    <T> T inTransaction(Supplier<T> body) {
        return new TransactionTemplate(transactionManager).execute(status -> body.get());
    }

    void inTransaction(Runnable body) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> body.run());
    }

    // ---- 바깥 연결과 잠금 ----

    /** 자동 커밋을 끈 바깥 연결. */
    Connection probe() throws Exception {
        Connection connection = DriverManager.getConnection(databaseUrl,
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
        connection.setAutoCommit(false);
        return connection;
    }

    static void lock(Connection probe, String sql, Object... args) throws Exception {
        try (PreparedStatement statement = probe.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) {
                statement.setObject(i + 1, args[i]);
            }
            statement.execute();
        }
    }

    /** 다른 트랜잭션이 그 행을 잠그고 있는가 — {@code SKIP LOCKED} 로 집히지 않으면 잠겨 있다. */
    boolean locked(String table, UUID id) throws Exception {
        try (Connection other = probe()) {
            try (PreparedStatement statement = other.prepareStatement(
                    "SELECT 1 FROM " + table + " WHERE id=? FOR UPDATE SKIP LOCKED")) {
                statement.setObject(1, id);
                boolean free = statement.executeQuery().next();
                other.rollback();
                return !free;
            }
        }
    }

    static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(20, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exc);
        }
    }

    /** 잠금을 기다리는 문장 가운데 {@code fragment} 를 담은 것. 공백·줄바꿈은 하나의 공백으로 본다. */
    String awaitWaiting(String fragment) throws Exception {
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
