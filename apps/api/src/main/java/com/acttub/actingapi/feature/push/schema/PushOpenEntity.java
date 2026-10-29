package com.acttub.actingapi.feature.push.schema;
import java.time.Instant;
import java.util.UUID;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
/** 푸시를 눌러 앱을 연 기록(V72, SOMA-926). 쓰기는 PostgresPushOpenRepository 의 native INSERT 가 한다. */
@Entity @Table(name = "push_opens")
public class PushOpenEntity {
    @Id @Column(name = "id", nullable = false, insertable = false, updatable = false) private UUID id;
    @Column(name = "user_id", nullable = false, insertable = false, updatable = false) private UUID userId;
    @Column(name = "kind", nullable = false, insertable = false, updatable = false) private String kind;
    @Column(name = "reminder_kind", insertable = false, updatable = false) private String reminderKind;
    @Column(name = "template_id", insertable = false, updatable = false) private String templateId;
    @Column(name = "platform", insertable = false, updatable = false) private String platform;
    @Column(name = "app_version", insertable = false, updatable = false) private String appVersion;
    @Column(name = "opened_at", nullable = false, insertable = false, updatable = false) private Instant openedAt;
    protected PushOpenEntity() {}
}
