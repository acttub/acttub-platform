package com.acttub.actingapi.feature.coach.adapter.db;

import com.acttub.actingapi.feature.coach.app.CoachOpenings;
import com.acttub.actingapi.feature.coach.app.CoachSessionSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import jakarta.persistence.EntityManager;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Repository;

/**
 * 첫 코칭 첫 말 A/B 배정.
 *
 * <p>대상은 user id 가 있고, 자문위원({@code personas/advisors.txt})이 아니고, 이전 코치 대화가 하나도 없는 배우다.
 * 대상이면 계정마다 한쪽으로 고정한다(SHA-256("coach-opening:" + userId) 첫 바이트의 홀짝).
 * 접두어가 달라 코치 흐름 비교("coach-flow:")와 서로 섞이지 않는다. 대상이 아니면 A다.
 */
@Repository
class PostgresCoachOpenings implements CoachOpenings {
    private final EntityManager entityManager;
    private final Map<String, String> advisors;

    PostgresCoachOpenings(EntityManager entityManager) {
        this.entityManager = entityManager;
        this.advisors = PostgresCoachPersonas.parse(StructuredJson.textResource("/coaching/direct-video/personas/advisors.txt"));
    }

    /** 코치 응답은 트랜잭션 밖에서 돈다. 스트림 대신 {@code getResultList()}로 결과를 다 받아 온다. */
    @Override
    public String assign(CoachSessionSnapshot session) {
        if (session.userId() == null) return A;
        Object email = entityManager.createNativeQuery("SELECT email FROM users WHERE id=:id AND email IS NOT NULL")
                .setParameter("id", session.userId()).getResultList().stream().findFirst().orElse(null);
        if (email instanceof String text && advisors.containsKey(PostgresCoachPersonas.hash(text))) return A;
        Number earlier = (Number) entityManager.createNativeQuery("""
                SELECT count(*)
                FROM practices p
                JOIN coach_conversations c ON c.practice_id=p.id
                WHERE p.user_id=:userId AND p.id<>:practiceId
                """).setParameter("userId", session.userId())
                .setParameter("practiceId", session.practiceSessionId()).getResultList().get(0);
        if (earlier.longValue() > 0) return A;
        return byAccount(session.userId());
    }

    /** 계정마다 고정된 쪽. 접두어를 붙인 SHA-256 첫 바이트의 홀짝을 쓴다. */
    static String byAccount(UUID userId) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(("coach-opening:" + userId).getBytes(StandardCharsets.UTF_8));
            return (digest[0] & 1) == 0 ? A : B;
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
