package com.acttub.actingapi.feature.memory.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.platform.schema.ActorMemoryField;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * "같은 연습 다시 열기" 가 실제 데이터베이스에서 진짜 재료를 꺼내는지.
 *
 * <p>이 경로는 한 번 빈 껍데기였던 적이 있다 — 요약 칸({@code conversation_summary})을
 * 읽게 만들었는데 그 칸을 채우는 코드가 없어 늘 빈 값이었고, 가짜 저장소에 값을 손으로
 * 넣은 시험만 있어서 아무도 못 잡았다. 그래서 이 시험은 실제 스키마 위에서 돈다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
class PostgresMemoryRepositoryPriorIT {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String database = PostgresContainerSupport.createDatabaseName("memory_prior_it");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(database));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PostgresMemoryRepository repository;

    private static final OffsetDateTime NOW =
            OffsetDateTime.of(2026, 8, 18, 12, 0, 0, 0, ZoneOffset.UTC);

    @Test
    void reopenedPracticeCarriesAnExcerptOfTheClosedConversation() {
        UUID userId = insertUser("reopen@example.com");
        UUID practiceId = insertPractice(userId);
        UUID coachId = insertCoach(practiceId, "closed", NOW);
        insertTurn(coachId, 0, "actor", "대사가 안 붙어요");
        insertTurn(coachId, 1, "ai", "어디서부터 막혔나요?");
        insertTurn(coachId, 2, "actor", "왜 지금 말하는지 모르겠어요");
        insertTurn(coachId, 3, "ai", "상대가 어떤 반응을 하길 바라나요?");

        PostgresMemoryRepository.PriorPracticeContext context =
                repository.priorContext(userId, practiceId);

        assertThat(context.earlierConversation()).isEqualTo("""
                배우: 대사가 안 붙어요
                코치: 어디서부터 막혔나요?
                배우: 왜 지금 말하는지 모르겠어요
                코치: 상대가 어떤 반응을 하길 바라나요?""");
        assertThat(context.fromSamePractice()).isTrue();
    }

    @Test
    void onlyTheLastSixTurnsSurviveAndLongTurnsAreClipped() {
        UUID userId = insertUser("clip@example.com");
        UUID practiceId = insertPractice(userId);
        UUID coachId = insertCoach(practiceId, "closed", NOW);
        for (int i = 0; i < 8; i++) {
            insertTurn(coachId, i, i % 2 == 0 ? "actor" : "ai", "턴" + i);
        }
        jdbc.update("UPDATE coach_turns SET text=? WHERE session_id=? AND turn_index=7",
                "가".repeat(300), coachId);

        String excerpt = repository.priorContext(userId, practiceId).earlierConversation();

        // 앞의 두 턴(턴0·턴1)은 밀려난다 — 대화의 끝이 그 연습에서 도달한 지점이다.
        assertThat(excerpt).doesNotContain("턴0").doesNotContain("턴1");
        assertThat(excerpt).contains("배우: 턴2");
        // 긴 턴은 120자에서 잘리고 말줄임이 붙는다.
        assertThat(excerpt).contains("가".repeat(120) + "…");
        assertThat(excerpt).doesNotContain("가".repeat(121));
    }

    @Test
    void anOpenConversationIsNotAnEarlierConversation() {
        UUID userId = insertUser("open@example.com");
        UUID practiceId = insertPractice(userId);
        UUID coachId = insertCoach(practiceId, "open", NOW);
        insertTurn(coachId, 0, "actor", "진행 중인 대화");

        assertThat(repository.priorContext(userId, practiceId).earlierConversation()).isNull();
    }

    @Test
    void aFreshPracticeHasNoEarlierConversation() {
        UUID userId = insertUser("fresh@example.com");
        UUID practiceId = insertPractice(userId);

        assertThat(repository.priorContext(userId, practiceId).earlierConversation()).isNull();
    }

    @Test
    void aNewPracticeCarriesTheLastConversationFromThePreviousPractice() {
        // 배우가 말하는 "이어하기" — 새 영상을 올려도 지난 대화가 이어진다.
        UUID userId = insertUser("carry@example.com");
        UUID earlier = insertPractice(userId);
        UUID coachId = insertCoach(earlier, "closed", NOW);
        insertTurn(coachId, 0, "actor", "호흡이 급해져요");
        insertTurn(coachId, 1, "ai", "다음엔 한 박자 늦게 시작해 볼까요?");
        UUID fresh = insertPractice(userId);

        PostgresMemoryRepository.PriorPracticeContext context =
                repository.priorContext(userId, fresh);

        assertThat(context.earlierConversation())
                .contains("배우: 호흡이 급해져요")
                .contains("코치: 다음엔 한 박자 늦게 시작해 볼까요?");
        // 다른 연습의 대화이므로 "같은 연습" 이 아니라고 표시돼야 프롬프트 제목이 맞는다.
        assertThat(context.fromSamePractice()).isFalse();
    }

    @Test
    void aPracticeContinuedFromAChosenPracticeCarriesThatConversationOverTheLatest() {
        // 끝난 연습의 카드에서 "이어서 새 연습" 을 눌렀다 — 가장 최근 대화가 아니라
        // 고른 연습의 대화가 실려야 한다 (SOMA-417).
        UUID userId = insertUser("choose@example.com");
        UUID chosen = insertPractice(userId);
        UUID chosenCoach = insertCoach(chosen, "closed", NOW.minusDays(3));
        insertTurn(chosenCoach, 0, "actor", "고른 연습의 대화");
        UUID latest = insertPractice(userId);
        UUID latestCoach = insertCoach(latest, "closed", NOW);
        insertTurn(latestCoach, 0, "actor", "가장 최근 연습의 대화");
        UUID fresh = insertPractice(userId, chosen);

        PostgresMemoryRepository.PriorPracticeContext context =
                repository.priorContext(userId, fresh);

        assertThat(context.earlierConversation())
                .contains("고른 연습의 대화")
                .doesNotContain("가장 최근 연습의 대화");
        assertThat(context.fromSamePractice()).isFalse();
    }

    @Test
    void aHiddenChosenPracticeFallsBackToTheLatestConversation() {
        // 고른 연습이 그 사이 숨겨졌다 — 지운 대화를 되살리지 않고 최근 대화로 물러난다.
        UUID userId = insertUser("choose-hidden@example.com");
        UUID chosen = insertPractice(userId);
        UUID chosenCoach = insertCoach(chosen, "closed", NOW.minusDays(3));
        insertTurn(chosenCoach, 0, "actor", "숨겨진 연습의 대화");
        jdbc.update("UPDATE practice_sessions SET hidden_at=? WHERE id=?", NOW, chosen);
        UUID latest = insertPractice(userId);
        UUID latestCoach = insertCoach(latest, "closed", NOW);
        insertTurn(latestCoach, 0, "actor", "가장 최근 연습의 대화");
        UUID fresh = insertPractice(userId, chosen);

        assertThat(repository.priorContext(userId, fresh).earlierConversation())
                .contains("가장 최근 연습의 대화")
                .doesNotContain("숨겨진 연습의 대화");
    }

    @Test
    void aNewChildKnowsTheSceneHistoryFromParentAndSiblings() {
        // 묶음(부모+자식들)의 카드가 차수별 한 줄로 실린다 — 모델 호출 없이 (SOMA-418).
        UUID userId = insertUser("history@example.com");
        UUID parent = insertPractice(userId);
        setCreatedAt(parent, NOW.minusDays(3));
        UUID parentCoach = insertCoach(parent, "closed", NOW.minusDays(3));
        insertTurn(parentCoach, 0, "actor", "1차 대화");
        insertCard(parent, parentCoach, "두 대사의 의미를 못 찾음", NOW.minusDays(3));
        UUID sibling = insertPractice(userId, parent);
        setCreatedAt(sibling, NOW.minusDays(1));
        UUID siblingCoach = insertCoach(sibling, "closed", NOW.minusDays(1));
        insertTurn(siblingCoach, 0, "actor", "2차 대화");
        insertCard(sibling, siblingCoach, "첫 대사는 풀렸다", NOW.minusDays(1));
        UUID fresh = insertPractice(userId, parent);

        PostgresMemoryRepository.PriorPracticeContext context =
                repository.priorContext(userId, fresh);

        assertThat(context.sceneHistory()).hasSize(2);
        assertThat(context.sceneHistory().get(0))
                .contains("1차").contains("두 대사의 의미를 못 찾음").contains("다음: 다음 방향");
        assertThat(context.sceneHistory().get(1)).contains("2차").contains("첫 대사는 풀렸다");
        // 직전 대화는 묶음에서 가장 최근에 닫힌 차수의 것이어야 한다.
        assertThat(context.earlierConversation()).contains("2차 대화");
    }

    @Test
    void hiddenMembersDropOutOfTheSceneHistoryAndConversation() {
        // 배우가 지운 차수는 이력에서도 발췌에서도 되살아나지 않는다.
        UUID userId = insertUser("history-hidden@example.com");
        UUID parent = insertPractice(userId);
        setCreatedAt(parent, NOW.minusDays(3));
        UUID parentCoach = insertCoach(parent, "closed", NOW.minusDays(3));
        insertTurn(parentCoach, 0, "actor", "1차 대화");
        insertCard(parent, parentCoach, "남는 차수", NOW.minusDays(3));
        UUID sibling = insertPractice(userId, parent);
        setCreatedAt(sibling, NOW.minusDays(1));
        UUID siblingCoach = insertCoach(sibling, "closed", NOW.minusDays(1));
        insertTurn(siblingCoach, 0, "actor", "지워질 대화");
        insertCard(sibling, siblingCoach, "지워질 차수", NOW.minusDays(1));
        jdbc.update("UPDATE practice_sessions SET hidden_at=? WHERE id=?", NOW, sibling);
        UUID fresh = insertPractice(userId, parent);

        PostgresMemoryRepository.PriorPracticeContext context =
                repository.priorContext(userId, fresh);

        assertThat(context.sceneHistory()).hasSize(1);
        assertThat(context.sceneHistory().getFirst()).contains("남는 차수");
        assertThat(context.earlierConversation())
                .contains("1차 대화").doesNotContain("지워질 대화");
    }

    @Test
    void aHiddenPracticesConversationDoesNotComeBack() {
        // 배우가 지운 연습의 대화가 새 연습에서 되살아나면 안 된다.
        UUID userId = insertUser("hidden@example.com");
        UUID earlier = insertPractice(userId);
        UUID coachId = insertCoach(earlier, "closed", NOW);
        insertTurn(coachId, 0, "actor", "지워질 대화");
        jdbc.update("UPDATE practice_sessions SET hidden_at=? WHERE id=?", NOW, earlier);
        UUID fresh = insertPractice(userId);

        assertThat(repository.priorContext(userId, fresh).earlierConversation()).isNull();
    }

    @Test
    void enqueueMemoryUpdateInsertsExactlyOneJobPerPractice() {
        // 예약이 조용히 무시된 사고(SOMA-404)의 재발 방지 — 실제 스키마에서 행이
        // 정말 생기는지, 같은 연습으로 두 번 불러도 하나로 남는지 못박는다.
        UUID userId = insertUser("queue@example.com");
        UUID practiceId = insertPractice(userId);

        assertThat(repository.enqueueMemoryUpdate(userId, practiceId)).isTrue();
        assertThat(repository.enqueueMemoryUpdate(userId, practiceId)).isFalse();

        Integer jobs = jdbc.queryForObject("""
                SELECT count(*) FROM external_operations
                WHERE session_id=? AND kind='memory_update'
                """, Integer.class, practiceId);
        assertThat(jobs).isEqualTo(1);
    }

    @Test
    void actorWriteWinsAnAgentRaceAndMemoryKeepsTheDisplayOrder() throws Exception {
        UUID userId = insertUser("memory-race@example.com");
        UUID practiceId = insertPractice(userId);
        CountDownLatch start = new CountDownLatch(1);

        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<?> actor = executor.submit(() -> {
                start.await();
                return repository.writeAsActor(userId, ActorMemoryField.GOAL, "배우의 목표");
            });
            Future<?> agent = executor.submit(() -> {
                start.await();
                return repository.writeAsAgent(
                        userId, ActorMemoryField.GOAL, "추출된 목표", practiceId);
            });
            start.countDown();
            actor.get(5, TimeUnit.SECONDS);
            agent.get(5, TimeUnit.SECONDS);
        } finally {
            executor.shutdownNow();
            executor.awaitTermination(5, TimeUnit.SECONDS);
        }

        repository.writeAsActor(userId, ActorMemoryField.SPEECH_ACTUAL, "실제 화법");
        repository.writeAsActor(userId, ActorMemoryField.GENDER, "성별");
        repository.writeAsActor(userId, ActorMemoryField.BLOCKAGE, "막힘");
        repository.writeAsActor(userId, ActorMemoryField.AGE, "나이");
        repository.writeAsActor(userId, ActorMemoryField.SPEECH_SELF, "스스로 본 화법");

        assertThat(repository.writeAsAgent(
                userId, ActorMemoryField.GOAL, "뒤늦은 추출", practiceId)).isNull();
        assertThat(repository.list(userId).stream().map(entry -> entry.field()).toList())
                .isEqualTo(List.of(
                        "gender", "age", "goal", "blockage", "speech_self", "speech_actual"));
        assertThat(repository.list(userId))
                .filteredOn(entry -> entry.field().equals("goal"))
                .singleElement()
                .satisfies(entry -> {
                    assertThat(entry.value()).isEqualTo("배우의 목표");
                    assertThat(entry.writtenByActor()).isTrue();
                    assertThat(entry.sourcePracticeSessionId()).isNull();
                });

        repository.delete(userId, ActorMemoryField.GOAL);
        assertThat(repository.list(userId)).noneMatch(entry -> entry.field().equals("goal"));
        repository.delete(userId, null);
        assertThat(repository.list(userId)).isEmpty();
    }

    @Test
    void memoryUpdateMaterialKeepsTranscriptOrderAndOnlyActorTurns() {
        UUID userId = insertUser("memory-material@example.com");
        UUID practiceId = insertPractice(userId);
        jdbc.update("""
                INSERT INTO transcripts (id,session_id,ord,text)
                VALUES (?, ?, 1, '두 번째 전사'), (?, ?, 0, '첫 번째 전사')
                """, UUID.randomUUID(), practiceId, UUID.randomUUID(), practiceId);
        UUID coachId = insertCoach(practiceId, "closed", NOW);
        insertTurn(coachId, 0, "actor", "첫 배우 말");
        insertTurn(coachId, 1, "ai", "코치 말");
        insertTurn(coachId, 2, "actor", "둘째 배우 말");

        var material = repository.material(practiceId);

        assertThat(material.userId()).isEqualTo(userId);
        assertThat(material.practiceSessionId()).isEqualTo(practiceId);
        assertThat(material.transcripts()).containsExactly("첫 번째 전사", "두 번째 전사");
        assertThat(material.actorMessages()).containsExactly("첫 배우 말", "둘째 배우 말");
    }

    private void setCreatedAt(UUID practiceId, OffsetDateTime at) {
        jdbc.update("UPDATE practice_sessions SET created_at=? WHERE id=?", at, practiceId);
    }

    private void insertCard(UUID practiceId, UUID coachId, String title, OffsetDateTime at) {
        UUID handoffId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coaching_handoffs (
                    id,coach_session_id,practice_session_id,branch_kind,handoff_json
                ) VALUES (?, ?, ?, 'analysis', '{}'::jsonb)
                """, handoffId, coachId, practiceId);
        jdbc.update("""
                INSERT INTO practice_reports (
                    practice_session_id,report_type,report_json,source_handoff_id,created_at
                ) VALUES (?, 'analysis', ?::jsonb, ?, ?)
                """, practiceId,
                "{\"report_type\":\"analysis\",\"title\":\"" + title
                        + "\",\"next_take\":{\"direction\":\"다음 방향\",\"tested\":false}}",
                handoffId, at);
    }

    private UUID insertUser(String email) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO users (id,email,status,created_at,updated_at)
                VALUES (?,?,'active',?,?)
                """, id, email, NOW, NOW);
        return id;
    }

    private UUID insertPractice(UUID userId) {
        return insertPractice(userId, null);
    }

    private UUID insertPractice(UUID userId, UUID continuedFrom) {
        UUID uploadId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents (
                    id,user_id,status,storage_provider,object_key,mime_type,size_bytes,
                    expires_at,created_at
                ) VALUES (?, ?, 'finalized', 's3', ?, 'video/mp4', 1, ?, ?)
                """, uploadId, userId, "users/" + userId + "/" + uploadId + ".mp4", NOW.plusDays(1), NOW);
        UUID practiceId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practice_sessions (
                    id,user_id,upload_intent_id,status,situation,character_context,goal,
                    blockage_kind,sub_branch,continued_from,created_at,updated_at
                ) VALUES (?, ?, ?, 'analyzed', '상황', '배우', '목표',
                    '분석', '캐릭터 분석', ?, ?, ?)
                """, practiceId, userId, uploadId, continuedFrom, NOW, NOW);
        return practiceId;
    }

    private UUID insertCoach(UUID practiceId, String status, OffsetDateTime createdAt) {
        UUID coachId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coach_sessions (
                    id,practice_session_id,status,conversation_summary,created_at,updated_at
                ) VALUES (?, ?, ?, '', ?, ?)
                """, coachId, practiceId, status, createdAt, createdAt);
        return coachId;
    }

    private void insertTurn(UUID coachId, int index, String role, String text) {
        jdbc.update("""
                INSERT INTO coach_turns (session_id,turn_index,role,text,created_at)
                VALUES (?, ?, ?, ?, ?)
                """, coachId, index, role, text, NOW);
    }
}
