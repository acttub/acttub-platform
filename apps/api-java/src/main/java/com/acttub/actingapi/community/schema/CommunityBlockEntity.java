package com.acttub.actingapi.community.schema;
import java.time.Instant; import java.util.UUID; import jakarta.persistence.*;
import com.acttub.actingapi.schema.AppGeneratedUuidEntity;
@Entity @Table(name="community_blocks")
public class CommunityBlockEntity extends AppGeneratedUuidEntity {
    @Column(name="blocker_id",nullable=false) UUID blockerId; @Column(name="blocked_id",nullable=false) UUID blockedId; @Column(name="created_at",nullable=false,insertable=false,updatable=false) Instant createdAt;
    protected CommunityBlockEntity(){} public CommunityBlockEntity(UUID id,UUID blockerId,UUID blockedId){super(id);this.blockerId=blockerId;this.blockedId=blockedId;}
}
