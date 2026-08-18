package com.acttub.actingapi.feature.memory.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.support.PostgresContainerSupport;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
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

    private UUID insertUser(String email) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO users (id,email,status,created_at,updated_at)
                VALUES (?,?,'active'::user_status_t,?,?)
                """, id, email, NOW, NOW);
        return id;
    }

    private UUID insertPractice(UUID userId) {
        UUID uploadId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents (
                    id,user_id,status,storage_provider,object_key,mime_type,size_bytes,
                    expires_at,created_at
                ) VALUES (?, ?, 'finalized'::upload_status_t, 's3', ?, 'video/mp4', 1, ?, ?)
                """, uploadId, userId, "users/" + userId + "/take.mp4", NOW.plusDays(1), NOW);
        UUID practiceId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practice_sessions (
                    id,user_id,upload_intent_id,status,situation,character_context,goal,
                    blockage_kind,sub_branch,created_at,updated_at
                ) VALUES (?, ?, ?, 'analyzed'::practice_status_t, '상황', '배우', '목표',
                    '분석', '캐릭터 분석', ?, ?)
                """, practiceId, userId, uploadId, NOW, NOW);
        return practiceId;
    }

    private UUID insertCoach(UUID practiceId, String status, OffsetDateTime createdAt) {
        UUID coachId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coach_sessions (
                    id,practice_session_id,status,conversation_summary,created_at,updated_at
                ) VALUES (?, ?, ?::session_status_t, '', ?, ?)
                """, coachId, practiceId, status, createdAt, createdAt);
        return coachId;
    }

    private void insertTurn(UUID coachId, int index, String role, String text) {
        jdbc.update("""
                INSERT INTO coach_turns (session_id,turn_index,role,text,created_at)
                VALUES (?, ?, ?::turn_role_t, ?, ?)
                """, coachId, index, role, text, NOW);
    }
}
