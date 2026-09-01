package com.acttub.actingapi.feature.community.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.community.schema.CommunityCommentEntity;
import org.springframework.data.jpa.repository.JpaRepository;

interface CommunityCommentJpaRepository extends JpaRepository<CommunityCommentEntity, UUID> {
}
