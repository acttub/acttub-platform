package com.acttub.actingapi.feature.audition.adapter.db;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import com.acttub.actingapi.feature.audition.domain.AuditionPosting;
import com.acttub.actingapi.feature.audition.schema.AuditionPostingEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code audition_postings} 를 읽고 쓰는 문장. 넣기·고치기는 한 문장의 upsert 다(apps/api/CONTRACT.md §5-9). */
interface AuditionPostingJpaRepository extends Repository<AuditionPostingEntity, Long> {

    /** 없으면 넣고, 같은 {@code (source, source_ref)} 가 있으면 사실 칸과 마지막 본 시각을 새 값으로 고친다. id 는 DB 가 매긴다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into AuditionPostingEntity (source, sourceRef, title, category, payText, applyStart, applyEnd,
                                               statusText, postedOn, sourceUrl, firstSeenAt, lastSeenAt)
            values (:source, :sourceRef, :title, :category, :payText, :applyStart, :applyEnd,
                    :statusText, :postedOn, :sourceUrl, :seen, :seen)
            on conflict (source, sourceRef) do update
            set title = excluded.title, category = excluded.category, payText = excluded.payText,
                applyStart = excluded.applyStart, applyEnd = excluded.applyEnd, statusText = excluded.statusText,
                postedOn = excluded.postedOn, sourceUrl = excluded.sourceUrl, lastSeenAt = excluded.lastSeenAt
            """)
    int upsert(String source, String sourceRef, String title, String category, String payText, LocalDate applyStart,
            LocalDate applyEnd, String statusText, LocalDate postedOn, String sourceUrl, Instant seen);

    @Query("""
            select new com.acttub.actingapi.feature.audition.domain.AuditionPosting(p.source, p.sourceRef, p.title,
                p.category, p.payText, p.applyStart, p.applyEnd, p.statusText, p.postedOn, p.sourceUrl)
            from AuditionPostingEntity p
            where p.applyEnd >= :today or (p.applyEnd is null and p.postedOn >= :postedSince)
            """)
    List<AuditionPosting> openCandidates(LocalDate today, LocalDate postedSince);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            delete from AuditionPostingEntity p
            where p.applyEnd < :endedBefore or (p.applyEnd is null and p.postedOn < :postedBefore)
            """)
    int deleteExpired(LocalDate endedBefore, LocalDate postedBefore);

    @Query("select max(p.lastSeenAt) from AuditionPostingEntity p")
    Instant lastSeenAt();
}
