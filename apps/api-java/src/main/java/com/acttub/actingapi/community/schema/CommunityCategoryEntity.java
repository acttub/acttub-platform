package com.acttub.actingapi.community.schema;
import java.time.Instant; import java.util.UUID; import jakarta.persistence.*;
import com.acttub.actingapi.schema.AppGeneratedUuidEntity;
@Entity @Table(name="community_categories")
public class CommunityCategoryEntity extends AppGeneratedUuidEntity {
    @Column(name="slug",nullable=false) String slug; @Column(name="name",nullable=false) String name; @Column(name="description") String description; @Column(name="sort_order",nullable=false) int sortOrder; @Column(name="is_active",nullable=false) boolean active=true;
    @Column(name="created_at",nullable=false,insertable=false,updatable=false) Instant createdAt; protected CommunityCategoryEntity(){}
    public CommunityCategoryEntity(UUID id,String slug,String name,String description,int sortOrder){super(id);this.slug=slug;this.name=name;this.description=description;this.sortOrder=sortOrder;}
}
