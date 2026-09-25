package com.acttub.actingapi.feature.consent.schema;

import com.acttub.actingapi.feature.consent.domain.ConsentLocale;
import com.acttub.actingapi.platform.schema.*;

import java.time.Instant;
import java.util.UUID;
import jakarta.persistence.*;

@Entity
@Table(name = "consent_documents")
public class ConsentDocumentEntity extends AppGeneratedUuidEntity {

    @Convert(converter = ConsentType.JpaConverter.class)
    @Column(name = "type", nullable = false, columnDefinition = "text")
    ConsentType type;

    @Column(name = "version", nullable = false)
    String version;

    /** 문서가 쓰인 말. 한국어가 정본이고 다른 말은 같은 판의 번역본이다 (SOMA-544). */
    @Column(name = "locale", nullable = false)
    String locale;

    @Column(name = "title", nullable = false)
    String title;

    @Column(name = "body", nullable = false)
    String body;

    @Column(name = "required", nullable = false)
    boolean required;

    @Column(name = "published_at", nullable = false, insertable = false, updatable = false)
    Instant publishedAt;

    protected ConsentDocumentEntity() {
    }

    public ConsentDocumentEntity(UUID id, ConsentType type, String version, String title,
            String body, boolean required) {
        this(id, type, version, ConsentLocale.CANONICAL, title, body, required);
    }

    public ConsentDocumentEntity(UUID id, ConsentType type, String version, String locale,
            String title, String body, boolean required) {
        super(id);
        this.type = type;
        this.version = version;
        this.locale = locale;
        this.title = title;
        this.body = body;
        this.required = required;
    }

    /** 같은 판의 오탈자를 고친다. 판·종류·필수 여부는 바꾸지 않는다 — 그것은 새 판의 일이다. */
    public void rewrite(String title, String body) {
        this.title = title;
        this.body = body;
    }

    public ConsentType getType() {
        return type;
    }

    public String getVersion() {
        return version;
    }

    public String getLocale() {
        return locale;
    }

    public String getTitle() {
        return title;
    }

    public String getBody() {
        return body;
    }

    public boolean isRequired() {
        return required;
    }

    public Instant getPublishedAt() {
        return publishedAt;
    }
}
