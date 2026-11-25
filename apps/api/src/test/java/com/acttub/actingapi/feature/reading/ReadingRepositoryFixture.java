package com.acttub.actingapi.feature.reading;

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

import com.acttub.actingapi.support.PostgresContainerSupport;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 리딩 저장소의 지금 동작을 실제 PostgreSQL 에서 고정하는 테스트들의 바탕(apps/api/CONTRACT.md §5-9). 저장소마다 포트
 * 메서드의 결과, 잠금 세기, 경합 결과, 나가는 문장을 본다. 설정이 같아 이 바탕을 잇는 테스트는 Spring 컨텍스트 하나를 같이 쓴다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.reading.ReadingRepositoryFixture$Recorder"
})
abstract class ReadingRepositoryFixture {

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
    PlatformTransactionManager transactionManager;

    final Instant now = Instant.parse("2026-11-25T03:00:00Z");

    @BeforeEach
    void resetDatabase() {
        jdbc.execute("TRUNCATE TABLE users, account_cleanup_operations RESTART IDENTITY CASCADE");
        Recorder.STATEMENTS.get().clear();
    }

    // ---- 문장 ----

    private static final Pattern CTE = Pattern.compile("^with \\w+ as \\( ?(insert into|update|delete from) (\\w+)\\b.*");
    private static final Pattern COUNT = Pattern.compile("^select count\\(.*?\\) from (\\w+)\\b.*");
    private static final Pattern LOCKED = Pattern.compile(".* for update of (\\w+)( skip locked)?$");
    private static final Pattern SELECT = Pattern.compile("^select .*? from (\\w+)\\b.*");
    private static final Pattern INSERT = Pattern.compile("^insert into (\\w+)\\b.*");
    private static final Pattern UPDATE = Pattern.compile("^update (\\w+)\\b.*");
    private static final Pattern DELETE = Pattern.compile("^delete from (\\w+)\\b.*");

    /**
     * 문장을 "<종류> <표>[ 덧붙임]" 으로 줄인다. 별칭·열 목록·매개변수 표기는 두 구현이 달라 견주지 않는다. 잠그는 조회는
     * {@code for update of <별칭>} 이 가리키는 표를 적는다 — 조인이나 서브쿼리가 있어도 무엇을 잠그는지가 드러난다.
     */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        Matcher matcher;
        if ((matcher = CTE.matcher(text)).matches()) {
            return matcher.group(1).split(" ")[0] + " " + matcher.group(2)
                    + (text.contains(" on conflict") ? " on conflict" : "") + " returning";
        }
        // 괄호 안(서브쿼리·열 목록)은 비우고 본다 — select 절의 서브쿼리가 고르는 표를 바깥 문장의 표로 잘못 읽지 않게.
        for (String flattened = null; !text.equals(flattened);) {
            flattened = text;
            text = text.replaceAll("\\([^()]*\\)", "()");
        }
        if (text.startsWith("select") && (matcher = LOCKED.matcher(text)).matches()) {
            return "select " + tableOfAlias(text, matcher.group(1)) + " for update"
                    + (matcher.group(2) == null ? "" : " skip locked");
        }
        if ((matcher = COUNT.matcher(text)).matches()) {
            return "count " + matcher.group(1);
        }
        if ((matcher = SELECT.matcher(text)).matches()) {
            return "select " + matcher.group(1)
                    + (text.contains(" for update") ? " for update" : "")
                    + (text.contains(" skip locked") ? " skip locked" : "");
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

    /** {@code from scripts s} 나 {@code join scripts s on} 에서 별칭 {@code s} 의 표 이름. */
    private static String tableOfAlias(String text, String alias) {
        Matcher matcher = Pattern.compile("(?:from|join) (\\w+) (?:as )?" + Pattern.quote(alias) + "\\b").matcher(text);
        return matcher.find() ? matcher.group(1) : alias;
    }

    /** {@code call} 이 이 스레드에서 보낸 문장을 {@link #label} 로 줄인 것. */
    List<String> statementsOf(Supplier<?> call) {
        return rawStatementsOf(call).stream().map(ReadingRepositoryFixture::label).toList();
    }

    List<String> statementsOf(Runnable call) {
        return statementsOf(() -> {
            call.run();
            return null;
        });
    }

    /** {@code call} 이 이 스레드에서 보낸 문장 그대로. */
    List<String> rawStatementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = List.copyOf(Recorder.STATEMENTS.get());
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    <T> T inTransaction(Supplier<T> body) {
        return new TransactionTemplate(transactionManager).execute(status -> body.get());
    }

    // ---- 바깥 연결과 기다림 ----

    /** 자동 커밋을 끈 바깥 연결. 잠금을 먼저 잡아 두는 데 쓴다. */
    Connection probe() throws Exception {
        Connection connection = DriverManager.getConnection(databaseUrl,
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
        connection.setAutoCommit(false);
        return connection;
    }

    static void run(Connection probe, String sql, Object... args) throws Exception {
        try (PreparedStatement statement = probe.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) {
                statement.setObject(i + 1, args[i]);
            }
            statement.execute();
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

    /** 잠금을 기다리는 문장 가운데 {@code fragment} 를 담은 것(소문자, 공백·줄바꿈은 하나의 공백). */
    String awaitWaiting(String fragment) throws Exception {
        Instant deadline = Instant.now().plusSeconds(10);
        while (Instant.now().isBefore(deadline)) {
            List<String> waiting = jdbc.queryForList("""
                    SELECT lower(regexp_replace(query, '\\s+', ' ', 'g')) FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock'
                    """, String.class).stream()
                    .filter(query -> query.contains(fragment))
                    .toList();
            if (!waiting.isEmpty()) {
                return waiting.getFirst().strip();
            }
            Thread.sleep(10);
        }
        throw new AssertionError("'" + fragment + "' 를 담은 문장이 잠금 뒤에서 기다리지 않았다");
    }

    /** 지금 잠금을 기다리는 문장이 없다. */
    void assertNothingWaits() {
        assertThat(jdbc.queryForList("""
                SELECT query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
                """, String.class)).isEmpty();
    }

    // ---- 픽스처 ----

    UUID member() {
        UUID userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", userId);
        return userId;
    }

    UUID script(UUID owner) {
        return script(owner, UUID.randomUUID());
    }

    UUID script(UUID owner, UUID requestId) {
        UUID scriptId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO scripts(id,user_id,title,raw_text,source,request_id,request_fingerprint,created_at,updated_at)
                VALUES (?,?,'대본','원문','paste',?,repeat('a',64),?,?)
                """, scriptId, owner, requestId, utc(now), utc(now));
        return scriptId;
    }

    UUID character(UUID scriptId, String name, int sortOrder) {
        UUID characterId = UUID.randomUUID();
        jdbc.update("INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (?,?,?,?)",
                characterId, scriptId, name, sortOrder);
        return characterId;
    }

    /** @param characterId 대사 줄이면 배역, 지문·장면이면 {@code null} */
    UUID line(UUID scriptId, int ordinal, String kind, UUID characterId, String text) {
        UUID lineId = UUID.randomUUID();
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,character_id,text) VALUES (?,?,?,?,?,?)",
                lineId, scriptId, ordinal, kind, characterId, text);
        return lineId;
    }

    UUID session(UUID owner, UUID scriptId, UUID startLineId, UUID endLineId, UUID... myCharacterIds) {
        return sessionWithRequest(owner, scriptId, UUID.randomUUID(), startLineId, endLineId, myCharacterIds);
    }

    UUID sessionWithRequest(
            UUID owner, UUID scriptId, UUID requestId, UUID startLineId, UUID endLineId, UUID... myCharacterIds) {
        UUID sessionId = UUID.randomUUID();
        jdbc.update(connection -> {
            PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO reading_sessions(id,script_id,user_id,request_id,my_character_ids,mode,start_line_id,end_line_id,
                                                 advance,record,status,current_line_id,started_at,updated_at)
                    VALUES (?,?,?,?,?,'read',?,?,'manual',true,'in_progress',?,?,?)
                    """);
            statement.setObject(1, sessionId);
            statement.setObject(2, scriptId);
            statement.setObject(3, owner);
            statement.setObject(4, requestId);
            statement.setArray(5, connection.createArrayOf("uuid", myCharacterIds));
            statement.setObject(6, startLineId);
            statement.setObject(7, endLineId);
            statement.setObject(8, startLineId);
            statement.setObject(9, utc(now));
            statement.setObject(10, utc(now));
            return statement;
        });
        return sessionId;
    }

    UUID recording(UUID owner, UUID sessionId, UUID lineId, int attemptNo, String objectKey) {
        UUID recordingId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO reading_recordings(id,user_id,reading_session_id,line_id,request_id,attempt_no,object_key,content_type,
                                               byte_size,duration_ms,transcript_source,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,'audio/mp4',1000,1200,'none',?,?)
                """, recordingId, owner, sessionId, lineId, UUID.randomUUID(), attemptNo, objectKey, utc(now), utc(now));
        return recordingId;
    }

    static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    Instant instant(String sql, Object... args) {
        return jdbc.queryForObject(sql, OffsetDateTime.class, args).toInstant();
    }

    UUID ownerOf(String table, UUID id) {
        return jdbc.queryForObject("SELECT user_id FROM " + table + " WHERE id=?", UUID.class, id);
    }
}
