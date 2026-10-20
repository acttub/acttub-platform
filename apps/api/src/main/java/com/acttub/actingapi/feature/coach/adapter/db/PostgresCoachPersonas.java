package com.acttub.actingapi.feature.coach.adapter.db;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

import com.acttub.actingapi.feature.coach.app.CoachPersonas;
import com.acttub.actingapi.feature.coach.app.CoachSessionSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 자문위원 계정이면 그 사람에게 맞춘 코치 프롬프트 id 를 준다(SOMA-622).
 *
 * <p>자문위원은 {@code coaching/direct-video/personas/advisors.txt}의 "이메일 해시 id" 줄로 가린다. 예전의 A/B1 말투
 * 번갈아 주기는 그만뒀다. 사람마다 지난 자문 기록을 보고 쓴 프롬프트({@code personas/advisors/<id>.txt})를 늘 같은 것으로 준다.
 */
@Repository
class PostgresCoachPersonas implements CoachPersonas {
    private final EntityManager entityManager;
    private final Map<String, String> advisors;

    PostgresCoachPersonas(EntityManager entityManager) {
        this.entityManager = entityManager;
        this.advisors = parse(StructuredJson.textResource("/coaching/direct-video/personas/advisors.txt"));
    }

    /** "해시 id" 줄만 읽는다. 해시가 아니거나 id 가 없는 줄은 버린다. */
    static Map<String, String> parse(String text) {
        return text.lines().map(String::strip).filter(line -> line.matches("[0-9a-f]{64} [a-z][a-z-]*"))
                .collect(Collectors.toUnmodifiableMap(line -> line.substring(0, 64), line -> line.substring(65), (first, second) -> first));
    }

    /**
     * 코치 응답은 트랜잭션 밖에서 돈다. 공유 EntityManager 는 조회 메서드가 끝나면 바로 닫히므로
     * 스트림 대신 결과를 다 받아 오는 {@code getResultList()} 를 쓴다.
     */
    @Override
    public String assign(CoachSessionSnapshot session) {
        if (session.userId() == null || advisors.isEmpty()) return "";
        Object email = entityManager.createNativeQuery("SELECT email FROM users WHERE id=:id")
                .setParameter("id", session.userId()).getResultList().stream().filter(Objects::nonNull).findFirst().orElse(null);
        if (!(email instanceof String text)) return "";
        return advisors.getOrDefault(hash(text), "");
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
