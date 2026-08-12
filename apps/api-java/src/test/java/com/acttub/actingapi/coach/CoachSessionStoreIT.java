package com.acttub.actingapi.coach;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
class CoachSessionStoreIT {

    private static final OffsetDateTime CREATED_AT =
            CoachStorageFixtures.NOW.atOffset(ZoneOffset.UTC);

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String database = PostgresContainerSupport.createDatabaseName("coach_session_store_it");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(database));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    CoachSessionStore store;

    @Autowired
    CoachSessionWork work;

    @Autowired
    PlatformTransactionManager transactionManager;

    CoachStorageFixtures fixtures;

    @BeforeEach
    void setUp() {
        fixtures = new CoachStorageFixtures(jdbc);
    }

    @Test
    void loadReturnsEveryTurnAndTranscriptInStoredOrder() {
        UUID userId = fixtures.insertUser();
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(userId);
        UUID summaryId = fixtures.insertSummary(practice.id());
        fixtures.insertTranscript(practice.id(), 1, "둘째 대사");
        fixtures.insertTranscript(practice.id(), 0, "첫 대사");
        UUID sessionId = UUID.randomUUID();
        List<CoachTurnSnapshot> turns = List.of(
                new CoachTurnSnapshot("actor", "첫 배우 말"),
                new CoachTurnSnapshot("ai", "첫 질문"),
                new CoachTurnSnapshot("actor", "둘째 배우 말"));
        fixtures.insertCoachSession(
                sessionId, practice.id(), summaryId, "open", CREATED_AT, turns);

        OwnedCoachSessionContext loaded = store.getOwnedCoachSession(userId, sessionId);

        assertThat(loaded.practiceSessionId()).isEqualTo(practice.id());
        assertThat(loaded.session().turns()).containsExactlyElementsOf(turns);
        assertThat(loaded.session().transcripts()).containsExactly("첫 대사", "둘째 대사");
        assertThat(loaded.session().durationMs()).isEqualTo(3210);
        assertThat(loaded.session().observationPack().get("observations")).hasSize(1);
    }

    @Test
    void twoSnapshotsAllowOnlyTheFirstDivergentAppend() {
        Scenario scenario = sessionWithTurns(List.of(
                new CoachTurnSnapshot("ai", "무엇이 가장 막히나요?")), "open");
        CoachSessionSnapshot first = store.getOwnedCoachSession(
                scenario.userId(), scenario.sessionId()).session();
        CoachSessionSnapshot second = store.getOwnedCoachSession(
                scenario.userId(), scenario.sessionId()).session();
        CoachSessionSnapshot firstAppend = append(
                first, new CoachTurnSnapshot("actor", "목적을 모르겠어요"));
        CoachSessionSnapshot secondAppend = append(
                second, new CoachTurnSnapshot("actor", "감정이 안 나와요"));

        store.saveCoachSession(firstAppend, CoachStorageFixtures.NOW);

        assertThatThrownBy(() -> store.saveCoachSession(
                secondAppend, CoachStorageFixtures.NOW.plusSeconds(1)))
                .isInstanceOf(SessionWriteConflict.class)
                .hasMessage("session turns changed concurrently");
        assertThat(store.getOwnedCoachSession(
                scenario.userId(), scenario.sessionId()).session().turns())
                .containsExactlyElementsOf(firstAppend.turns());
    }

    @Test
    void changingAnyStoredRoleOrTextIsRejected() {
        Scenario scenario = sessionWithTurns(List.of(
                new CoachTurnSnapshot("actor", "원래 답변"),
                new CoachTurnSnapshot("ai", "원래 질문")), "open");
        CoachSessionSnapshot loaded = store.getOwnedCoachSession(
                scenario.userId(), scenario.sessionId()).session();

        List<CoachTurnSnapshot> changedRole = new ArrayList<>(loaded.turns());
        changedRole.set(0, new CoachTurnSnapshot("ai", "원래 답변"));
        assertThatThrownBy(() -> store.saveCoachSession(
                loaded.withTurns(changedRole), CoachStorageFixtures.NOW))
                .isInstanceOf(SessionWriteConflict.class)
                .hasMessage("session turns changed concurrently");

        List<CoachTurnSnapshot> changedText = new ArrayList<>(loaded.turns());
        changedText.set(1, new CoachTurnSnapshot("ai", "바뀐 질문"));
        assertThatThrownBy(() -> store.saveCoachSession(
                loaded.withTurns(changedText), CoachStorageFixtures.NOW))
                .isInstanceOf(SessionWriteConflict.class)
                .hasMessage("session turns changed concurrently");
    }

    @Test
    void shrinkingTurnCountIsRejectedWithTheDistinctStaleMessage() {
        Scenario scenario = sessionWithTurns(List.of(
                new CoachTurnSnapshot("actor", "첫 답변"),
                new CoachTurnSnapshot("ai", "후속 질문")), "open");
        CoachSessionSnapshot loaded = store.getOwnedCoachSession(
                scenario.userId(), scenario.sessionId()).session();

        assertThatThrownBy(() -> store.saveCoachSession(
                loaded.withTurns(List.of(loaded.turns().getFirst())),
                CoachStorageFixtures.NOW))
                .isInstanceOf(SessionWriteConflict.class)
                .hasMessage("session turns are stale");
    }

    @Test
    void appendingToClosedSessionIsRejectedWithTheDistinctClosedMessage() {
        Scenario scenario = sessionWithTurns(List.of(
                new CoachTurnSnapshot("ai", "코칭 종료")), "closed");
        CoachSessionSnapshot loaded = store.getOwnedCoachSession(
                scenario.userId(), scenario.sessionId()).session();

        assertThatThrownBy(() -> store.saveCoachSession(
                append(loaded, new CoachTurnSnapshot("actor", "뒤늦은 답변")),
                CoachStorageFixtures.NOW))
                .isInstanceOf(SessionWriteConflict.class)
                .hasMessage("closed session changed concurrently");
    }

    @Test
    void successfulAppendUsesContiguousTurnIndexes() {
        Scenario scenario = sessionWithTurns(List.of(
                new CoachTurnSnapshot("actor", "첫 답변")), "open");
        CoachSessionSnapshot loaded = store.getOwnedCoachSession(
                scenario.userId(), scenario.sessionId()).session();
        CoachSessionSnapshot appended = loaded.withTurns(List.of(
                loaded.turns().getFirst(),
                new CoachTurnSnapshot("ai", "첫 질문"),
                new CoachTurnSnapshot("actor", "둘째 답변")));

        store.saveCoachSession(appended, CoachStorageFixtures.NOW);

        assertThat(jdbc.queryForList("""
                SELECT turn_index
                FROM coach_turns
                WHERE session_id = ?
                ORDER BY turn_index
                """, Integer.class, scenario.sessionId()))
                .containsExactly(0, 1, 2);
        assertThat(store.getOwnedCoachSession(
                scenario.userId(), scenario.sessionId()).session().turns())
                .containsExactlyElementsOf(appended.turns());
    }

    @Test
    void savingAMissingSessionRaisesLookupErrorWithPythonMessage() {
        UUID userId = fixtures.insertUser();
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(userId);
        CoachSessionSnapshot missing = fixtures.newSnapshot(
                UUID.randomUUID(), practice, null, List.of());

        assertThatThrownBy(() -> store.saveCoachSession(
                missing, CoachStorageFixtures.NOW))
                .isInstanceOf(LookupError.class)
                .hasMessage("session not found");
    }

    @Test
    void loadTakesShareLockOnCoachSessionOnly() throws Exception {
        Scenario scenario = sessionWithTurns(List.of(), "open");
        CountDownLatch loaded = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<?> holder = executor.submit(() -> new TransactionTemplate(transactionManager)
                    .executeWithoutResult(status -> {
                        work.loadSession(scenario.sessionId(), scenario.userId(), false);
                        loaded.countDown();
                        await(release);
                    }));
            assertThat(loaded.await(5, TimeUnit.SECONDS)).isTrue();

            assertThatThrownBy(() -> withLockTimeout(() -> jdbc.update("""
                    UPDATE coach_sessions
                    SET conversation_summary = 'blocked'
                    WHERE id = ?
                    """, scenario.sessionId())))
                    .isInstanceOf(DataAccessException.class);

            withLockTimeout(() -> jdbc.update("""
                    UPDATE practice_sessions
                    SET situation = 'joined row remains unlocked'
                    WHERE id = ?
                    """, scenario.practiceSessionId()));

            release.countDown();
            holder.get(5, TimeUnit.SECONDS);
        } finally {
            release.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void oldestOpenSessionUsesCreatedAtThenIdAndRequiresVisibleOwnership() {
        UUID ownerId = fixtures.insertUser();
        UUID otherUserId = fixtures.insertUser();
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(ownerId);
        UUID summaryId = fixtures.insertSummary(practice.id());
        UUID lowerId = UUID.fromString("10000000-0000-4000-8000-000000000000");
        UUID higherId = UUID.fromString("20000000-0000-4000-8000-000000000000");
        UUID laterId = UUID.fromString("00000000-0000-4000-8000-000000000001");
        fixtures.insertCoachSession(
                higherId, practice.id(), summaryId, "open", CREATED_AT, List.of());
        fixtures.insertCoachSession(
                lowerId, practice.id(), summaryId, "open", CREATED_AT, List.of(
                        new CoachTurnSnapshot("actor", "가장 오래된 전체 turn")));
        fixtures.insertCoachSession(
                laterId,
                practice.id(),
                summaryId,
                "open",
                CREATED_AT.plusSeconds(1),
                List.of());

        OwnedCoachSessionContext oldest = store.getOldestOpenCoachSession(
                ownerId, practice.id());

        assertThat(oldest.session().sessionId()).isEqualTo(lowerId);
        assertThat(oldest.session().turns()).containsExactly(
                new CoachTurnSnapshot("actor", "가장 오래된 전체 turn"));
        assertThat(store.getOldestOpenCoachSession(otherUserId, practice.id())).isNull();

        jdbc.update("UPDATE practice_sessions SET hidden_at = ? WHERE id = ?",
                CoachStorageFixtures.NOW.atOffset(ZoneOffset.UTC),
                practice.id());
        assertThat(store.getOldestOpenCoachSession(ownerId, practice.id())).isNull();
    }

    @Test
    void restartClosesEveryOpenSessionOfOnlyTheOperationPracticeSession() {
        UUID userId = fixtures.insertUser();
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(userId);
        CoachStorageFixtures.Practice otherPractice = fixtures.insertPractice(userId);
        UUID summaryId = fixtures.insertSummary(practice.id());
        UUID otherSummaryId = fixtures.insertSummary(otherPractice.id());
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        UUID alreadyClosed = UUID.randomUUID();
        UUID other = UUID.randomUUID();
        fixtures.insertCoachSession(first, practice.id(), summaryId, "open", CREATED_AT, List.of());
        fixtures.insertCoachSession(second, practice.id(), summaryId, "open", CREATED_AT, List.of());
        fixtures.insertCoachSession(
                alreadyClosed, practice.id(), summaryId, "closed", CREATED_AT, List.of());
        fixtures.insertCoachSession(
                other, otherPractice.id(), otherSummaryId, "open", CREATED_AT, List.of());
        UUID leaseToken = UUID.randomUUID();
        UUID operationId = fixtures.insertRunningCoachStartOperation(
                userId, practice.id(), leaseToken);
        UUID restartedId = UUID.randomUUID();
        List<CoachTurnSnapshot> fullTurns = List.of(
                new CoachTurnSnapshot("actor", "처음부터 다시 답변"),
                new CoachTurnSnapshot("ai", "새 질문"));

        assertThat(store.completeCoachStartOperation(
                operationId,
                leaseToken,
                fixtures.newSnapshot(restartedId, practice, summaryId, fullTurns),
                CoachStorageFixtures.responsePayload(fullTurns),
                null,
                null,
                null,
                false,
                null,
                true,
                CoachStorageFixtures.NOW)).isTrue();

        assertThat(fixtures.coachStatus(first)).isEqualTo("closed");
        assertThat(fixtures.coachStatus(second)).isEqualTo("closed");
        assertThat(fixtures.coachStatus(alreadyClosed)).isEqualTo("closed");
        assertThat(fixtures.coachStatus(restartedId)).isEqualTo("open");
        assertThat(fixtures.coachStatus(other)).isEqualTo("open");
        assertThat(store.getOwnedCoachSession(userId, restartedId).session().turns())
                .containsExactlyElementsOf(fullTurns);
        assertThat(jdbc.queryForObject("""
                SELECT response_payload = ?::jsonb
                FROM external_operations
                WHERE id = ?
                """,
                Boolean.class,
                CoachStorageFixtures.responsePayload(fullTurns).toString(),
                operationId)).isTrue();
    }

    @Test
    void coachReplyCompletionAppendsTurnsAndFinishesItsOperationAtomically() {
        UUID userId = fixtures.insertUser();
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(userId);
        UUID summaryId = fixtures.insertSummary(practice.id());
        UUID sessionId = UUID.randomUUID();
        List<CoachTurnSnapshot> original = List.of(
                new CoachTurnSnapshot("actor", "첫 배우 말"),
                new CoachTurnSnapshot("ai", "첫 질문"));
        fixtures.insertCoachSession(
                sessionId, practice.id(), summaryId, "open", CREATED_AT, original);
        UUID leaseToken = UUID.randomUUID();
        UUID operationId = insertRunningCoachReplyOperation(userId, practice.id(), leaseToken);
        CoachSessionSnapshot loaded = store.getOwnedCoachSession(userId, sessionId).session();
        List<CoachTurnSnapshot> allTurns = new ArrayList<>(loaded.turns());
        allTurns.add(new CoachTurnSnapshot("actor", "다음 배우 말"));
        allTurns.add(new CoachTurnSnapshot("ai", "다음 질문"));
        CoachSessionSnapshot completed = loaded.withTurns(allTurns);
        JsonNode payload = CoachStorageFixtures.responsePayload(allTurns);

        assertThat(store.completeCoachReplyOperation(
                operationId,
                leaseToken,
                completed,
                payload,
                null,
                null,
                null,
                false,
                null,
                CoachStorageFixtures.NOW)).isTrue();

        assertThat(store.getOwnedCoachSession(userId, sessionId).session().turns())
                .containsExactlyElementsOf(allTurns);
        assertThat(jdbc.queryForMap("""
                SELECT status::text AS status, response_payload::text AS payload
                FROM external_operations WHERE id = ?
                """, operationId))
                .containsEntry("status", "succeeded");
    }

    @Test
    void confirmationUpsertTransitionsFalseToTrueAndClosesOnlyRequestedCoachSession() {
        UUID userId = fixtures.insertUser();
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(userId);
        CoachStorageFixtures.Practice otherPractice = fixtures.insertPractice(userId);
        UUID summaryId = fixtures.insertSummary(practice.id());
        UUID otherSummaryId = fixtures.insertSummary(otherPractice.id());
        UUID target = UUID.randomUUID();
        UUID sibling = UUID.randomUUID();
        UUID unrelated = UUID.randomUUID();
        fixtures.insertCoachSession(target, practice.id(), summaryId, "open", CREATED_AT, List.of());
        fixtures.insertCoachSession(sibling, practice.id(), summaryId, "open", CREATED_AT, List.of());
        fixtures.insertCoachSession(
                unrelated, otherPractice.id(), otherSummaryId, "open", CREATED_AT, List.of());
        UUID handoffId = fixtures.insertHandoff(target, practice.id(), CREATED_AT);

        OwnedReportSource rejected = store.confirmLatestHandoff(
                userId,
                target,
                false,
                "목적은 붙잡는 것이 아니에요",
                CoachStorageFixtures.NOW);
        OffsetDateTime createdAt = jdbc.queryForObject("""
                SELECT created_at
                FROM handoff_confirmations
                WHERE coaching_handoff_id = ?
                """, OffsetDateTime.class, handoffId);

        assertThat(rejected.confirmed()).isFalse();
        assertThat(jdbc.queryForMap("""
                SELECT confirmed, rebuttal_text
                FROM handoff_confirmations
                WHERE coaching_handoff_id = ?
                """, handoffId))
                .containsEntry("confirmed", false)
                .containsEntry("rebuttal_text", "목적은 붙잡는 것이 아니에요");
        assertThat(fixtures.coachStatus(target)).isEqualTo("open");

        OwnedReportSource confirmed = store.confirmLatestHandoff(
                userId,
                target,
                true,
                null,
                CoachStorageFixtures.NOW.plusSeconds(1));

        assertThat(confirmed.confirmed()).isTrue();
        assertThat(jdbc.queryForObject("""
                SELECT count(*)
                FROM handoff_confirmations
                WHERE coaching_handoff_id = ?
                """, Long.class, handoffId)).isEqualTo(1L);
        Map<String, Object> confirmation = jdbc.queryForMap("""
                SELECT confirmed, rebuttal_text
                FROM handoff_confirmations
                WHERE coaching_handoff_id = ?
                """, handoffId);
        assertThat(confirmation)
                .containsEntry("confirmed", true)
                .containsEntry("rebuttal_text", null);
        assertThat(jdbc.queryForObject("""
                SELECT created_at
                FROM handoff_confirmations
                WHERE coaching_handoff_id = ?
                """, OffsetDateTime.class, handoffId)).isEqualTo(createdAt);
        assertThat(fixtures.coachStatus(target)).isEqualTo("closed");
        assertThat(fixtures.coachStatus(sibling)).isEqualTo("open");
        assertThat(fixtures.coachStatus(unrelated)).isEqualTo("open");
    }

    @Test
    void confirmationReturnsEarlyWhenTheOwnedSessionHasNoHandoff() {
        Scenario scenario = sessionWithTurns(List.of(), "open");

        OwnedReportSource source = store.confirmLatestHandoff(
                scenario.userId(),
                scenario.sessionId(),
                true,
                null,
                CoachStorageFixtures.NOW);

        assertThat(source).isNotNull();
        assertThat(source.handoffId()).isNull();
        assertThat(source.confirmed()).isFalse();
        assertThat(fixtures.coachStatus(scenario.sessionId())).isEqualTo("open");
        assertThat(jdbc.queryForObject("""
                SELECT count(*)
                FROM handoff_confirmations c
                JOIN coaching_handoffs h ON h.id = c.coaching_handoff_id
                WHERE h.coach_session_id = ?
                """, Long.class, scenario.sessionId())).isZero();
    }

    private Scenario sessionWithTurns(List<CoachTurnSnapshot> turns, String status) {
        UUID userId = fixtures.insertUser();
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(userId);
        UUID summaryId = fixtures.insertSummary(practice.id());
        UUID sessionId = UUID.randomUUID();
        fixtures.insertCoachSession(
                sessionId, practice.id(), summaryId, status, CREATED_AT, turns);
        return new Scenario(userId, practice.id(), sessionId);
    }

    private UUID insertRunningCoachReplyOperation(
            UUID userId, UUID practiceSessionId, UUID leaseToken) {
        UUID operationId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO external_operations (
                    id, session_id, user_id, request_id, kind, status,
                    attempt_count, request_fingerprint, lease_token, lease_expires_at
                ) VALUES (
                    ?, ?, ?, ?, 'coach_reply'::operation_kind_t,
                    'running'::operation_status_t, 1, ?, ?, ?
                )
                """,
                operationId,
                practiceSessionId,
                userId,
                UUID.randomUUID(),
                "0".repeat(64),
                leaseToken,
                CoachStorageFixtures.NOW.plusSeconds(300).atOffset(ZoneOffset.UTC));
        return operationId;
    }

    private CoachSessionSnapshot append(
            CoachSessionSnapshot session,
            CoachTurnSnapshot turn) {
        List<CoachTurnSnapshot> turns = new ArrayList<>(session.turns());
        turns.add(turn);
        return session.withTurns(turns);
    }

    private void withLockTimeout(Runnable action) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            jdbc.execute("SET LOCAL lock_timeout = '300ms'");
            action.run();
        });
    }

    private void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("lock test latch timed out");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("lock test interrupted", exception);
        }
    }

    private record Scenario(UUID userId, UUID practiceSessionId, UUID sessionId) {
    }
}
