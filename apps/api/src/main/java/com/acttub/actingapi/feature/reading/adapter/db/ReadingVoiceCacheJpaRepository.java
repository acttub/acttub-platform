package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.Collection;
import java.util.Optional;

import com.acttub.actingapi.feature.reading.schema.ReadingVoiceCacheEntity;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code reading_voice_cache} 를 읽는 문장(apps/api/CONTRACT.md §5-9). 넣기는 줄 수 차감과 묶인 CTE 라 저장소의 native SQL 에 있다. */
interface ReadingVoiceCacheJpaRepository extends Repository<ReadingVoiceCacheEntity, String> {

    @Query("select c.hash from ReadingVoiceCacheEntity c where c.hash = :hash")
    Optional<String> find(String hash);

    @Query("select count(*) from ReadingVoiceCacheEntity c where c.hash in :hashes")
    long countIn(Collection<String> hashes);

    /**
     * 트랜잭션이 끝날 때까지 그 키의 권고 잠금을 쥔다. 같은 키를 쥔 다른 트랜잭션이 있으면 기다린다. 표를 읽지 않는 문장이라
     * 저장 기록 저장소에 둔다 — 이 잠금이 지키는 것이 저장 확인과 차감 사이다.
     */
    @Query("select pg_advisory_xact_lock(hashtextextended(:key, 0))")
    Object lockUntilCommit(String key);
}
