package com.acttub.actingapi.feature.push.schema;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

/** 개인화 연습 알림을 보낸 기록(V47). 읽고 쓰기는 네이티브 SQL이 하고, 이 엔티티는 스키마 검증용 매핑이다. */
@Entity @Table(name = "practice_reminder_sends") @IdClass(PracticeReminderSendId.class)
public class PracticeReminderSendEntity {
    @Id @Column(name = "user_id", nullable = false) private UUID userId;
    @Id @Column(name = "day", nullable = false) private LocalDate day;
    @Id @Column(name = "slot", nullable = false) private String slot;
    @Column(name = "kind", nullable = false) private String kind;
    @Column(name = "skipped_days", nullable = false) private int skippedDays;
    @Column(name = "template_id", nullable = false) private String templateId;
    @Column(name = "sent_at", nullable = false, insertable = false, updatable = false) private Instant sentAt;
    @Column(name = "conversation_id") private UUID conversationId;
    protected PracticeReminderSendEntity() {}
}
