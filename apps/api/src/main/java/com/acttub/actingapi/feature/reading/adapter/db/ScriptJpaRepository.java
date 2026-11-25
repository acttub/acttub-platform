package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ScriptEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code scripts} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). 잠그는 조회는 방언 덕에 {@code for update} 로 나간다(§5-2). */
interface ScriptJpaRepository extends Repository<ScriptEntity, UUID> {

    @Query("select s.id from ScriptEntity s where s.id = :scriptId and s.userId = :userId")
    Optional<UUID> owned(UUID scriptId, UUID userId);

    /** 그 사람의 대본 가운데 원문 해시가 같은 것, 먼저 만든 것부터. */
    @Query("select s.id from ScriptEntity s where s.userId = :userId and s.rawHash = :rawHash order by s.createdAt, s.id")
    List<UUID> sameText(UUID userId, String rawHash, Limit limit);

    @Query("select count(*) from ScriptEntity s where s.userId = :userId")
    long countOf(UUID userId);

    /** 다시 쓸 대본과 그 제목의 출처. */
    interface Reusable {
        UUID getId();

        String getTitle();

        String getRequestedTitle();

        String getFileName();
    }

    /**
     * 같은 글(raw_hash)로 서버가 이미 나눠 둔, 아무도 고치지 않은 가장 최근의 남의 대본. 서버 나누기 결과만(나누기 요청이 그
     * 대본을 가리킨다, 기기가 보낸 구조·예시 제외), 고친 흔적이 없는 것만({@code updated_at = created_at}), {@code since} 뒤의
     * 것만 고른다.
     */
    @Query("""
            select s.id as id, s.title as title, i.title as requestedTitle, u.fileName as fileName
            from ScriptEntity s
            join lateral (select r.title as title, r.uploadId as uploadId from ScriptImportEntity r
                          where r.scriptId = s.id order by r.createdAt limit 1) i
            left join ScriptUploadEntity u on u.id = i.uploadId
            where s.rawHash = :rawHash
              and s.source in (com.acttub.actingapi.platform.schema.ScriptSource.FILE,
                               com.acttub.actingapi.platform.schema.ScriptSource.PASTE,
                               com.acttub.actingapi.platform.schema.ScriptSource.TYPED)
              and s.updatedAt = s.createdAt and s.createdAt >= :since and s.userId <> :userId
            order by s.createdAt desc, s.id desc
            limit 1
            """)
    Optional<Reusable> reusable(String rawHash, UUID userId, Instant since);

    /** 해시가 비어 있으면(V33 앞의 행) 값이 없는 것으로 나온다. */
    @Query("select s.rawHash from ScriptEntity s where s.userId = :userId and s.id = :scriptId")
    Optional<String> rawHash(UUID userId, UUID scriptId);

    /** 같은 대본의 회차 시작이 여기서 줄을 선다. 이관·삭제 뒤에는 남의 것이라 비어 있다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s.id from ScriptEntity s where s.id = :scriptId and s.userId = :userId")
    Optional<UUID> lockOwned(UUID scriptId, UUID userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s.id from ScriptEntity s where s.id = :scriptId")
    Optional<UUID> lock(UUID scriptId);

    /** 회원이 같은 요청 id 의 대본을 갖고 있으면 게스트 쪽 값을 비운다(이관). */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ScriptEntity guest
            set guest.requestId = null
            where guest.userId = :from
              and guest.requestId is not null
              and exists (select 1 from ScriptEntity member
                          where member.userId = :to and member.requestId = guest.requestId)
            """)
    int clearClashingRequestIds(UUID from, UUID to);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ScriptEntity s set s.userId = :to where s.userId = :from")
    int reassign(UUID from, UUID to);
}
