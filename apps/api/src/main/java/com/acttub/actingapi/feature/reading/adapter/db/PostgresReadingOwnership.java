package com.acttub.actingapi.feature.reading.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

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
 * 쓰지 않는다. 이 잠금이 없으면 옮기는 사이에 커밋된 대본이 닫힌 게스트에게 남는다. {@code users} 는 auth 의 표라 이
 * 잠금만 native SQL 로 둔다(§5-9).
 */
@Repository
class PostgresReadingOwnership implements ReadingOwnership {
    private final EntityManager entityManager;
    private final ScriptJpaRepository scripts;
    private final ReadingSessionJpaRepository sessions;
    private final ReadingRecordingJpaRepository recordings;
    private final LineMemorizationJpaRepository memorization;
    private final ReadingSessionRatingJpaRepository ratings;

    PostgresReadingOwnership(
            EntityManager entityManager,
            ScriptJpaRepository scripts,
            ReadingSessionJpaRepository sessions,
            ReadingRecordingJpaRepository recordings,
            LineMemorizationJpaRepository memorization,
            ReadingSessionRatingJpaRepository ratings) {
        this.entityManager = entityManager;
        this.scripts = scripts;
        this.sessions = sessions;
        this.recordings = recordings;
        this.memorization = memorization;
        this.ratings = ratings;
    }

    @Override
    public void reassign(UUID from, UUID to) {
        list(entityManager.createNativeQuery("SELECT id FROM users WHERE id=:from FOR UPDATE", Tuple.class)
                .setParameter("from", from));
        // 게스트와 회원의 request_id 가 겹치면(UUID 라 실질적으로 없다) 게스트 쪽 값을 비우고 옮긴다.
        scripts.clearClashingRequestIds(from, to);
        sessions.clearClashingRequestIds(from, to);
        // 회차 평가(V40)는 회차를 따라 회원 것이 된다 — 회원의 회차 조회에 남긴 평가가 그대로 보인다. 회원과 게스트는
        // 서로의 회차를 가질 수 없어 (session_id, user_id) 가 부딪히지 않는다.
        scripts.reassign(from, to);
        sessions.reassign(from, to);
        recordings.reassign(from, to);
        memorization.reassign(from, to);
        ratings.reassign(from, to);
    }
}
