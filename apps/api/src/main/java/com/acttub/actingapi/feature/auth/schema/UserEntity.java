package com.acttub.actingapi.feature.auth.schema;
import com.acttub.actingapi.platform.schema.*;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code users} — M0 의 {@code ddl-auto: validate} 검증용 매핑 2종 중 하나.
 *
 * <p>관계 매핑({@code @ManyToOne} 등)을 만들지 않는다 (apps/api/CONTRACT.md §5-1).
 * PK 는 앱에서 {@code UUID.randomUUID()} 로 만들고 {@link Persistable} 로 신규 여부를 알려
 * {@code save()} 가 SELECT-then-INSERT 로 새지 않게 한다 (apps/api/CONTRACT.md §5-3-2).
 *
 * <p>{@code nickname} 은 매핑하지 않는다. 이름은 {@code user_profiles.name} 이 정본이고, 컬럼은
 * 직전 릴리스의 서버를 위해 남아 있을 뿐이다 (apps/api/CONTRACT.md §5-1).
 */
@Entity
@Table(name = "users")
public class UserEntity extends AppGeneratedUuidEntity {

    @Column(name = "email")
    private String email;

    @Convert(converter = UserStatus.JpaConverter.class)
    @Column(name = "status", nullable = false, columnDefinition = "text")
    private UserStatus status;

    @Column(name = "deactivated_at")
    private Instant deactivatedAt;

    /** 탈퇴 3년 뒤의 파기(신원 해시 행, 보관하던 영상)를 마친 시각. 매일 도는 일이 이것이 빈 계정만 고른다. */
    @Column(name = "retention_purged_at")
    private Instant retentionPurgedAt;

    /** 웹 게스트가 첫 동의 시트에서 "만 14세 이상이에요"를 확인한 시각. 회원은 생년월일로 거른다. */
    @Column(name = "age_confirmed_at")
    private Instant ageConfirmedAt;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    /** {@code save()} 직전까지만 true. 영속화 후에는 false 가 되어 재저장 시 merge 로 넘어간다. */
    protected UserEntity() {
    }

    public UserEntity(UUID id, String email, UserStatus status) {
        super(id);
        this.email = email;
        this.status = status;
    }

    public String getEmail() {
        return email;
    }

    public UserStatus getStatus() {
        return status;
    }

    public Instant getDeactivatedAt() {
        return deactivatedAt;
    }

    public Instant getRetentionPurgedAt() {
        return retentionPurgedAt;
    }

    public Instant getAgeConfirmedAt() {
        return ageConfirmedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
