package com.acttub.actingapi.feature.support.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code support_inquiries}(V63·V81) — 로그인 없이 받는 웹 문의와 앱 안 의견.
 *
 * <p>{@code category}·{@code status} 는 DB 값이자 API 값이라 문자열 그대로 둔다. 허용 값은 DB 의 CHECK 가 지킨다.
 * {@code user_id} 는 유효한 액세스 토큰이 붙어 왔을 때만 있고 FK 가 없다.
 */
@Entity
@Table(name = "support_inquiries")
public class SupportInquiryEntity extends AppGeneratedUuidEntity {

    @Column(name = "category", nullable = false, updatable = false)
    private String category;

    @Column(name = "email", nullable = false, updatable = false)
    private String email;

    @Column(name = "body", nullable = false, updatable = false)
    private String body;

    @Column(name = "user_id", updatable = false)
    private UUID userId;

    @Column(name = "client", updatable = false)
    private String client;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected SupportInquiryEntity() {
    }

    public SupportInquiryEntity(UUID id, String category, String email, String body, UUID userId, String client,
            String status, Instant createdAt) {
        super(id);
        this.category = category;
        this.email = email;
        this.body = body;
        this.userId = userId;
        this.client = client;
        this.status = status;
        this.createdAt = createdAt;
    }

    public String getCategory() {
        return category;
    }

    public String getEmail() {
        return email;
    }

    public String getBody() {
        return body;
    }

    public UUID getUserId() {
        return userId;
    }

    public String getClient() {
        return client;
    }

    public String getStatus() {
        return status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
