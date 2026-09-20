package com.acttub.actingapi.feature.push.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.push.app.PushTokenRepository;
import com.acttub.actingapi.feature.push.app.PushTarget;
import com.acttub.actingapi.platform.web.OutputLanguage;
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
     *
     * <p><b>"둘 다 꺼짐" 확인과 저장이 한 트랜잭션이다.</b> 따로 읽고 쓰면, 토글을 끄는 트랜잭션이 토큰을
     * 지우는 사이에 끼어든 등록이 살아남는다 — 다른 기기가 앱을 여는 것만으로 토큰이 되살아난다
     * (apps/api/CONTRACT.md §5-2·§6-10). 토글 끄기와 탈퇴가 잡는 것과 같은 {@code users} 행을 먼저 잡아
     * 줄을 서고, 그 뒤에 읽은 토글로 거른다. 활성 계정이 아니면 저장하지 않는다.
     *
     * <p>⚠ {@code users} 는 {@code auth}, 토글({@code user_profiles})은 {@code profile} 의 것이다. 확인이
     * 저장과 같은 트랜잭션에 있어야 뜻이 있어 native SQL 로 읽는다(다른 feature 의 Schema Entity 를 import
     * 하지 않는다).
     */
    @Override
    public void register(UUID userId, String token, String platform) {
        transaction.executeWithoutResult(status -> {
            boolean active = !list(entityManager.createNativeQuery("""
                    SELECT id
                    FROM users
                    WHERE id=:userId
                      AND status='active'
                    FOR UPDATE
                    """, Tuple.class)
                    .setParameter("userId", userId)).isEmpty();
            if (!active) {
                return;
            }
            // 둘 다 꺼 둔 회원이면 0행이다 — 조용히 지나간다.
            list(entityManager.createNativeQuery("""
                    WITH registered AS (
                        INSERT INTO push_tokens(user_id,token,platform,locale)
                        SELECT :userId,:token,:platform,:locale
                        WHERE NOT EXISTS (SELECT 1
                                          FROM user_profiles
                                          WHERE user_id=:userId
                                            AND NOT notify_analysis_done
                                            AND NOT notify_challenge)
                        ON CONFLICT(token)
                        DO UPDATE SET user_id=EXCLUDED.user_id,
                                      platform=EXCLUDED.platform,
                                      locale=EXCLUDED.locale,
                                      updated_at=now()
                        RETURNING id
                    )
                    SELECT id FROM registered
                    """, Tuple.class)
                    .setParameter("userId", userId)
                    .setParameter("token", token)
                    .setParameter("platform", platform)
                    // 토큰을 맡기는 것은 요청이라 여기서만 받는 사람의 말을 알 수 있다 (SOMA-544).
                    .setParameter("locale", OutputLanguage.current().getLanguage()));
        });
    }

    @Override
    public void unregister(String token) {
        transaction.executeWithoutResult(status -> tokens.deleteByToken(token));
    }

    /**
     * ⚠ 토글은 프로필의 것이다({@code user_profiles}). 보내기 직전에 읽어 거르는 일이라 같은 질의에서
     * 읽는다 — 다른 feature 의 Schema Entity 를 import 하지 않도록 native SQL 로 둔다. 프로필 행이 없으면
     * 기본값(켜짐)으로 본다.
     */
    @Override
    public List<PushTarget> analysisDoneTargets(UUID sessionId) {
        return list(entityManager.createNativeQuery("""
                SELECT push.token, push.locale
                FROM push_tokens push
                JOIN practice_sessions practice ON practice.user_id=push.user_id
                LEFT JOIN user_profiles profile ON profile.user_id=push.user_id
                WHERE practice.id=:sessionId
                  AND COALESCE(profile.notify_analysis_done,true)
                ORDER BY push.created_at
                """, Tuple.class)
                .setParameter("sessionId", sessionId)).stream()
                .map(row -> new PushTarget(
                        row.get("token", String.class),
                        row.get("locale", String.class)))
                .toList();
    }
}
