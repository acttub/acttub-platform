package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.EntryReportEntity;
import com.acttub.actingapi.platform.schema.ChallengeEntryStatus;
import com.acttub.actingapi.platform.schema.ChallengeEntryVisibility;
import com.acttub.actingapi.platform.schema.ChallengeModeration;
import com.acttub.actingapi.platform.schema.EntryCommentStatus;
import com.acttub.actingapi.platform.schema.EntryReportReason;
import com.acttub.actingapi.platform.schema.EntryReportResolution;
import com.acttub.actingapi.platform.schema.EntryReportStatus;
import com.acttub.actingapi.platform.schema.EntryReportTarget;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code entry_reports} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface EntryReportJpaRepository extends Repository<EntryReportEntity, UUID> {

    /**
     * 신고 한 행. 사람 신고는 {@code source} 가 user 이고 신고자가 있으며, AI 검사가 올린 것은 ai 이고 신고자가 없다
     * ({@code ck_entry_reports_source_reporter}).
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into EntryReportEntity (id, targetType, targetId, reporterId, source, reason, note, status, targetVersion,
                                           targetText, requestId, requestFingerprint, createdAt)
            values (:id, :targetType, :targetId, :reporterId, :source, :reason, :note, :status, :targetVersion,
                    :targetText, :requestId, :requestFingerprint, :createdAt)
            """)
    int insert(UUID id, EntryReportTarget targetType, UUID targetId, UUID reporterId, String source, EntryReportReason reason,
            String note, EntryReportStatus status, int targetVersion, String targetText, UUID requestId,
            String requestFingerprint, Instant createdAt);

    /** 지운 댓글의 신고에 남은 본문 사본을 비운다. 신고 행은 남는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update EntryReportEntity r set r.targetText = null where r.targetType = COMMENT and r.targetId = :commentId")
    int purgeCommentCopies(UUID commentId);

    // ---- 접수 ----

    record Prior(UUID id, EntryReportStatus status, String requestFingerprint) { }

    /** 그 신고자가 같은 요청 id 로 이미 넣은 신고. */
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.EntryReportJpaRepository$Prior(r.id, r.status, r.requestFingerprint)
            from EntryReportEntity r where r.reporterId = :reporterId and r.requestId = :requestId
            """)
    List<Prior> findByRequest(UUID reporterId, UUID requestId);

    /** 그 신고자가 같은 대상에 이미 넣은 신고(처리된 것 포함). */
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.EntryReportJpaRepository$Prior(r.id, r.status, r.requestFingerprint)
            from EntryReportEntity r where r.targetType = :targetType and r.targetId = :targetId and r.reporterId = :reporterId
            """)
    List<Prior> findByTarget(EntryReportTarget targetType, UUID targetId, UUID reporterId);

    /** 그 신고자가 그 시각부터 넣은 신고 수(하루 한도). */
    @Query("select count(*) from EntryReportEntity r where r.reporterId = :reporterId and r.createdAt >= :since")
    long countSince(UUID reporterId, Instant since);

    /** 그 대상에 처리되지 않은 신고를 넣은 서로 다른 사람 수. */
    @Query("""
            select count(distinct r.reporterId) from EntryReportEntity r
            where r.targetType = :targetType and r.targetId = :targetId and r.status = RECEIVED
            """)
    long countOpenReporters(EntryReportTarget targetType, UUID targetId);

    /** 위와 같되 사람 신고만 센다(AI 검사가 올린 것은 빼고). */
    @Query("""
            select count(distinct r.reporterId) from EntryReportEntity r
            where r.targetType = :targetType and r.targetId = :targetId and r.status = RECEIVED and r.source = 'user'
            """)
    long countOpenUserReporters(EntryReportTarget targetType, UUID targetId);

    // ---- 판정 ----

    record Target(EntryReportTarget targetType, UUID targetId) { }

    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.EntryReportJpaRepository$Target(r.targetType, r.targetId)
            from EntryReportEntity r where r.id = :id
            """)
    Optional<Target> findTarget(UUID id);

    /** 신고 행을 잡는다 — 같은 신고의 두 판정이 여기서 줄을 선다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r.status from EntryReportEntity r where r.id = :id")
    Optional<EntryReportStatus> lockStatus(UUID id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update EntryReportEntity r
            set r.status = REVIEWED, r.resolution = :resolution, r.reviewedBy = :reviewer, r.reviewedAt = :now,
                r.resolutionNote = :note
            where r.id = :id
            """)
    int review(UUID id, EntryReportResolution resolution, String reviewer, String note, Instant now);

    /** 그 대상에 처리되지 않은 신고 수. */
    @Query("""
            select count(*) from EntryReportEntity r
            where r.targetType = :targetType and r.targetId = :targetId and r.status = RECEIVED
            """)
    long countOpen(EntryReportTarget targetType, UUID targetId);

    // ---- 운영 화면 ----

    /** 신고 한 건과 그 대상의 지금 모습. 대상 종류에 맞는 표 하나만 붙는다. 대상 행이 없으면 그쪽 값이 모두 null 이다. */
    record AdminRow(EntryReportEntity report, Integer entryVersion, String entryCaption, ChallengeEntryStatus entryStatus,
            ChallengeEntryVisibility entryVisibility, UUID commentId, String commentBody, Instant commentDeletedAt,
            EntryCommentStatus commentStatus, UUID challengeId, String challengeLine, Instant challengeDeletedAt,
            ChallengeModeration challengeModeration, long openReports) { }

    String ADMIN = """
            select new com.acttub.actingapi.feature.challenge.adapter.db.EntryReportJpaRepository$AdminRow(
                r, te.contentVersion, te.caption, te.status, te.visibility, tc.id, tc.body, tc.deletedAt, tc.status,
                tch.id, tch.line, tch.deletedAt, tch.moderation,
                (select count(*) from EntryReportEntity o
                 where o.targetType = r.targetType and o.targetId = r.targetId and o.status = RECEIVED))
            from EntryReportEntity r
            left join ChallengeEntryEntity te on r.targetType = ENTRY and te.id = r.targetId
            left join EntryCommentEntity tc on r.targetType = COMMENT and tc.id = r.targetId
            left join ChallengeEntity tch on r.targetType = CHALLENGE and tch.id = r.targetId
            """;

    @Query(ADMIN + " where r.id = :id")
    Optional<AdminRow> adminRow(UUID id);

    /** 그 상태의 신고를 접수 순(시각, id)으로. */
    @Query(ADMIN + " where r.status = :status order by r.createdAt, r.id")
    List<AdminRow> adminPage(EntryReportStatus status, Limit limit);

    @Query(ADMIN + " where r.status = :status and (r.createdAt, r.id) > (:at, :after) order by r.createdAt, r.id")
    List<AdminRow> adminPageAfter(EntryReportStatus status, Instant at, UUID after, Limit limit);

    /** 지운 참여작과 그 댓글의 신고에 남은 본문 사본을 비운다. 신고 행은 남는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update EntryReportEntity r set r.targetText = null
            where (r.targetType = ENTRY and r.targetId = :entryId)
               or (r.targetType = COMMENT and r.targetId in (select c.id from EntryCommentEntity c where c.entryId = :entryId))
            """)
    int purgeCopiesOfEntry(UUID entryId);

    /** 처리한 지 보관 기간이 지난 신고를 지운다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from EntryReportEntity r where r.status = REVIEWED and r.reviewedAt < :before")
    int deleteReviewedBefore(Instant before);
}
