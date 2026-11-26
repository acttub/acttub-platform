package com.acttub.actingapi.feature.coach;

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

import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionExecution;
import org.springframework.transaction.TransactionExecutionListener;
import org.springframework.transaction.support.TransactionTemplate;

/** {@link CoachStoreTest} 들이 함께 쓰는 도구 — 보낸 문장과 연 트랜잭션 세기, 경합 세우기, 바탕 행 넣기. */
@TestConfiguration(proxyBeanMethods = false)
public class CoachStoreFixture {

    /** 이 스레드가 보낸 SQL 을 모은다. 경합 쪽 스레드의 문장은 섞이지 않는다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    /** 이 스레드가 새로 연 트랜잭션을 센다(이미 열린 것에 참여한 것은 세지 않는다). */
    static class Transactions implements TransactionExecutionListener {
        private static final ThreadLocal<int[]> BEGUN = ThreadLocal.withInitial(() -> new int[1]);

        @Override
        public void afterBegin(TransactionExecution transaction, Throwable beginFailure) {
            if (beginFailure == null && transaction.isNewTransaction()) {
                BEGUN.get()[0]++;
            }
        }
    }

    @Bean
    Transactions coachStoreTransactionCounter() {
        return new Transactions();
    }

    @Bean
    Tools coachStoreTools(JdbcTemplate jdbc, PlatformTransactionManager transactionManager,
            @Value("${spring.datasource.url}") String databaseUrl) {
        return new Tools(jdbc, transactionManager, databaseUrl);
    }

    /** @param transactions 이 스레드가 새로 연 트랜잭션 수 */
    record Sent(int transactions, List<String> statements) {
        Sent withoutPrefix(List<String> prefix) {
            assertThat(statements).startsWith(prefix.toArray(String[]::new));
            return new Sent(transactions, statements.subList(prefix.size(), statements.size()));
        }

        Sent after(String marker) {
            int at = statements.indexOf(marker);
            assertThat(at).as("%s 가 %s 에 없다", marker, statements).isNotNegative();
            return new Sent(transactions, statements.subList(at, statements.size()));
        }
    }

    interface Call {
        Object run() throws Exception;
    }

    record Race<A, B>(A first, B second) {
    }

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

    static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    static final class Tools {
        private final JdbcTemplate jdbc;
        private final PlatformTransactionManager transactionManager;
        private final String databaseUrl;

        Tools(JdbcTemplate jdbc, PlatformTransactionManager transactionManager, String databaseUrl) {
            this.jdbc = jdbc;
            this.transactionManager = transactionManager;
            this.databaseUrl = databaseUrl;
        }

        void reset() {
            jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
            Recorder.STATEMENTS.get().clear();
        }

        Sent sent(Call call) {
            Recorder.STATEMENTS.get().clear();
            Transactions.BEGUN.get()[0] = 0;
            try {
                call.run();
            } catch (Exception failure) {
                throw new IllegalStateException(failure);
            }
            Sent sent = new Sent(Transactions.BEGUN.get()[0],
                    Recorder.STATEMENTS.get().stream().map(CoachStoreFixture::label).toList());
            Recorder.STATEMENTS.get().clear();
            return sent;
        }

        <T> T inTransaction(Supplier<T> body) {
            return new TransactionTemplate(transactionManager).execute(status -> body.get());
        }

        /** 앞의 것이 트랜잭션 안에서 먼저 끝나고 잡은 채 기다리는 동안 뒤의 것이 {@code waitingOn} 을 담은 문장에서 기다린다. */
        <A, B> Race<A, B> race(Supplier<A> firstCall, Supplier<B> secondCall, String waitingOn) throws Exception {
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

        /**
         * 바깥 연결이 그 행을 FOR KEY SHARE 로 잡은 동안 {@code write} 가 기다리는 문장. 기다리지 않고 끝나면(FOR NO KEY UPDATE 세기)
         * {@code null} 이다.
         */
        String waitingBehindKeyShare(String table, UUID row, String fragment, Supplier<?> write) throws Exception {
            ExecutorService pool = Executors.newSingleThreadExecutor();
            try (Connection probe = probe()) {
                try (PreparedStatement statement = probe.prepareStatement("SELECT 1 FROM " + table + " WHERE id=? FOR KEY SHARE")) {
                    statement.setObject(1, row);
                    statement.execute();
                }
                Future<?> running = pool.submit(write::get);
                String statement = null;
                Instant deadline = Instant.now().plusSeconds(10);
                while (!running.isDone() && statement == null && Instant.now().isBefore(deadline)) {
                    statement = waiting(fragment);
                    Thread.sleep(10);
                }
                probe.rollback();
                running.get(20, TimeUnit.SECONDS);
                return statement;
            } finally {
                pool.shutdownNow();
            }
        }

        Connection probe() throws Exception {
            Connection connection = DriverManager.getConnection(databaseUrl,
                    PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
            connection.setAutoCommit(false);
            return connection;
        }

        /** 잠금을 기다리는 문장 가운데 {@code fragment} 를 담은 것. */
        String awaitWaiting(String fragment) throws Exception {
            Instant deadline = Instant.now().plusSeconds(10);
            while (Instant.now().isBefore(deadline)) {
                String statement = waiting(fragment);
                if (statement != null) {
                    return statement;
                }
                Thread.sleep(10);
            }
            throw new AssertionError("'" + fragment + "' 를 담은 문장이 잠금 뒤에서 기다리지 않았다");
        }

        private String waiting(String fragment) {
            return jdbc.queryForList("""
                    SELECT regexp_replace(query, '\\s+', ' ', 'g') FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock'
                    """, String.class).stream()
                    .map(String::strip)
                    .filter(query -> query.toLowerCase(Locale.ROOT).contains(fragment))
                    .findFirst().orElse(null);
        }

        // ---- 바탕 행 ----

        UUID member() {
            UUID id = UUID.randomUUID();
            jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
            return id;
        }

        /** 보호 요청의 게이트(로그인 수단·동의·프로필)를 지나게 한다. */
        void passGate(UUID user) {
            jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                    UUID.randomUUID(), user, "g-" + user);
            AccountFixtures.passGate(jdbc, user);
        }

        UUID practice(UUID owner) {
            UUID id = UUID.randomUUID();
            jdbc.update("""
                    INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,close_reason,experience_version,
                                          blockage_kind,sub_branch,situation)
                    VALUES (?,?,NULL,?,1,'closed','conversation_closed','three_layers_v1','분석','캐릭터 분석','문 앞에서 돌아선다')
                    """, id, owner, id);
            return id;
        }

        /** 닫힌 대화(턴 없음). */
        UUID conversation(UUID practice) {
            UUID id = UUID.randomUUID();
            jdbc.update("""
                    INSERT INTO coach_conversations(id,practice_id,start_request_id,status,close_reason,closed_at,state_revision)
                    VALUES (?,?,?,'closed','user_ended',now(),4)
                    """, id, practice, UUID.randomUUID());
            return id;
        }

        UUID note(UUID conversation) {
            UUID id = UUID.randomUUID();
            jdbc.update("""
                    INSERT INTO coach_notes(id,conversation_id,format,kind,title,next_take,source_revision)
                    VALUES (?,?,'v2','action','붙잡는 순간','시선을 두고 찍어보세요',4)
                    """, id, conversation);
            return id;
        }

        int count(String table) {
            return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
        }

        Instant instant(String sql, Object... args) {
            OffsetDateTime at = jdbc.queryForObject(sql, OffsetDateTime.class, args);
            return at == null ? null : at.toInstant();
        }

        private static void await(CountDownLatch latch) {
            try {
                assertThat(latch.await(20, TimeUnit.SECONDS)).isTrue();
            } catch (InterruptedException exc) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(exc);
            }
        }
    }
}
