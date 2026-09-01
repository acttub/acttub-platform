package com.acttub.actingapi.feature.push.adapter.db;

import static com.acttub.actingapi.platform.schema.NativeTuples.list;

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
    public void unregister(UUID userId, String token) {
        transaction.executeWithoutResult(
                status -> tokens.deleteByOwnerAndToken(userId, token));
    }

    @Override
    public List<String> tokensForSessionOwner(UUID sessionId) {
        return list(entityManager.createNativeQuery("""
                SELECT push.token
                FROM push_tokens push
                JOIN practice_sessions practice ON practice.user_id=push.user_id
                WHERE practice.id=:sessionId
                ORDER BY push.created_at
                """, Tuple.class)
                .setParameter("sessionId", sessionId)).stream()
                .map(row -> row.get("token", String.class))
                .toList();
    }
}
