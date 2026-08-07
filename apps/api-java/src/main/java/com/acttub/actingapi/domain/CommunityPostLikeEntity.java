package com.acttub.actingapi.domain;
import java.time.Instant; import java.util.UUID; import jakarta.persistence.*;
@Entity @Table(name="community_post_likes")
public class CommunityPostLikeEntity extends AppGeneratedUuidEntity {
    @Column(name="post_id",nullable=false) UUID postId; @Column(name="user_id",nullable=false) UUID userId; @Column(name="created_at",nullable=false,insertable=false,updatable=false) Instant createdAt;
    protected CommunityPostLikeEntity(){} public CommunityPostLikeEntity(UUID id,UUID postId,UUID userId){super(id);this.postId=postId;this.userId=userId;}
}
