package com.acttub.actingapi.feature.upload.adapter.db;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.upload.schema.UploadIntentEntity;
import org.springframework.data.jpa.repository.JpaRepository;

interface UploadIntentJpaRepository extends JpaRepository<UploadIntentEntity, UUID> {
    Optional<UploadIntentEntity> findByIdAndUserId(UUID id, UUID userId);
}
