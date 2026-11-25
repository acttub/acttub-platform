package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.EntryReportEntity;
import com.acttub.actingapi.platform.schema.EntryReportReason;
import com.acttub.actingapi.platform.schema.EntryReportStatus;
import com.acttub.actingapi.platform.schema.EntryReportTarget;
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
}
