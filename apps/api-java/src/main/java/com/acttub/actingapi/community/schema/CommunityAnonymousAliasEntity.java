package com.acttub.actingapi.community.schema;
import java.time.Instant; import java.util.UUID; import jakarta.persistence.*;
import com.acttub.actingapi.schema.AppGeneratedUuidEntity;
@Entity @Table(name="community_anonymous_aliases")
public class CommunityAnonymousAliasEntity extends AppGeneratedUuidEntity {
    @Column(name="post_id",nullable=false) UUID postId; @Column(name="user_id",nullable=false) UUID userId; @Column(name="ordinal",nullable=false) int ordinal; @Column(name="created_at",nullable=false,insertable=false,updatable=false) Instant createdAt;
    protected CommunityAnonymousAliasEntity(){} public CommunityAnonymousAliasEntity(UUID id,UUID postId,UUID userId,int ordinal){super(id);this.postId=postId;this.userId=userId;this.ordinal=ordinal;}
}
