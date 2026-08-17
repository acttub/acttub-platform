package com.acttub.actingapi.consent.schema;
import com.acttub.actingapi.platform.schema.*;
import java.time.Instant; import java.util.UUID; import jakarta.persistence.*; import org.hibernate.annotations.JdbcType;
@Entity @Table(name="consent_documents")
public class ConsentDocumentEntity extends AppGeneratedUuidEntity {
    @Convert(converter=ConsentType.JpaConverter.class) @JdbcType(PgEnumJdbcType.class) @Column(name="type",nullable=false,columnDefinition="consent_type_t") ConsentType type;
    @Column(name="version",nullable=false) String version; @Column(name="title",nullable=false) String title; @Column(name="body",nullable=false) String body;
    @Column(name="required",nullable=false) boolean required; @Column(name="published_at",nullable=false,insertable=false,updatable=false) Instant publishedAt;
    protected ConsentDocumentEntity(){} public ConsentDocumentEntity(UUID id,ConsentType type,String version,String title,String body,boolean required){super(id);this.type=type;this.version=version;this.title=title;this.body=body;this.required=required;}
    public ConsentType getType(){return type;} public String getVersion(){return version;} public String getTitle(){return title;} public String getBody(){return body;} public boolean isRequired(){return required;}
}
