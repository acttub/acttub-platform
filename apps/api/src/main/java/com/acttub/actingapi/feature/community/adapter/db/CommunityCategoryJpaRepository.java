package com.acttub.actingapi.feature.community.adapter.db;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.community.schema.CommunityCategoryEntity;
import org.springframework.data.jpa.repository.JpaRepository;

interface CommunityCategoryJpaRepository extends JpaRepository<CommunityCategoryEntity, UUID> {

    List<CommunityCategoryEntity> findByActiveTrueOrderBySortOrderAscSlugAsc();

    Optional<CommunityCategoryEntity> findBySlugAndActiveTrue(String slug);
}
