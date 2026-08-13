package com.acttub.actingapi.memory;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.domain.ActorMemoryAuthor;
import com.acttub.actingapi.domain.ActorMemoryField;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 배우 기억 6칸의 저장 계층 (`db/store.py:PostgresStore.list_actor_memory` 외).
 *
 * <p><b>배우가 손댄 칸은 에이전트가 덮지 않는다.</b> 읽고 나서 판단하면 그 사이 배우가
 * 고친 것을 덮을 수 있어, 조건을 {@code ON CONFLICT ... WHERE} 안에 둬서 한 문장으로
 * 끝낸다 — 건너뛰면 {@code RETURNING} 이 0행이라 {@code null} 이 돌아온다.
 */
@Repository
class MemoryStore {
    private final JdbcTemplate jdbc;
    private final Clock clock;

    MemoryStore(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /**
     * 빈 칸은 행이 없는 것이므로 6개보다 적게 돌아올 수 있다.
     *
     * <p>정렬은 enum 정의 순서다. 테이블을 명시하는 이유는 PostgreSQL 이 ORDER BY 에서
     * <b>출력 alias 를 먼저 보기</b> 때문이다 — 그냥 {@code field} 라고 쓰면 아래의
     * {@code field::text} alias 를 잡아 알파벳 순으로 갈린다.
     */
    List<MemoryRow> list(UUID userId) {
        return jdbc.query("""
                SELECT field::text AS field,
                       value,
                       written_by::text AS written_by,
                       source_practice_session_id
                FROM actor_memory_entries
                WHERE user_id=?
                ORDER BY actor_memory_entries.field
                """, MemoryStore::row, userId);
    }

    /** 배우가 직접 쓰거나 고친다. 항상 이긴다. */
    MemoryRow writeAsActor(UUID userId, ActorMemoryField field, String value) {
        return upsert(userId, field, value, ActorMemoryAuthor.ACTOR, null);
    }

    /**
     * 에이전트가 갱신한다. 배우가 손댄 칸은 건드리지 않고 {@code null} 을 돌려준다 —
     * 부르는 쪽이 "덮어썼다" 고 착각하지 않게 하려는 것이다.
     *
     * <p>성별·나이는 DB 제약이 막으므로 여기서 미리 걸러 불필요한 예외를 만들지 않는다.
     */
    MemoryRow writeAsAgent(
            UUID userId, ActorMemoryField field, String value, UUID sourcePracticeSessionId) {
        if (field == ActorMemoryField.GENDER || field == ActorMemoryField.AGE) {
            return null;
        }
        return upsert(userId, field, value, ActorMemoryAuthor.AGENT, sourcePracticeSessionId);
    }

    private MemoryRow upsert(
            UUID userId,
            ActorMemoryField field,
            String value,
            ActorMemoryAuthor author,
            UUID sourcePracticeSessionId) {
        OffsetDateTime stamp = OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC);
        String guard = author == ActorMemoryAuthor.ACTOR
                ? "true"
                : "actor_memory_entries.written_by <> 'actor'::actor_memory_author_t";
        List<MemoryRow> rows = jdbc.query("""
                INSERT INTO actor_memory_entries
                    (id,user_id,field,value,written_by,source_practice_session_id,created_at,updated_at)
                VALUES (?,?,?::actor_memory_field_t,?,?::actor_memory_author_t,?,?,?)
                ON CONFLICT ON CONSTRAINT uq_actor_memory_user_field DO UPDATE
                SET value=EXCLUDED.value,
                    written_by=EXCLUDED.written_by,
                    source_practice_session_id=EXCLUDED.source_practice_session_id,
                    updated_at=EXCLUDED.updated_at
                WHERE %s
                RETURNING field::text AS field,
                          value,
                          written_by::text AS written_by,
                          source_practice_session_id
                """.formatted(guard),
                MemoryStore::row,
                UUID.randomUUID(),
                userId,
                field.dbValue(),
                value,
                author.dbValue(),
                sourcePracticeSessionId,
                stamp,
                stamp);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    void delete(UUID userId, ActorMemoryField field) {
        if (field == null) {
            jdbc.update("DELETE FROM actor_memory_entries WHERE user_id=?", userId);
            return;
        }
        jdbc.update(
                "DELETE FROM actor_memory_entries WHERE user_id=? AND field=?::actor_memory_field_t",
                userId,
                field.dbValue());
    }

    private static MemoryRow row(java.sql.ResultSet result, int rowNumber)
            throws java.sql.SQLException {
        return new MemoryRow(
                result.getString("field"),
                result.getString("value"),
                "actor".equals(result.getString("written_by")),
                result.getObject("source_practice_session_id", UUID.class));
    }

    record MemoryRow(String field, String value, boolean writtenByActor, UUID sourcePracticeSessionId) {
    }
}
