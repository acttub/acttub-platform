package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.app.EntryMediaPurge;
import com.acttub.actingapi.feature.video.app.VideoObjectCleanup;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 트랜잭션을 열지 않는다 — 탈퇴나 3년 파기의 트랜잭션에 참여한다. 모자이크 워커와 공유 프레임 붙이기는 {@code users} 행을 먼저
 * 잡으므로, 여기서 키를 읽은 뒤에 붙는 객체는 없다(늦게 만든 것은 그쪽이 장부로 보낸다).
 */
@Repository
class PostgresEntryMediaPurge implements EntryMediaPurge {

    private final EntityManager entityManager;
    private final VideoObjectCleanup cleanups;

    PostgresEntryMediaPurge(EntityManager entityManager, VideoObjectCleanup cleanups) {
        this.entityManager = entityManager;
        this.cleanups = cleanups;
    }

    @Override
    public List<UUID> purgeOf(UUID userId, Instant now) {
        Set<String> objectKeys = new LinkedHashSet<>();
        for (Object[] entry : entityManager.createQuery(
                        "select e.mosaicKey, e.shareFrameKeys from ChallengeEntryEntity e where e.userId = :userId",
                        Object[].class)
                .setParameter("userId", userId)
                .getResultList()) {
            if (entry[0] != null) {
                objectKeys.add((String) entry[0]);
            }
            objectKeys.addAll(List.of((String[]) entry[1]));
        }
        return objectKeys.isEmpty()
                ? List.of()
                : List.of(cleanups.scheduleObjectDelete(userId, List.copyOf(objectKeys), now, now));
    }
}
