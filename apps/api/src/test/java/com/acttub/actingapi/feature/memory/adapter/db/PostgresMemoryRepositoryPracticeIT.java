package com.acttub.actingapi.feature.memory.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.PriorContext;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * 0.1.0 이어하기의 장면 이력 — 같은 묶음 앞 회차의 노트를 차수별 한 줄로 싣는다 (practice.resume). 노트가 없는 회차,
 * 제목 없는 노트, 제목만 있는 옛 카드는 줄을 만들지 않는다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "ANALYSIS_WORKER_ENABLED=false"
})
class PostgresMemoryRepositoryPracticeIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("memory_practice_context");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    PostgresMemoryRepository repository;
    @Autowired
    JdbcTemplate jdbc;

    private UUID member;
    private UUID root;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        member = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", member);
        root = null;
    }

    @Test
    void sceneHistoryHasOneLinePerRoundWithATitledNote() {
        UUID first = round(1);
        note(first, "v2", "첫 노트", " ", null);
        round(2);
        UUID third = round(3);
        note(third, "legacy", null, null, "{\"report_type\":\"analysis\",\"title\":\" \"}");
        UUID fourth = round(4);
        note(fourth, "v2", "넷째 노트", "손을 쥐고 다시", null);
        UUID fifth = round(5);
        note(fifth, "v2", " ", "제안만 있음", null);
        UUID current = round(6);

        PriorContext context = repository.priorForPractice(member, current, null);

        assertThat(context.sceneHistory()).containsExactly("1차: 첫 노트", "4차: 넷째 노트 — 제안: 손을 쥐고 다시");
        assertThat(context.pendingTakes()).isEmpty();
    }

    @Test
    void firstRoundHasNoHistoryOrEarlierConversation() {
        UUID only = round(1);

        PriorContext context = repository.priorForPractice(member, only, null);

        assertThat(context.sceneHistory()).isEmpty();
        assertThat(context.earlierConversation()).isNull();
    }

    /** 앞 회차는 닫혀 있어야 다음 회차가 열린다 — 이번 회차를 열기 전에 묶음의 열린 회차를 닫는다. */
    private UUID round(int ordinal) {
        if (root != null) {
            jdbc.update("UPDATE practices SET stage='closed',close_reason='conversation_closed' WHERE root_id=?", root);
        }
        UUID video = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,12000)
                """, video, member, "videos/" + member + "/" + video + ".mp4");
        UUID id = UUID.randomUUID();
        if (root == null) {
            root = id;
        }
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,
                                      blockage_kind,sub_branch,situation,goal)
                VALUES (?,?,?,?,?,'conversing','legacy','분석','캐릭터 분석','장면','목표')
                """, id, member, video, root, ordinal);
        jdbc.update("""
                INSERT INTO coach_conversations(id,practice_id,start_request_id,status,close_reason,closed_at)
                VALUES (?,?,?,'closed','user_ended',now())
                """, UUID.randomUUID(), id, UUID.randomUUID());
        return id;
    }

    private void note(UUID practice, String format, String title, String nextTake, String legacyReport) {
        UUID conversation = jdbc.queryForObject("SELECT id FROM coach_conversations WHERE practice_id=?", UUID.class,
                practice);
        jdbc.update("""
                INSERT INTO coach_notes(id,conversation_id,format,kind,title,next_take,legacy_report,source_revision)
                VALUES (?,?,?,'analysis',?,?,CAST(? AS jsonb),1)
                """, UUID.randomUUID(), conversation, format, title, nextTake, legacyReport);
    }
}
