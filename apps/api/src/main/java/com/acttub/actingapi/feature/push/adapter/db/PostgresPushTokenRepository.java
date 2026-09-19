package com.acttub.actingapi.feature.push.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.push.app.PushTokenRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
class PostgresPushTokenRepository implements PushTokenRepository {
    private final PushTokenJpaRepository tokens;
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresPushTokenRepository(
            PushTokenJpaRepository tokens,
            EntityManager entityManager,
            PlatformTransactionManager transactionManager) {
        this.tokens = tokens;
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    /**
     * 토큰 기준 upsert. 같은 폰에 다른 계정이 로그인하면 소유자가 바뀌는 것이 맞다 —
     * 이전 계정으로 온 알림이 새 사용자의 폰에 뜨는 것이 이 테이블이 막아야 할 사고다.
     *
     * <p>ID는 DB default가 만들고, 충돌 때는 기존 ID를 유지한다. native upsert의
     * {@code RETURNING}을 data-modifying CTE로 읽는 표준 패턴을 쓴다.
     */
    @Override
    public void register(UUID userId, String token, String platform) {
        transaction.executeWithoutResult(status -> {
            List<Tuple> registered = list(entityManager.createNativeQuery("""
                    WITH registered AS (
                        INSERT INTO push_tokens(user_id,token,platform)
                        VALUES (:userId,:token,:platform)
                        ON CONFLICT(token)
                        DO UPDATE SET user_id=EXCLUDED.user_id,
                                      platform=EXCLUDED.platform,
                                      updated_at=now()
                        RETURNING id
                    )
                    SELECT id FROM registered
                    """, Tuple.class)
                    .setParameter("userId", userId)
                    .setParameter("token", token)
                    .setParameter("platform", platform));
            if (registered.size() != 1
                    || registered.getFirst().get("id", UUID.class) == null) {
                throw new IllegalStateException("push token upsert returned no id");
            }
        });
    }

    @Override
    public void unregister(String token) {
        transaction.executeWithoutResult(status -> entityManager.createNativeQuery("""
                DELETE FROM push_tokens
                WHERE token=:token
                """)
                .setParameter("token", token)
                .executeUpdate());
    }

    /**
     * ⚠ 토글은 프로필의 것이다({@code user_profiles}). 보내기 직전에 읽어 거르는 일이라 같은 질의에서
     * 읽는다 — 다른 feature 의 Schema Entity 를 import 하지 않도록 native SQL 로 둔다. 프로필 행이 없으면
     * 기본값(켜짐)으로 본다.
     */
    @Override
    public List<String> analysisDoneTargets(UUID sessionId) {
        return list(entityManager.createNativeQuery("""
                SELECT push.token
                FROM push_tokens push
                JOIN practice_sessions practice ON practice.user_id=push.user_id
                LEFT JOIN user_profiles profile ON profile.user_id=push.user_id
                WHERE practice.id=:sessionId
                  AND COALESCE(profile.notify_analysis_done,true)
                ORDER BY push.created_at
                """, Tuple.class)
                .setParameter("sessionId", sessionId)).stream()
                .map(row -> row.get("token", String.class))
                .toList();
    }

    @Override
    public boolean pushesTurnedOff(UUID userId) {
        return !list(entityManager.createNativeQuery("""
                SELECT 1 AS turned_off
                FROM user_profiles
                WHERE user_id=:userId
                  AND NOT notify_analysis_done
                  AND NOT notify_challenge
                """, Tuple.class)
                .setParameter("userId", userId)).isEmpty();
    }
}
