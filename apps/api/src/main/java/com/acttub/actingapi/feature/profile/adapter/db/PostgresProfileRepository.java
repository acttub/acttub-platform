package com.acttub.actingapi.feature.profile.adapter.db;

import static com.acttub.actingapi.platform.schema.NativeTuples.list;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.profile.app.ProfileRepository;
import com.acttub.actingapi.feature.profile.domain.Profile;
import com.acttub.actingapi.platform.schema.UserStatus;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
class PostgresProfileRepository implements ProfileRepository {
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresProfileRepository(
            EntityManager entityManager,
            PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Profile find(UUID userId) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
                SELECT id,email,nickname,status
                FROM users
                WHERE id=:userId
                """, Tuple.class)
                .setParameter("userId", userId));
        return rows.isEmpty() ? null : profile(rows.getFirst());
    }

    /**
     * 아는 어휘인지 확인하고 DB 값을 그대로 돌려준다.
     *
     * <p><b>Domain Model 이 문자열을 들되 느슨해지지는 않게 하는 자리다.</b> 열거형은
     * {@code jakarta.persistence} 를 끌고 있어 {@code domain} 으로 들일 수 없지만, 그렇다고
     * 어휘 밖 값을 통과시키면 재편이 실패 경로를 넓힌다 — 스키마를 먼저 넓히고 코드를 나중에
     * 좁히는 배포 순서에서 <b>DB 에 값이 먼저, 자바가 나중</b>은 실제로 일어난다. 종전처럼
     * 여기서 터지고 500 이 난다. ({@code practice} 가 검증 없이 문자열을 쓰는 것은 그쪽이
     * 재편 전부터 그랬기 때문이고, 이 넷은 열거형이었다.)
     */
    private static String status(String raw) {
        return UserStatus.valueOf(raw.toUpperCase(Locale.ROOT)).dbValue();
    }

    @Override
    public Profile updateNickname(UUID userId, String nickname) {
        return transaction.execute(status -> {
            int updated = entityManager.createNativeQuery("""
                    UPDATE users
                    SET nickname=:nickname,updated_at=now()
                    WHERE id=:userId
                    """)
                    .setParameter("nickname", nickname)
                    .setParameter("userId", userId)
                    .executeUpdate();
            return updated == 0 ? null : find(userId);
        });
    }

    /**
     * 탈퇴 처리 (`db/store.py:PostgresStore.deactivate_user`).
     *
     * <p>행을 지우지 않는다 — 커뮤니티 글·연습 기록이 {@code user_id} 를 참조하므로 지우면
     * 남의 글타래가 깨진다. 대신 개인을 식별하는 것(이메일·닉네임·identity)을 전부 파기하고
     * refresh 토큰을 끊는다. <b>상태 전환·파기·토큰 폐기를 한 트랜잭션에 묶는다</b> — 나누면
     * 중간 실패 시 "탈퇴했는데 refresh 는 살아 있는" 계정이 남는다.
     *
     * <p>⚠ <b>여기서 {@code user_identities}·{@code refresh_tokens}·{@code push_tokens} 를 함께
     * 치는 것은 의도한 것이다.</b> 테이블 주인은 각각 {@code auth}·{@code push} 지만 파기의
     * 원자성이 트랜잭션 하나를 요구한다. 다른 feature의 Schema Entity를 import하면 패키지
     * 경계를 우회하므로 이 교차 도메인 정리는 명시적 native DML로 남긴다.
     *
     * <p>이미 탈퇴한 계정이면 <b>최초 탈퇴 시각을 유지</b>한다. 파기는 멱등하게 다시 돈다.
     */
    @Override
    public Profile deactivate(UUID userId) {
        return transaction.execute(status -> {
            List<Tuple> current = list(entityManager.createNativeQuery("""
                    SELECT status
                    FROM users
                    WHERE id=:userId
                    FOR UPDATE
                    """, Tuple.class)
                    .setParameter("userId", userId));
            if (current.isEmpty()) {
                return null;
            }
            if (!"deactivated".equals(current.getFirst().get("status", String.class))) {
                entityManager.createNativeQuery("""
                        UPDATE users
                        SET status='deactivated',
                            deactivated_at=now(),
                            updated_at=now()
                        WHERE id=:userId
                        """)
                        .setParameter("userId", userId)
                        .executeUpdate();
            }
            entityManager.createNativeQuery("""
                    UPDATE users
                    SET email=NULL,nickname=NULL
                    WHERE id=:userId
                    """)
                    .setParameter("userId", userId)
                    .executeUpdate();
            entityManager.createNativeQuery("""
                    DELETE FROM user_identities
                    WHERE user_id=:userId
                    """)
                    .setParameter("userId", userId)
                    .executeUpdate();
            entityManager.createNativeQuery("""
                    UPDATE refresh_tokens
                    SET revoked_at=now()
                    WHERE user_id=:userId
                      AND revoked_at IS NULL
                    """)
                    .setParameter("userId", userId)
                    .executeUpdate();
            entityManager.createNativeQuery("""
                    DELETE FROM push_tokens
                    WHERE user_id=:userId
                    """)
                    .setParameter("userId", userId)
                    .executeUpdate();
            return find(userId);
        });
    }

    private static Profile profile(Tuple row) {
        return new Profile(
                row.get("id", UUID.class),
                row.get("email", String.class),
                row.get("nickname", String.class),
                status(row.get("status", String.class)));
    }
}
