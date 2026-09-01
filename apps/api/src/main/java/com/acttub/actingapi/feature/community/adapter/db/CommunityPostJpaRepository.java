package com.acttub.actingapi.feature.community.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.community.schema.CommunityPostEntity;
import org.springframework.data.jpa.repository.JpaRepository;

interface CommunityPostJpaRepository extends JpaRepository<CommunityPostEntity, UUID> {
}
