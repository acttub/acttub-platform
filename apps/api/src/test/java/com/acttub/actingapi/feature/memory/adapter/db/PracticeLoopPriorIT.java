package com.acttub.actingapi.feature.memory.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.coach.app.PastPracticeLoop;
import com.acttub.actingapi.support.PostgresContainerSupport;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * 배우.md의 재료(같은 배우의 최근 연습 루프 대화)를 실제 스키마에서 읽는지.
 *
 * <p>묶음(이어하기)과 관계없이 읽되, 이번 연습·숨긴 연습·남의 연습·연습 루프가 아닌 대화·배우가 한 마디도 하지 않은
 * 대화는 읽지 않는다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
class PracticeLoopPriorIT {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String database = PostgresContainerSupport.createDatabaseName("practice_loop_prior_it");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(database));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PostgresMemoryRepository repository;

    private static final OffsetDateTime NOW = OffsetDateTime.of(2026, 10, 4, 12, 0, 0, 0, ZoneOffset.UTC);

    private static final String LOOP_STATE = """
            {"practice_loop":{"design":"버릇: 말하기 전에 시선이 위로 감 | 곳1: 0:05 | 곳2: 0:21",
             "statuses":["","배우의 말: 정정\\n피할 것: 시선\\n할 일: 내려놓기"]}}""";

    @Test
    @DisplayName("다른 묶음의 연습 루프 대화도 최신순으로 읽고, 턴 원문과 노트의 다음 촬영을 함께 싣는다")
    void readsRecentLoopsAcrossGroups() {
        UUID user = insertUser("loop-across@example.com");
        UUID older = insertPractice(user, false);
        UUID olderConversation = insertConversation(older, LOOP_STATE, NOW.minusDays(3),
                List.of("시선이 위로 가요", "카메라 렌즈 봤어용"));
        insertNote(olderConversation, "한 문장 끝에 상대를 끝까지 보기");
        UUID newer = insertPractice(user, false);
        insertConversation(newer, LOOP_STATE, NOW.minusDays(1), List.of("손을 크게 써요", "평가해 주세요"));
        UUID current = insertPractice(user, false);

        List<PastPracticeLoop> past = repository.priorForPractice(user, current, null).pastLoops();

        assertThat(past).hasSize(2);
        assertThat(past.get(0).turns()).extracting(PastPracticeLoop.Turn::text)
                .containsExactly("손을 크게 써요", "평가해 주세요");
        assertThat(past.get(1).turns()).extracting(PastPracticeLoop.Turn::role).containsExactly("ai", "actor");
        assertThat(past.get(1).nextTake()).isEqualTo("한 문장 끝에 상대를 끝까지 보기");
        assertThat(past.get(1).loopState().path("design").asText()).startsWith("버릇: 말하기 전에");
        assertThat(past.get(1).createdAt()).isEqualTo(NOW.minusDays(3).toInstant());
    }

    @Test
    @DisplayName("이번 연습·숨긴 연습·남의 연습·연습 루프가 아닌 대화·배우의 말이 없는 대화는 읽지 않는다")
    void skipsWhatTheActorDidNotSayHere() {
        UUID user = insertUser("loop-skip@example.com");
        UUID current = insertPractice(user, false);
        insertConversation(current, LOOP_STATE, NOW, List.of("이번 연습", "이번 답"));
        UUID hidden = insertPractice(user, true);
        insertConversation(hidden, LOOP_STATE, NOW.minusDays(1), List.of("숨김", "숨긴 연습의 답"));
        UUID legacy = insertPractice(user, false);
        insertConversation(legacy, "{}", NOW.minusDays(2), List.of("옛 코치", "옛 경로의 답"));
        UUID silent = insertPractice(user, false);
        insertConversation(silent, LOOP_STATE, NOW.minusDays(3), List.of("첫 코치만 있다"));
        UUID other = insertUser("loop-other@example.com");
        UUID othersPractice = insertPractice(other, false);
        insertConversation(othersPractice, LOOP_STATE, NOW.minusDays(1), List.of("남의 코치", "남의 답"));

        assertThat(repository.priorForPractice(user, current, null).pastLoops()).isEmpty();
    }

    @Test
    @DisplayName("최근 다섯 개까지만 읽는다")
    void readsAtMostFive() {
        UUID user = insertUser("loop-five@example.com");
        for (int i = 0; i < 7; i++) {
            UUID practice = insertPractice(user, false);
            insertConversation(practice, LOOP_STATE, NOW.minusDays(i + 1L), List.of("코치 " + i, "답 " + i));
        }
        UUID current = insertPractice(user, false);

        List<PastPracticeLoop> past = repository.priorForPractice(user, current, null).pastLoops();

        assertThat(past).hasSize(PostgresMemoryRepository.PAST_LOOPS);
        assertThat(past.get(0).turns().get(1).text()).isEqualTo("답 0");
    }

    private UUID insertUser(String email) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO users (id,email,status,created_at,updated_at)
                VALUES (?,?,'active',?,?)
                """, id, email, NOW, NOW);
        return id;
    }

    private UUID insertPractice(UUID user, boolean hidden) {
        UUID video = UUID.randomUUID();
        UUID practice = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,12000)
                """, video, user, "videos/" + video + ".mp4");
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,
                                      blockage_kind,sub_branch,situation)
                VALUES (?,?,?,?,1,'conversing','legacy','표현','표정','상황')
                """, practice, user, video, practice);
        if (hidden) jdbc.update("UPDATE practices SET hidden_at=now() WHERE id=?", practice);
        return practice;
    }

    /** 메시지는 코치·배우 순으로 번갈아 넣는다. */
    private UUID insertConversation(UUID practice, String state, OffsetDateTime createdAt, List<String> messages) {
        UUID conversation = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coach_conversations(id,practice_id,start_request_id,status,state,created_at,updated_at)
                VALUES (?,?,?,'open',CAST(? AS jsonb),?,?)
                """, conversation, practice, UUID.randomUUID(), state, createdAt, createdAt);
        for (int i = 0; i < messages.size(); i++) {
            jdbc.update("INSERT INTO coach_messages(id,conversation_id,turn_index,role,text) VALUES (?,?,?,?,?)",
                    UUID.randomUUID(), conversation, i, i % 2 == 0 ? "ai" : "actor", messages.get(i));
        }
        return conversation;
    }

    private void insertNote(UUID conversation, String nextTake) {
        jdbc.update("""
                INSERT INTO coach_notes(id,conversation_id,format,kind,title,next_take,source_revision)
                VALUES (?,?,'v2','action','버릇',?,0)
                """, UUID.randomUUID(), conversation, nextTake);
    }
}
