package com.acttub.actingapi.feature.memory.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.IntStream;

import com.acttub.actingapi.feature.memory.app.ActorMemoryUpdates;
import com.acttub.actingapi.feature.memory.app.MemoryUpdateMaterial;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * 기억 갱신 워커가 지나는 저장소 길을 실제 Postgres 로 본다 — 재료(받아쓰기·관찰 인용), 다시 말하지 않을 것 덧붙이기,
 * 작업 완료 때의 계정·세대 판정 (practice.memory 「규칙·제약」·「상태」).
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "ANALYSIS_WORKER_ENABLED=false"
})
class PostgresActorMemoryStoreIT {
    private static final String CORRECTION_STATE = """
            {"practice_loop":{"design":"버릇: 고개를 크게 돌림 | 곳1: x\\n다음 테이크: 손을 꽉 쥐기",
             "statuses":["","배우의 말: 정정\\n피할 것: 시선\\n할 일: 내려놓기"]}}""";
    private static final String CORRECTION_LINE = "- 시선: \"렌즈 본 거예요\"";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("actor_memory_store");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    PostgresActorMemoryStore store;
    @Autowired
    JdbcTemplate jdbc;

    private UUID member;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        member = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", member);
    }

    @Test
    void materialCarriesNonBlankTranscriptSegmentsAndObservationQuotes() {
        UUID video = video();
        jdbc.update("""
                INSERT INTO video_transcripts(id,video_id,status,segments)
                VALUES (?,?,'ready',CAST(? AS jsonb))
                """, UUID.randomUUID(), video,
                "[{\"text\":\"문을 열지 마\"},{\"text\":\"  \"},{\"text\":3},{},{\"text\":\"가지 마\"}]");
        UUID practice = practice(video, """
                {"observations":[{"quote":"열지 마"},{"quote":" "},{"quote":7},{"note":"인용 없음"}]}
                """);

        MemoryUpdateMaterial material = store.material(practice);

        assertThat(material.userId()).isEqualTo(member);
        assertThat(material.goal()).isEqualTo("망설임을 보여 주기");
        assertThat(material.transcripts()).containsExactly("문을 열지 마", "가지 마");
        assertThat(material.quotations()).containsExactly("열지 마");
    }

    @Test
    void transcriptThatIsNotReadyAndAMissingAnalysisGiveNoMaterialText() {
        UUID video = video();
        jdbc.update("""
                INSERT INTO video_transcripts(id,video_id,status,segments)
                VALUES (?,?,'reserved',CAST('[{"text":"아직"}]' AS jsonb))
                """, UUID.randomUUID(), video);
        UUID practice = practice(video, null);

        MemoryUpdateMaterial material = store.material(practice);

        assertThat(material.practiceSessionId()).isEqualTo(practice);
        assertThat(material.transcripts()).isEmpty();
        assertThat(material.quotations()).isEmpty();
    }

    @Test
    void hiddenPracticeHasNoMaterial() {
        UUID practice = practice(video(), null);
        jdbc.update("UPDATE practices SET hidden_at=now() WHERE id=?", practice);

        assertThat(store.material(practice)).isNull();
    }

    @Test
    void avoidKeepsTheNewestTwelveLinesAndDoesNotRepeatALine() {
        UUID practice = practice(video(), null);
        conversation(practice, CORRECTION_STATE);
        List<String> old = IntStream.rangeClosed(1, 12).mapToObj(i -> "- 주제" + i + ": \"말" + i + "\"").toList();
        avoid(String.join("\n", old.subList(0, 6)) + "\n\n" + String.join("\n", old.subList(6, 12)), "agent", practice);

        boolean first = store.appendAvoid(member, practice, Instant.now());
        boolean again = store.appendAvoid(member, practice, Instant.now());

        List<String> expected = new ArrayList<>(old.subList(1, 12));
        expected.add(CORRECTION_LINE);
        assertThat(first).isTrue();
        assertThat(again).isFalse();
        assertThat(avoidValue()).isEqualTo(String.join("\n", expected));
    }

    @Test
    void avoidDropsOldLinesUntilTheValueFitsTheThousandCharacterLimit() {
        UUID practice = practice(video(), null);
        conversation(practice, CORRECTION_STATE);
        String longLine = "- 긴 주제: \"" + "가".repeat(990) + "\"";
        avoid(longLine, "agent", practice);

        assertThat(store.appendAvoid(member, practice, Instant.now())).isTrue();
        assertThat(avoidValue()).isEqualTo(CORRECTION_LINE);
    }

    @Test
    void avoidWrittenByTheActorOrAClosedAccountOrNoCorrectionIsLeftAlone() {
        UUID practice = practice(video(), null);
        UUID plain = practice(video(), null);
        conversation(practice, CORRECTION_STATE);
        conversation(plain, "{}");
        avoid("- 배우가 적은 줄", "actor", null);

        assertThat(store.appendAvoid(member, practice, Instant.now())).isFalse();
        assertThat(avoidValue()).isEqualTo("- 배우가 적은 줄");

        jdbc.update("DELETE FROM actor_memories WHERE user_id=?", member);
        assertThat(store.appendAvoid(member, plain, Instant.now())).isFalse();
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", member);
        assertThat(store.appendAvoid(member, practice, Instant.now())).isFalse();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM actor_memories WHERE user_id=?", Integer.class, member))
                .isZero();
    }

    @Test
    void completingForAClosedAccountFailsTheJobAndWritesNothing() {
        UUID practice = practice(video(), null);
        UUID job = job(practice, 0);
        UUID lease = UUID.randomUUID();
        ActorMemoryUpdates.Claimed claimed = store.claim(lease, Duration.ofMinutes(5), Instant.now());
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", member);

        List<String> written = store.complete(claimed, lease, Map.of("goal", "새 목표"), Instant.now());

        assertThat(claimed.jobId()).isEqualTo(job);
        assertThat(written).isEmpty();
        assertThat(jdbc.queryForMap("SELECT status,failure_reason FROM ai_jobs WHERE id=?", job))
                .containsEntry("status", "failed").containsEntry("failure_reason", "account_deactivated");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM actor_memories WHERE user_id=?", Integer.class, member))
                .isZero();
    }

    @Test
    void jobWithoutAnEpochIsWrittenInTheModelsFieldOrder() {
        UUID practice = practice(video(), null);
        job(practice, null);
        UUID lease = UUID.randomUUID();
        ActorMemoryUpdates.Claimed claimed = store.claim(lease, Duration.ofMinutes(5), Instant.now());
        jdbc.update("UPDATE users SET memory_epoch=memory_epoch+3 WHERE id=?", member);
        Map<String, String> updates = new java.util.LinkedHashMap<>();
        updates.put("habits", "고개를 돌린다");
        updates.put("goal", "새 목표");

        List<String> written = store.complete(claimed, lease, updates, Instant.now());

        assertThat(claimed.memoryEpoch()).isNull();
        assertThat(written).containsExactly("habits", "goal");
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs WHERE id=?", String.class, claimed.jobId()))
                .isEqualTo("succeeded");
    }

    private UUID video() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,12000)
                """, id, member, "videos/" + member + "/" + id + ".mp4");
        return id;
    }

    private UUID practice(UUID video, String record) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,
                                      blockage_kind,sub_branch,situation,goal)
                VALUES (?,?,?,?,1,'conversing','legacy','분석','캐릭터 분석','문 앞에서 돌아선다','망설임을 보여 주기')
                """, id, member, video, id);
        if (record != null) {
            jdbc.update("""
                    INSERT INTO analyses(id,practice_id,format,status,model,record,completed_at)
                    VALUES (?,?,'legacy','ready','test-model',CAST(? AS jsonb),now())
                    """, UUID.randomUUID(), id, record);
        }
        return id;
    }

    private void conversation(UUID practice, String state) {
        UUID conversation = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coach_conversations(id,practice_id,start_request_id,status,state)
                VALUES (?,?,?,'open',CAST(? AS jsonb))
                """, conversation, practice, UUID.randomUUID(), state);
        List<String> texts = List.of("고개가 돌아가요.", "렌즈 본 거예요", "알겠어요.");
        for (int i = 0; i < texts.size(); i++) {
            jdbc.update("""
                    INSERT INTO coach_messages(id,conversation_id,turn_index,role,text)
                    VALUES (?,?,?,?,?)
                    """, UUID.randomUUID(), conversation, i, i % 2 == 0 ? "ai" : "actor", texts.get(i));
        }
    }

    /**
     * @param sceneRoot 모델이 쓴 다시 말하지 않을 것은 장면 단위라 늘 장면이 있다(V52 이후 불변식). 배우가 장면 없이 쓴 칸이면 {@code null}
     */
    private void avoid(String value, String writtenBy, UUID sceneRoot) {
        jdbc.update("INSERT INTO actor_memories(id,user_id,field,value,written_by,scene_root_id) VALUES (?,?,'avoid',?,?,?)",
                UUID.randomUUID(), member, value, writtenBy, sceneRoot);
    }

    private String avoidValue() {
        return jdbc.queryForObject("SELECT value FROM actor_memories WHERE user_id=? AND field='avoid'",
                String.class, member);
    }

    private UUID job(UUID practice, Integer epoch) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,status,memory_epoch)
                VALUES (?,?,'memory_update',?,?,?,'pending',?)
                """, id, member, practice, UUID.randomUUID(), "a".repeat(64), epoch);
        return id;
    }
}
