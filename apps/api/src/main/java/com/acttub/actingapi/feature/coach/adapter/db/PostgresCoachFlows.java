package com.acttub.actingapi.feature.coach.adapter.db;

import com.acttub.actingapi.feature.coach.app.CoachFlows;
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
 * 코치 흐름 A/B 배정(SOMA-636).
 *
 * <p>일반 배우는 계정마다 한쪽으로 고정한다(user id 해시의 홀짝). 같은 사람이 연습마다 다른 흐름을 겪지 않게 하기 위해서다.
 * 코치 모델 비교(SOMA-657)는 연습 id 로 나누므로 두 비교는 서로 섞이지 않는다.
 * 자문위원({@code personas/advisors.txt})은 같은 사람이 두 흐름을 다 겪고 비교하도록 회차마다 덜 받은 쪽을 준다.
 * 같으면 user id 해시로 시작 쪽을 정한다. 흐름 기록이 있는 대화만 센다.
 */
@Repository
class PostgresCoachFlows implements CoachFlows {
    private final EntityManager entityManager;
    private final Map<String, String> advisors;

    PostgresCoachFlows(EntityManager entityManager) {
        this.entityManager = entityManager;
        this.advisors = PostgresCoachPersonas.parse(StructuredJson.textResource("/coaching/direct-video/personas/advisors.txt"));
    }

    /** 코치 응답은 트랜잭션 밖에서 돈다. 스트림 대신 {@code getResultList()}로 결과를 다 받아 온다. */
    @Override
    public String assign(CoachSessionSnapshot session) {
        if (session.userId() == null) return A;
        Object email = entityManager.createNativeQuery("SELECT email FROM users WHERE id=:id AND email IS NOT NULL")
                .setParameter("id", session.userId()).getResultList().stream().findFirst().orElse(null);
        boolean advisor = email instanceof String text && advisors.containsKey(PostgresCoachPersonas.hash(text));
        if (!advisor) return byAccount(session.userId());
        Object[] counts = (Object[]) entityManager.createNativeQuery("""
                SELECT count(*) FILTER (WHERE c.state->'practice_loop'->>'flow'='b'),
                       count(*) FILTER (WHERE c.state->'practice_loop'->>'flow'='a')
                FROM practices p
                JOIN coach_conversations c ON c.practice_id=p.id
                WHERE p.user_id=:userId AND p.id<>:practiceId
                """).setParameter("userId", session.userId())
                .setParameter("practiceId", session.practiceSessionId()).getResultList().get(0);
        return alternate(session.userId(), ((Number) counts[0]).longValue(), ((Number) counts[1]).longValue());
    }

    /** 계정마다 고정된 쪽. 연습 id 해시(모델 비교)와 겹치지 않게 접두어를 붙인 SHA-256 첫 바이트의 홀짝을 쓴다. */
    static String byAccount(UUID userId) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(("coach-flow:" + userId).getBytes(StandardCharsets.UTF_8));
            return (digest[0] & 1) == 0 ? A : B;
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    /** 자문위원: 덜 받은 쪽. 같으면 계정마다 정해진 쪽부터 시작한다. */
    static String alternate(UUID userId, long receivedB, long receivedA) {
        if (receivedB < receivedA) return B;
        if (receivedA < receivedB) return A;
        return byAccount(userId);
    }
}
