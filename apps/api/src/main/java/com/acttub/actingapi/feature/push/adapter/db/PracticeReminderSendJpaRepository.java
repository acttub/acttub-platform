package com.acttub.actingapi.feature.push.adapter.db;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.push.schema.PracticeReminderSendEntity;
import com.acttub.actingapi.feature.push.schema.PracticeReminderSendId;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code practice_reminder_sends} 를 읽고 쓰는 문장. 선점은 한 문장이다(apps/api/CONTRACT.md §5-9). */
interface PracticeReminderSendJpaRepository extends Repository<PracticeReminderSendEntity, PracticeReminderSendId> {

    record KindCount(String kind, Long sent) {}

    record TemplateDay(String templateId, LocalDate day) {}

    /**
     * 대상 없는 {@code ON CONFLICT DO NOTHING} — 기본 키(회원·날·칸)와 대화 부분 유니크 인덱스 어느 쪽과 겹쳐도 0행이다. 영향 행
     * 수가 1 이면 선점한 것이다. {@code sent_at} 은 싣지 않아 DB 기본값(now())이 들어간다.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into PracticeReminderSendEntity (userId, day, slot, kind, skippedDays, templateId, conversationId)
            values (:userId, :day, :slot, :kind, :skippedDays, :templateId, :conversationId)
            on conflict do nothing
            """)
    int claim(UUID userId, LocalDate day, String slot, String kind, int skippedDays, String templateId,
            UUID conversationId);

    @Query("""
            select new com.acttub.actingapi.feature.push.adapter.db.PracticeReminderSendJpaRepository$KindCount(
                s.kind, count(s))
            from PracticeReminderSendEntity s
            where s.userId = :userId and s.day >= :since
            group by s.kind
            """)
    List<KindCount> countByKindSince(UUID userId, LocalDate since);

    @Query("""
            select new com.acttub.actingapi.feature.push.adapter.db.PracticeReminderSendJpaRepository$TemplateDay(
                s.templateId, max(s.day))
            from PracticeReminderSendEntity s
            where s.userId = :userId and s.day >= :since
            group by s.templateId
            """)
    List<TemplateDay> lastDayByTemplateSince(UUID userId, LocalDate since);
}
