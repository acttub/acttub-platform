package com.acttub.actingapi.schema;

import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Transient;
import org.springframework.data.domain.Persistable;

/** 앱에서 UUID를 생성하는 20개 엔티티의 Spring Data 신규 판정 규칙. */
@MappedSuperclass
public abstract class AppGeneratedUuidEntity implements Persistable<UUID> {

    @Id
    @Column(name = "id", nullable = false)
    protected UUID id;

    @Transient
    private boolean newEntity = true;

    protected AppGeneratedUuidEntity() {
    }

    protected AppGeneratedUuidEntity(UUID id) {
        this.id = id;
    }

    @Override
    public UUID getId() {
        return id;
    }

    @Override
    public boolean isNew() {
        return newEntity;
    }

    @PostPersist
    @PostLoad
    void markNotNew() {
        newEntity = false;
    }
}
