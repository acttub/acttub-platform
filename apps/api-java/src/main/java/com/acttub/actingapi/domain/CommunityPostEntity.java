package com.acttub.actingapi.domain;
import java.time.Instant; import java.util.UUID; import jakarta.persistence.*; import org.hibernate.annotations.JdbcType;
@Entity @Table(name="community_posts")
public class CommunityPostEntity extends AppGeneratedUuidEntity {
    @Column(name="category_id",nullable=false) UUID categoryId; @Column(name="author_id",nullable=false) UUID authorId; @Column(name="title",nullable=false) String title; @Column(name="body",nullable=false) String body; @Column(name="anonymous",nullable=false) boolean anonymous;
    @Convert(converter=ContentStatus.JpaConverter.class) @JdbcType(PgEnumJdbcType.class) @Column(name="status",nullable=false,columnDefinition="content_status_t") ContentStatus status;
    @Column(name="like_count",nullable=false) int likeCount; @Column(name="comment_count",nullable=false) int commentCount; @Column(name="view_count",nullable=false) int viewCount;
    @Column(name="created_at",nullable=false,insertable=false,updatable=false) Instant createdAt; @Column(name="updated_at",nullable=false,insertable=false,updatable=false) Instant updatedAt;
    protected CommunityPostEntity(){} public CommunityPostEntity(UUID id,UUID categoryId,UUID authorId,String title,String body,ContentStatus status){super(id);this.categoryId=categoryId;this.authorId=authorId;this.title=title;this.body=body;this.status=status;}
}
