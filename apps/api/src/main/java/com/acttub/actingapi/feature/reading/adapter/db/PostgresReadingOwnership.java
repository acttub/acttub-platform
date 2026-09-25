package com.acttub.actingapi.feature.reading.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ReadingOwnership;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;

/**
 * 이관의 주인 바꾸기. ⚠ <b>트랜잭션을 열지 않는다</b> — 이관 트랜잭션에 참여한다(apps/api/CONTRACT.md §6-9).
 *
 * <p>먼저 게스트의 {@code users} 행을 잡는다. 리딩의 쓰기({@link PostgresScriptRepository#lockActive} 등)가
 * 같은 행을 잡고 활성인지 보므로, 쓰기가 먼저면 그 행까지 여기서 옮기고 이관이 먼저면 쓰기는 닫힌 계정을 보고
 * 쓰지 않는다. 이 잠금이 없으면 옮기는 사이에 커밋된 대본이 닫힌 게스트에게 남는다.
 */
@Repository
class PostgresReadingOwnership implements ReadingOwnership {
    private final EntityManager entityManager;

    PostgresReadingOwnership(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public void reassign(UUID from, UUID to) {
        list(entityManager.createNativeQuery("SELECT id FROM users WHERE id=:from FOR UPDATE", Tuple.class)
                .setParameter("from", from));
        // 게스트와 회원의 request_id 가 겹치면(UUID 라 실질적으로 없다) 게스트 쪽 값을 비우고 옮긴다.
        for (String table : List.of("scripts", "reading_sessions")) {
            entityManager.createNativeQuery("""
                    UPDATE %1$s AS guest
                    SET request_id=NULL
                    WHERE guest.user_id=:from
                      AND guest.request_id IS NOT NULL
                      AND EXISTS (SELECT 1 FROM %1$s AS member
                                  WHERE member.user_id=:to AND member.request_id=guest.request_id)
                    """.formatted(table))
                    .setParameter("from", from)
                    .setParameter("to", to)
                    .executeUpdate();
        }
        for (String table : List.of("scripts", "reading_sessions", "reading_recordings", "line_memorization")) {
            entityManager.createNativeQuery("UPDATE " + table + " SET user_id=:to WHERE user_id=:from")
                    .setParameter("to", to)
                    .setParameter("from", from)
                    .executeUpdate();
        }
    }
}
