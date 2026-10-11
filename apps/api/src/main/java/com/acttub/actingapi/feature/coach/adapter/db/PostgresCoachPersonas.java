package com.acttub.actingapi.feature.coach.adapter.db;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

import com.acttub.actingapi.feature.coach.app.CoachPersonas;
import com.acttub.actingapi.feature.coach.app.CoachSessionSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 자문위원 계정이면 연습마다 코치 성격을 번갈아 준다(SOMA-622).
 *
 * <p>자문위원은 {@code coaching/direct-video/personas/advisors.txt}의 이메일 해시로 가린다. 한 사람이 두 성격을 번갈아
 * 쓰도록 지난 코치 대화 수로 순서를 정하고, 시작 성격은 사람마다 갈라 둔다(사람 사이 차이가 한쪽에 몰리지 않게).
 */
@Repository
class PostgresCoachPersonas implements CoachPersonas {
    private static final List<String> ROTATION = List.of(DEFAULT, "b1");
    private final EntityManager entityManager;
    private final Set<String> advisors;

    PostgresCoachPersonas(EntityManager entityManager) {
        this.entityManager = entityManager;
        this.advisors = StructuredJson.textResource("/coaching/direct-video/personas/advisors.txt").lines()
                .map(String::strip).filter(line -> line.matches("[0-9a-f]{64}")).collect(Collectors.toUnmodifiableSet());
    }

    /**
     * 코치 응답은 트랜잭션 밖에서 돈다. 공유 EntityManager 는 조회 메서드가 끝나면 바로 닫히므로,
     * {@code getResultStream()} 으로 받은 스트림은 읽기 전에 결과가 닫혀 매번 실패했다(배정 실패 → 모두 기본 성격).
     * 결과를 다 받아 오는 {@code getResultList()} 를 쓴다.
     */
    @Override
    public String assign(CoachSessionSnapshot session) {
        if (session.userId() == null || advisors.isEmpty()) return "";
        Object email = entityManager.createNativeQuery("SELECT email FROM users WHERE id=:id")
                .setParameter("id", session.userId()).getResultList().stream().findFirst().orElse(null);
        if (!(email instanceof String text) || !advisors.contains(hash(text))) return "";
        Number prior = (Number) entityManager.createNativeQuery("""
                SELECT count(*) FROM practices p
                JOIN coach_conversations c ON c.practice_id=p.id
                WHERE p.user_id=:userId AND p.id<>:practiceId
                """).setParameter("userId", session.userId())
                .setParameter("practiceId", session.practiceSessionId()).getSingleResult();
        return order(session.userId().hashCode(), prior.longValue());
    }

    /** 시작 성격은 사람마다, 그다음은 대화마다 번갈아. */
    static String order(int personSeed, long priorConversations) {
        return ROTATION.get((int) Math.floorMod(Math.floorMod(personSeed, 2) + priorConversations, (long) ROTATION.size()));
    }

    static String hash(String email) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(email.strip().toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
