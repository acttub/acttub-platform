package com.acttub.actingapi.feature.consent.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.consent.schema.UserConsentEntity;
import org.springframework.data.jpa.repository.JpaRepository;

interface UserConsentJpaRepository extends JpaRepository<UserConsentEntity, UUID> {
}
