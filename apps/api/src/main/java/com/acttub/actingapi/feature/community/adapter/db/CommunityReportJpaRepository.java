package com.acttub.actingapi.feature.community.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.community.schema.CommunityReportEntity;
import org.springframework.data.jpa.repository.JpaRepository;

interface CommunityReportJpaRepository extends JpaRepository<CommunityReportEntity, UUID> {
}
