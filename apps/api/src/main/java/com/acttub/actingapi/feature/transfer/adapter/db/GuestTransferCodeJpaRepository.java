package com.acttub.actingapi.feature.transfer.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.transfer.app.TransferCodeRepository.LiveCode;
import com.acttub.actingapi.feature.transfer.schema.GuestTransferCodeEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code guest_transfer_codes} 를 읽고 쓰는 문장. 조건부 갱신은 모두 한 문장이다(apps/api/CONTRACT.md §5-9). */
interface GuestTransferCodeJpaRepository extends Repository<GuestTransferCodeEntity, UUID> {

    /** 이 게스트의 쓰지 않은 코드와, 시한이 지난 남의 같은 해시를 지운다. 쓰인 코드는 "옮겨졌다"는 표식이라 남긴다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            delete from GuestTransferCodeEntity c
            where c.usedAt is null
              and (c.userId = :guestId or (c.codeHash = :codeHash and c.expiresAt <= :now))
            """)
    int deleteReplaceable(UUID guestId, String codeHash, Instant now);

    /** 대상 없는 {@code ON CONFLICT DO NOTHING} — 부분 유니크 인덱스 둘 가운데 어느 쪽과 겹쳐도 0행이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into GuestTransferCodeEntity (id, userId, codeHash, createdAt, expiresAt)
            values (:id, :guestId, :codeHash, :now, :expiresAt)
            on conflict do nothing
            """)
    int insertUnlessTaken(UUID id, UUID guestId, String codeHash, Instant now, Instant expiresAt);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select new com.acttub.actingapi.feature.transfer.app.TransferCodeRepository$LiveCode(c.id, c.userId)
            from GuestTransferCodeEntity c
            where c.codeHash = :codeHash and c.usedAt is null and c.expiresAt > :now
            """)
    List<LiveCode> lockLive(String codeHash, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update GuestTransferCodeEntity c set c.usedAt = :now where c.id = :codeId")
    int markUsed(UUID codeId, Instant now);

    boolean existsByUserIdAndUsedAtIsNotNull(UUID userId);

    /** 쓰인 코드는 쓰인 시각, 쓰이지 않은 코드는 시한을 기준으로 지운다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from GuestTransferCodeEntity c where coalesce(c.usedAt, c.expiresAt) < :before")
    int deleteStale(Instant before);
}
