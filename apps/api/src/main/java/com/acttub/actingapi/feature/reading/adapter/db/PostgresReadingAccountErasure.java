package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountErasure;
import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import com.acttub.actingapi.feature.reading.app.ReadingRecordingCleanup;
import com.acttub.actingapi.feature.reading.app.RetainedRecordings;
import com.acttub.actingapi.feature.reading.app.ScriptFileCleanup;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;

/**
 * 계정을 닫을 때 리딩 자료를 파기한다 (specs/reading 「리딩 자료의 이관·삭제·탈퇴」, account.withdraw).
 *
 * <p>대본·배역·줄·회차·회차 평가·암기 상태·나누기 요청·같이 만들기 기록은 <b>행째</b> 지운다 — 연습 기록과 달리 사람과 끊어
 * 남기지 않는다. 녹음은 보관 동의자 것만 남긴다: 회차·줄 연결을 비우고 {@code user_id} 를 유지해 탈퇴 3년 뒤의 파기
 * ({@link #purgeOf})가 지운다. 동의가 없으면 행(음성과 전사)을 지우고 객체 키를 같은 트랜잭션에서 장부
 * ({@code reading_recording_delete})에 올린다.
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션이나 3년 파기의 트랜잭션에 참여한다.
 */
@Repository
class PostgresReadingAccountErasure implements AccountErasure, RetainedRecordings {

    /** 이 계정을 가리키는 리딩 자료. 한 줄이라도 있으면 계정 행을 지울 수 없다(외래 키에 ON DELETE 가 없다). */
    private static final List<String> RECORDS = List.of(
            "select s.id from ScriptEntity s where s.userId = :userId",
            "select s.id from ReadingSessionEntity s where s.userId = :userId",
            "select r.id from ReadingRecordingEntity r where r.userId = :userId",
            "select r.id from ReadingSessionRatingEntity r where r.userId = :userId",
            "select m.id from LineMemorizationEntity m where m.userId = :userId",
            "select i.id from ScriptImportEntity i where i.userId = :userId",
            "select u.id from ScriptUploadEntity u where u.userId = :userId");

    private final EntityManager entityManager;
    private final ScriptFileCleanup scriptFiles;
    private final ReadingRecordingCleanup recordings;

    PostgresReadingAccountErasure(
            EntityManager entityManager, ScriptFileCleanup scriptFiles, ReadingRecordingCleanup recordings) {
        this.entityManager = entityManager;
        this.scriptFiles = scriptFiles;
        this.recordings = recordings;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return EnumSet.of(AccountErasureStep.READING, AccountErasureStep.READING_VOICE_USAGE);
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        return switch (step) {
            case READING -> eraseReading(account.userId(), account.retainMedia(), account.now());
            case READING_VOICE_USAGE -> {
                entityManager.createQuery("delete from ReadingVoiceUsageEntity u where u.userId = :userId")
                        .setParameter("userId", account.userId())
                        .executeUpdate();
                yield List.of();
            }
            default -> throw new IllegalArgumentException("not a reading step: " + step);
        };
    }

    @Override
    public boolean hasRecords(UUID userId) {
        return RECORDS.stream().anyMatch(query -> !entityManager.createQuery(query, UUID.class)
                .setParameter("userId", userId)
                .setMaxResults(1)
                .getResultList()
                .isEmpty());
    }

    @Override
    public List<UUID> purgeOf(UUID userId, Instant now) {
        List<String> objectKeys = deleteRecordings(userId);
        return objectKeys.isEmpty() ? List.of() : List.of(recordings.schedule(userId, objectKeys, now));
    }

    /**
     * 먼저 이 사람의 대본·회차 행을 잡는다 — 리딩의 쓰기(회차 시작·암기 갱신은 대본 행, 진행 저장·녹음 저장은 회차 행)가 같은
     * 행을 잡으므로 겹쳐도 순서가 정해진다: 쓰기가 먼저면 그 행까지 여기서 지우고, 파기가 먼저면 쓰기는 없는 행을 보고 404 다.
     * 다시 온 탈퇴는 지울 것이 없어 아무것도 하지 않는다.
     */
    private List<UUID> eraseReading(UUID userId, boolean retainRecordings, Instant now) {
        for (String locked : List.of("ScriptEntity", "ReadingSessionEntity")) {
            entityManager.createQuery("select e.id from " + locked + " e where e.userId = :userId", UUID.class)
                    .setParameter("userId", userId)
                    .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                    .getResultList();
        }
        List<UUID> cleanups = new ArrayList<>();
        // 대본 원본 파일은 보관 동의와 무관하게 대본과 함께 지운다(reading.script 「원본 파일」). 기기가 서명한 주소로 올린
        // 객체라 주소 시한 뒤에 지운다 — 먼저 지우면 그 뒤에 다시 올린 객체가 장부 밖에 남는다.
        List<Tuple> sources = NativeTuples.list(entityManager.createNativeQuery("""
                WITH removed AS (DELETE FROM script_uploads WHERE user_id=:userId RETURNING object_key,expires_at)
                SELECT object_key,expires_at FROM removed
                """, Tuple.class)
                .setParameter("userId", userId));
        if (!sources.isEmpty()) {
            cleanups.add(scriptFiles.schedule(userId, sources.stream().map(row -> row.get("object_key", String.class)).toList(),
                    now, sources.stream().map(row -> row.get("expires_at", Instant.class)).max(Instant::compareTo).orElseThrow()));
        }
        if (retainRecordings) {
            entityManager.createQuery("""
                            update ReadingRecordingEntity r
                            set r.readingSessionId = null, r.lineId = null, r.updatedAt = :now
                            where r.userId = :userId and (r.readingSessionId is not null or r.lineId is not null)
                            """)
                    .setParameter("now", now)
                    .setParameter("userId", userId)
                    .executeUpdate();
        } else {
            cleanups.addAll(purgeOf(userId, now));
        }
        entityManager.createQuery("delete from LineMemorizationEntity m where m.userId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
        // 회차 평가(V40)는 회차와 함께 행째 지운다 — 노트 평가와 달리 사람과 끊어 남기지 않는다(회차가 남지 않으므로).
        // 평가의 쓰기는 같은 users 행을 먼저 잡으므로 늦게 온 평가가 남지 않는다.
        entityManager.createQuery("""
                        delete from ReadingSessionRatingEntity r
                        where r.userId = :userId
                           or r.sessionId in (select s.id from ReadingSessionEntity s where s.userId = :userId)
                        """)
                .setParameter("userId", userId)
                .executeUpdate();
        entityManager.createQuery("delete from ReadingSessionEntity s where s.userId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
        for (String child : List.of("ScriptLineEntity", "ScriptCharacterEntity")) {
            entityManager.createQuery("delete from " + child
                            + " c where c.scriptId in (select s.id from ScriptEntity s where s.userId = :userId)")
                    .setParameter("userId", userId)
                    .executeUpdate();
        }
        entityManager.createQuery("delete from ScriptEntity s where s.userId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
        // 나누기 요청은 원문을 들고 있다. 진행 중인 작업 행은 AI_JOBS 자리가 닫는다.
        entityManager.createQuery("delete from ScriptImportEntity i where i.userId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
        // 찍을 대사 같이 만들기(V56)의 생성 기록은 감정·상황·원하는 방향 글을 들고 있다.
        entityManager.createQuery("delete from ScriptCocreationEntity c where c.userId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
        return cleanups;
    }

    /** 이 사람의 녹음 행을 전부 지우고 객체 키를 돌려준다. 부르는 쪽이 같은 트랜잭션에서 장부에 올린다. */
    private List<String> deleteRecordings(UUID userId) {
        return NativeTuples.list(entityManager.createNativeQuery("""
                WITH removed AS (
                    DELETE FROM reading_recordings
                    WHERE user_id=:userId
                    RETURNING object_key
                )
                SELECT object_key FROM removed
                """, Tuple.class)
                .setParameter("userId", userId)).stream()
                .map(row -> row.get("object_key", String.class))
                .toList();
    }
}
