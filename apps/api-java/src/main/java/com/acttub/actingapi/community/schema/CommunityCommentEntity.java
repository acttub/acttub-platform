package com.acttub.actingapi.community.schema;
import java.time.Instant; import java.util.UUID; import jakarta.persistence.*; import org.hibernate.annotations.JdbcType;
import com.acttub.actingapi.schema.AppGeneratedUuidEntity;
import com.acttub.actingapi.schema.ContentStatus;
import com.acttub.actingapi.schema.PgEnumJdbcType;
@Entity @Table(name="community_comments")
public class CommunityCommentEntity extends AppGeneratedUuidEntity {
    @Column(name="post_id",nullable=false) UUID postId; @Column(name="author_id",nullable=false) UUID authorId; @Column(name="body",nullable=false) String body; @Column(name="anonymous",nullable=false) boolean anonymous;
    @Convert(converter=ContentStatus.JpaConverter.class) @JdbcType(PgEnumJdbcType.class) @Column(name="status",nullable=false,columnDefinition="content_status_t") ContentStatus status;
    @Column(name="created_at",nullable=false,insertable=false,updatable=false) Instant createdAt; @Column(name="updated_at",nullable=false,insertable=false,updatable=false) Instant updatedAt;
    protected CommunityCommentEntity(){} public CommunityCommentEntity(UUID id,UUID postId,UUID authorId,String body,ContentStatus status){super(id);this.postId=postId;this.authorId=authorId;this.body=body;this.status=status;}
}
