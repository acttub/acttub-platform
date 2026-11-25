package com.acttub.actingapi.feature.memory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.memory.adapter.db.PostgresActorMemoryStore;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 배우 기억 저장소가 내는 결과·잠금·문장을 실제 PostgreSQL 에서 고정한다. 저장소를 네이티브 SQL 에서 JPA 로 옮길 때
 * 네이티브 구현에서 먼저 통과시킨 이 테스트가 그대로 통과해야 한다(apps/api/CONTRACT.md §5-9).
 *
 * <p>옮기는 문장은 기억 표 둘({@code actor_memories}·{@code actor_memory_entries})만 쓰는 것이다 — 코치가 읽는 칸 고르기의 행
 * 읽기, 지우기, 이관(있는지 보기·버리기·주인 바꾸기). 나머지는 다른 기능의 표를 써서 native 로 남지만 문장 수는 여기서 함께
 * 본다. 화면 경로는 {@link ActorMemoryIT}, 갱신 워커의 재료·덧붙이기·완료는 {@code PostgresActorMemoryStoreIT}, 이관의 기억 고르기는
 * {@code GuestTransferIT} 가 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.memory.ActorMemoryRepositoryIT$Recorder"
})
class ActorMemoryRepositoryIT {

    /** 이 스레드가 보낸 SQL 을 모은다. */
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
    PostgresActorMemoryStore store;

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
    @DisplayName("forPractice: 새 표에 같은 칸이 없을 때만 옛 표의 네 칸을 읽는다(성별·나이는 읽지 않는다). 장면 칸은 이 회차의 장면 것이 먼저고, 남의 회차·회차 없음이면 배우가 장면 없이 쓴 것만 읽는다")
    void forPracticeReadsBothTablesAndScopesSceneFields() {
        UUID actor = member();
        UUID other = member();
        UUID sceneA = practice(actor);
        UUID sceneB = practice(actor);
        UUID foreign = practice(other);
        memory(actor, "goal", "A 장면 목표", "actor", sceneA, now);
        memory(actor, "goal", "어디서나 목표", "actor", null, now.minusSeconds(60));
        memory(actor, "speech_self", "새 표의 말버릇", "actor", null, now.minusSeconds(30));
        memory(actor, "wants", "칭찬보다 지적", "actor", null, now.minusSeconds(10));
        legacy(actor, "blockage", "옛 표의 막힘", "actor");
        legacy(actor, "speech_self", "옛 표의 말버릇", "actor");
        legacy(actor, "gender", "여성", "actor");
        memory(other, "wants", "남의 기억", "actor", null, now);

        assertThat(store.forPractice(actor, sceneA)).containsExactlyInAnyOrderEntriesOf(Map.of(
                "goal", "A 장면 목표", "speech_self", "새 표의 말버릇", "wants", "칭찬보다 지적", "blockage", "옛 표의 막힘"));
        assertThat(store.forPractice(actor, sceneB)).containsEntry("goal", "어디서나 목표").hasSize(4);
        assertThat(store.forPractice(actor, null)).containsEntry("goal", "어디서나 목표").hasSize(4);
        assertThat(store.forPractice(actor, foreign)).containsEntry("goal", "어디서나 목표").hasSize(4);
        assertThat(store.forPractice(UUID.randomUUID(), null)).isEmpty();
        assertThat(store.current(actor, sceneA)).doesNotContainKey("coaching_profile").containsEntry("goal", "A 장면 목표");
    }

    @Test
    @DisplayName("delete: 그 칸의 새 표 행을 장면 가리지 않고 모두 지우고, 옛 표는 네 칸 가운데 그 칸만 지운다. 칸 없이 부르면 새 표 전부와 옛 표의 네 칸을 지우고 성별·나이는 남긴다. 지운 것이 없어도 세대를 올리고 남의 것은 그대로다")
    void deleteRemovesTheFieldFromBothTablesAndBumpsTheEpoch() {
        UUID actor = member();
        UUID other = member();
        UUID scene = practice(actor);
        memory(actor, "goal", "장면 목표", "agent", scene, now);
        memory(actor, "goal", "장면 없는 목표", "actor", null, now);
        memory(actor, "wants", "원하는 것", "actor", null, now);
        legacy(actor, "goal", "옛 목표", "actor");
        legacy(actor, "blockage", "옛 막힘", "actor");
        legacy(actor, "gender", "여성", "actor");
        memory(other, "goal", "남의 목표", "actor", null, now);
        legacy(other, "goal", "남의 옛 목표", "actor");

        store.delete(actor, "goal");
        assertThat(fields("actor_memories", actor)).containsExactly("wants");
        assertThat(fields("actor_memory_entries", actor)).containsExactly("blockage", "gender");
        assertThat(epoch(actor)).isEqualTo(1);

        store.delete(actor, "tone");
        assertThat(fields("actor_memories", actor)).containsExactly("wants");
        assertThat(epoch(actor)).isEqualTo(2);

        store.delete(actor, null);
        assertThat(fields("actor_memories", actor)).isEmpty();
        assertThat(fields("actor_memory_entries", actor)).containsExactly("gender");
        assertThat(epoch(actor)).isEqualTo(3);
        assertThat(fields("actor_memories", other)).containsExactly("goal");
        assertThat(fields("actor_memory_entries", other)).containsExactly("goal");
        assertThat(epoch(other)).isZero();
    }

    @Test
    @DisplayName("hasMemory: 두 표 어느 쪽이든 행이 있으면 참이다 — 옛 표의 성별·나이만 있어도 참이다")
    void hasMemoryCountsEveryRowOfBothTables() {
        UUID onlyLegacyGender = member();
        UUID onlyNew = member();
        UUID none = member();
        legacy(onlyLegacyGender, "gender", "남성", "actor");
        memory(onlyNew, "wants", "원하는 것", "actor", null, now);

        assertThat(store.hasMemory(onlyLegacyGender)).isTrue();
        assertThat(store.hasMemory(onlyNew)).isTrue();
        assertThat(store.hasMemory(none)).isFalse();
        assertThat(store.hasMemory(UUID.randomUUID())).isFalse();
    }

    @Test
    @DisplayName("discard·reassign: 버리기는 두 표의 그 사람 행을 모두 지우고(성별·나이도), 주인 바꾸기는 모두 옮긴다. 세대는 건드리지 않는다")
    void discardAndReassignTouchEveryRowOfBothTables() {
        UUID guest = member();
        UUID memberUser = member();
        UUID third = member();
        UUID scene = practice(guest);
        memory(guest, "goal", "장면 목표", "agent", scene, now);
        memory(guest, "wants", "원하는 것", "actor", null, now);
        legacy(guest, "gender", "여성", "actor");
        legacy(guest, "blockage", "옛 막힘", "actor");
        memory(third, "tone", "남의 기억", "actor", null, now);

        inTransaction(() -> {
            store.reassign(guest, memberUser);
            return null;
        });
        assertThat(fields("actor_memories", memberUser)).containsExactly("goal", "wants");
        assertThat(fields("actor_memory_entries", memberUser)).containsExactly("blockage", "gender");
        assertThat(fields("actor_memories", guest)).isEmpty();
        assertThat(jdbc.queryForObject("SELECT scene_root_id FROM actor_memories WHERE field='goal'", UUID.class))
                .isEqualTo(scene);

        inTransaction(() -> {
            store.discard(memberUser);
            return null;
        });
        assertThat(fields("actor_memories", memberUser)).isEmpty();
        assertThat(fields("actor_memory_entries", memberUser)).isEmpty();
        assertThat(fields("actor_memories", third)).containsExactly("tone");
        assertThat(epoch(memberUser)).isZero();
    }

    @Test
    @DisplayName("reassign: 받는 사람에게 같은 칸·장면의 행이 있으면 유니크 위반(DataIntegrityViolationException)이고 트랜잭션이 되돌아간다. 옛 표도 같다")
    void reassignOntoAnExistingFieldViolatesTheUniqueKey() {
        UUID guest = member();
        UUID memberUser = member();
        memory(guest, "wants", "게스트", "actor", null, now);
        memory(memberUser, "wants", "회원", "actor", null, now);
        UUID legacyGuest = member();
        UUID legacyMember = member();
        legacy(legacyGuest, "goal", "게스트", "actor");
        legacy(legacyMember, "goal", "회원", "actor");

        assertThatThrownBy(() -> inTransaction(() -> {
            store.reassign(guest, memberUser);
            return null;
        })).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> inTransaction(() -> {
            store.reassign(legacyGuest, legacyMember);
            return null;
        })).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(fields("actor_memories", guest)).containsExactly("wants");
        assertThat(fields("actor_memory_entries", legacyGuest)).containsExactly("goal");
    }

    // ---- 잠금 세기 ----

    @Test
    @DisplayName("지우기·버리기·주인 바꾸기는 기억 행을 FOR UPDATE 세기로 잡는다 — 바깥 연결의 FOR KEY SHARE 뒤에서 기다린다(주인 바꾸기는 유니크 키 칸을 고친다)")
    void writesTakeForUpdateStrengthOnMemoryRows() throws Exception {
        UUID actor = member();
        UUID target = member();
        record Case(Runnable fixture, String table, UUID owner, String statement, Runnable write) {
        }
        List<Case> cases = List.of(
                new Case(() -> memory(actor, "wants", "원하는 것", "actor", null, now), "actor_memories", actor,
                        "delete from actor_memories", () -> store.delete(actor, "wants")),
                new Case(() -> legacy(actor, "goal", "옛 목표", "actor"), "actor_memory_entries", actor,
                        "delete from actor_memory_entries", () -> store.delete(actor, "goal")),
                new Case(() -> memory(actor, "tone", "말투", "actor", null, now), "actor_memories", actor,
                        "update actor_memories", () -> inTransaction(() -> {
                            store.reassign(actor, target);
                            return null;
                        })),
                new Case(() -> legacy(actor, "blockage", "옛 막힘", "actor"), "actor_memory_entries", actor,
                        "update actor_memory_entries", () -> inTransaction(() -> {
                            store.reassign(actor, target);
                            return null;
                        })),
                new Case(() -> { }, "actor_memories", target, "delete from actor_memories", () -> inTransaction(() -> {
                    store.discard(target);
                    return null;
                })));
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            for (Case each : cases) {
                each.fixture().run();
                lock(probe, "SELECT 1 FROM " + each.table() + " WHERE user_id=? FOR KEY SHARE", each.owner());
                Future<?> waiting = pool.submit(each.write());
                String statement = awaitWaiting(each.statement()).toLowerCase(Locale.ROOT);
                probe.rollback();
                waiting.get(20, TimeUnit.SECONDS);
                assertThat(statement).startsWith(each.statement());
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(fields("actor_memories", actor)).isEmpty();
        assertThat(fields("actor_memories", target)).isEmpty();
        assertThat(fields("actor_memory_entries", target)).isEmpty();
    }

    // ---- 문장 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류(읽고 쓰는 표의 모음으로 줄인다)")
    void eachPortMethodSendsTheseStatements() {
        UUID actor = member();
        UUID target = member();
        UUID scene = practice(actor);
        memory(actor, "wants", "원하는 것", "actor", null, now);
        String memoryRows = "select actor_memories,actor_memory_entries";

        assertThat(statementsOf(() -> store.forPractice(actor, null))).containsExactly(memoryRows);
        assertThat(statementsOf(() -> store.forPractice(actor, scene)))
                .as("코치 시작이 지난다").containsExactly("select practices", memoryRows);
        assertThat(statementsOf(() -> store.current(actor, scene))).containsExactly("select practices", memoryRows);
        assertThat(statementsOf(() -> store.list(actor)))
                .containsExactly("select actor_memories,actor_memory_entries,practices");
        assertThat(statementsOf(() -> store.writeAsActor(actor, "tone", "담담하게")))
                .as("CTE 이름도 표처럼 모인다").containsExactly("with actor_memories,inserted,target,updated,users");
        assertThat(statementsOf(() -> store.hasMemory(actor))).containsExactly(memoryRows);
        assertThat(statementsOf(() -> {
            store.delete(actor, "tone");
            return null;
        })).containsExactly("delete actor_memories", "delete actor_memory_entries", "update users");
        assertThat(statementsOf(() -> {
            store.delete(actor, null);
            return null;
        })).containsExactly("delete actor_memories", "delete actor_memory_entries", "update users");
        assertThat(statementsOf(() -> inTransaction(() -> {
            store.bumpEpoch(actor);
            return null;
        }))).containsExactly("update users");
        assertThat(statementsOf(() -> inTransaction(() -> {
            store.reassign(actor, target);
            return null;
        }))).containsExactly("update actor_memories", "update actor_memory_entries");
        assertThat(statementsOf(() -> inTransaction(() -> {
            store.discard(target);
            return null;
        }))).containsExactly("delete actor_memories", "delete actor_memory_entries");
        assertThat(statementsOf(() -> store.schedule(actor, scene, now))).as("끝나지 않은 회차")
                .containsExactly("select coach_conversations,coach_messages,coach_notes,practices");
        assertThat(statementsOf(() -> store.material(UUID.randomUUID()))).as("없는 회차")
                .containsExactly("select analyses,practices");
        assertThat(statementsOf(() -> store.idle(now)))
                .containsExactly("select ai_jobs,coach_conversations,coach_messages,practices,users");
        assertThat(statementsOf(() -> store.profileMaterial(UUID.randomUUID(), now))).as("없는 계정")
                .containsExactly("select users");
        assertThat(statementsOf(() -> store.profileMaterial(actor, now))).as("대화가 없을 때")
                .containsExactly("select users", "select coach_conversations,coach_messages,coach_notes,note_ratings,practices",
                        memoryRows);
    }

    // ---- 도움 ----

    private static final Pattern TABLE = Pattern.compile("\\b(?:from|join|into|update)\\s+(\\w+)");

    /**
     * 문장을 "<종류> <표,…>[ for update]" 로 줄인다. 표는 FROM·JOIN·INTO·UPDATE 뒤에 나오는 이름을 모두 모아 정렬한다 — 두 구현의
     * 별칭·열 목록·묶는 모양(UNION 을 감싼 하위 조회)이 달라도 같은 이름이 된다.
     */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
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
        List<String> sent = Recorder.STATEMENTS.get().stream().map(ActorMemoryRepositoryIT::label).toList();
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    private <T> T inTransaction(Supplier<T> body) {
        return new TransactionTemplate(transactionManager).execute(status -> body.get());
    }

    private UUID member() {
        UUID userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", userId);
        return userId;
    }

    /** 첫 회차(제 장면의 뿌리)인 연습. */
    private UUID practice(UUID owner) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,root_id,ordinal,stage,experience_version,blockage_kind,sub_branch,situation,goal)
                VALUES (?,?,?,1,'conversing','legacy','분석','캐릭터 분석','문 앞에서 돌아선다','망설임을 보여 주기')
                """, id, owner, id);
        return id;
    }

    private void memory(UUID owner, String field, String value, String writtenBy, UUID sceneRoot, Instant updatedAt) {
        jdbc.update("""
                INSERT INTO actor_memories(id,user_id,field,value,written_by,scene_root_id,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?)
                """, UUID.randomUUID(), owner, field, value, writtenBy, sceneRoot, utc(updatedAt), utc(updatedAt));
    }

    private void legacy(UUID owner, String field, String value, String writtenBy) {
        jdbc.update("INSERT INTO actor_memory_entries(user_id,field,value,written_by) VALUES (?,?,?,?)",
                owner, field, value, writtenBy);
    }

    /** 그 사람의 행이 가진 칸, 이름 순. */
    private List<String> fields(String table, UUID owner) {
        return jdbc.queryForList("SELECT field FROM " + table + " WHERE user_id=? ORDER BY field", String.class, owner);
    }

    private int epoch(UUID owner) {
        return jdbc.queryForObject("SELECT memory_epoch FROM users WHERE id=?", Integer.class, owner);
    }

    private static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
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
